import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@^0.120.0'
import { authorizeLectureAccess, type AuthResult } from '../_shared/auth.ts'
import { buildParseInput, parseQuiz } from '../_shared/quiz.ts'
import { buildCorsHeaders } from '../_shared/cors.ts'
import type { ImageMediaType } from '../_shared/claude.ts'

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
const cors = buildCorsHeaders(APP_ORIGIN)
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** ~5MB of image, expressed as base64 (which inflates by ~4/3). */
const MAX_IMAGE_BASE64_LENGTH = 7_000_000

const ALLOWED_MEDIA_TYPES: ImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

interface ParseRequest {
  lectureId?: string
  text?: string
  imageBase64?: string
  imageMediaType?: ImageMediaType
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let body: ParseRequest
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }

  const { lectureId, text, imageBase64, imageMediaType } = body
  if (!lectureId) return json(400, { error: 'lectureId is required' })
  if (!text && !imageBase64) return json(400, { error: 'Provide either quiz text or an image.' })
  if (text && imageBase64) return json(400, { error: 'Provide text or an image, not both.' })
  // Whitespace-only text is truthy, so it slips past the guard above and would
  // otherwise reach buildParseInput, which throws — turning a client-supplied
  // validation failure into a misleading 500. Catch it here as the 400 it is.
  if (text && !text.trim()) return json(400, { error: 'Pasted quiz text is empty.' })

  if (imageBase64) {
    if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return json(413, { error: 'That screenshot is larger than 5MB. Crop it or lower the resolution.' })
    }
    if (!imageMediaType || !ALLOWED_MEDIA_TYPES.includes(imageMediaType)) {
      return json(400, { error: `imageMediaType must be one of: ${ALLOWED_MEDIA_TYPES.join(', ')}` })
    }
  }

  // Identity → ownership → privileged work. Never reorder.
  let auth: AuthResult
  try {
    auth = await authorizeLectureAccess(
      {
        getUserFromToken: async (token) => {
          const scoped = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
          const { data, error } = await scoped.auth.getUser()
          // A transient error validating the token must not be indistinguishable
          // from "no user" — that would surface as a misleading 401 instead of
          // an honest 500. Throwing here is caught by the surrounding try/catch.
          if (error) throw new Error(`Could not verify the caller's identity: ${error.message}`)
          return data.user ? { id: data.user.id } : null
        },
        getLecture: async (id) => {
          const { data, error } = await admin.from('lectures').select('*').eq('id', id).maybeSingle()
          if (error) throw new Error(`Could not look up the lecture: ${error.message}`)
          return data ?? null
        },
      },
      req.headers.get('Authorization'),
      lectureId,
    )
  } catch (e) {
    // Nothing is in flight and no row has been written, so this returns a
    // proper CORS'd JSON 500 rather than letting Deno emit a bare, header-less
    // response the browser would report as an opaque CORS error.
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
  if (!auth.ok) return json(auth.status, { error: auth.error })

  // A lecture with no completed analysis has no claims and no distinctions, so
  // every diagnosis built from it would be ungrounded — the exact output this
  // feature exists to prevent. The UI hides the entry point in this case; this
  // is the server-side half of that guarantee.
  const { data: statusRow, error: statusErr } = await admin
    .from('lectures').select('processing_status, claims').eq('id', lectureId).maybeSingle()
  if (statusErr) return json(500, { error: `Could not read lecture status: ${statusErr.message}` })
  if (statusRow?.processing_status !== 'completed') {
    return json(409, { error: 'This lecture has not finished analysis yet, so there is nothing to diagnose against.' })
  }

  // 'completed' is not the same as "has something to cite". A slides lecture
  // has no transcript, so `claims[].quote` is the ENTIRE verification corpus —
  // and with no claims that corpus is empty, which means every citation the
  // diagnostician produces gets rejected in code and silently disappears. The
  // student would get confident, quote-free explanations from a lecture the app
  // knows nothing about. Refuse at the gate instead, and say which it is.
  const claims = statusRow.claims
  if (!Array.isArray(claims) || claims.length === 0) {
    return json(409, {
      error: 'This lecture has no recorded claims, so there is nothing to check a diagnosis against. Re-run its analysis first.',
    })
  }

  // Parse FIRST, write second. A failed parse must leave no row behind —
  // a half-written review is worse than no review.
  let parsed
  try {
    const input = buildParseInput({ text, imageBase64, imageMediaType })
    parsed = await parseQuiz(new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! }), input)
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }

  // A parse that found zero questions (e.g. a fully illegible screenshot) has
  // nothing to review. Persisting a question-less row would be exactly the
  // "review with no questions" the rollback below exists to prevent, so
  // nothing is written at all. This is a genuine 200, not a 4xx: the request
  // succeeded and the result is "no questions found" — supabase-js buries a
  // non-2xx body in error.context, which would make the `unreadable`
  // explanations (the entire value of this path) harder for the caller to
  // read, not safer.
  if (parsed.items.length === 0) {
    return json(200, { reviewId: null, itemCount: 0, missCount: 0, unreadable: parsed.unreadable })
  }

  const { data: review, error: reviewErr } = await admin.from('quiz_reviews').insert({
    lecture_id: lectureId,
    user_id: auth.userId,
    source: imageBase64 ? 'image' : 'text',
    // The screenshot itself is never stored — only pasted text is kept, so a
    // re-parse doesn't mean retyping the quiz.
    raw_input: text ?? null,
    quiz_title: parsed.quiz_title,
    score_correct: parsed.score_correct,
    score_total: parsed.score_total,
    status: 'awaiting_confirmation',
  }).select('id').single()
  if (reviewErr || !review) {
    return json(500, { error: `Could not save the quiz: ${reviewErr?.message ?? 'no row returned'}` })
  }

  const { error: itemsErr } = await admin.from('quiz_review_items').insert(
    parsed.items.map((it) => ({
      review_id: review.id,
      position: it.position,
      question_text: it.question_text,
      question_type: it.question_type,
      options: it.options,
      student_answer: it.student_answer,
      correct_answer: it.correct_answer,
      is_correct: it.is_correct,
      // 'not-applicable' is distinct from 'pending' on purpose: "nothing to
      // diagnose here" and "not diagnosed yet" must never render alike.
      diagnosis_status: it.is_correct ? 'not-applicable' : 'pending',
    }))
  )
  if (itemsErr) {
    // Roll the parent back rather than leaving a review with no questions in
    // it. The delete's own {error} is checked too: on a double fault the
    // response must still be an honest 500, but say so explicitly so the
    // failure is legible to whoever has to clean up the orphaned row.
    const { error: delErr } = await admin.from('quiz_reviews').delete().eq('id', review.id)
    const message = delErr
      ? `Could not save the quiz questions: ${itemsErr.message}. Cleanup of the partial review also failed: ${delErr.message}. Review ${review.id} may need manual deletion.`
      : `Could not save the quiz questions: ${itemsErr.message}`
    return json(500, { error: message })
  }

  return json(200, {
    reviewId: review.id,
    itemCount: parsed.items.length,
    missCount: parsed.items.filter((i) => !i.is_correct).length,
    unreadable: parsed.unreadable,
    // Returned so the confirm gate can show a reported-vs-parsed mismatch.
    // Never reconciled server-side: the disagreement is itself informative.
    scoreCorrect: parsed.score_correct,
    scoreTotal: parsed.score_total,
  })
})
