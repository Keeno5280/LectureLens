import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@^0.120.0'
import { authorizeQuizItemAccess, type QuizAuthResult } from '../_shared/auth.ts'
import { buildDiagnosisInput, diagnoseMiss } from '../_shared/quiz.ts'
import { verifyCitations } from '../_shared/citations.ts'
import { buildCorsHeaders } from '../_shared/cors.ts'
import type { Claim, Distinction } from '../_shared/schemas.ts'

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
const cors = buildCorsHeaders(APP_ORIGIN)
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let itemId: string | undefined
  try {
    ;({ itemId } = await req.json())
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  if (!itemId) return json(400, { error: 'itemId is required' })

  // Identity → ownership → privileged work. `itemId` is client-supplied and
  // nothing has checked it belongs to the caller.
  let auth: QuizAuthResult
  try {
    auth = await authorizeQuizItemAccess(
      {
        getUserFromToken: async (token) => {
          const scoped = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
          const { data, error } = await scoped.auth.getUser()
          // A transient error validating the token must not be indistinguishable
          // from "no user" — that would surface as a misleading 401 'invalid or
          // expired token' instead of an honest 500. Throwing here is caught by
          // the surrounding try/catch, which replies with a CORS'd JSON 500.
          if (error) throw new Error(`Could not verify the caller's identity: ${error.message}`)
          return data.user ? { id: data.user.id } : null
        },
        getItem: async (id) => {
          const { data, error } = await admin.from('quiz_review_items')
            .select('id, review_id, is_correct, question_text, question_type, options, student_answer, correct_answer')
            .eq('id', id).maybeSingle()
          // A transient DB error must not be indistinguishable from "not
          // found" — that would surface as a false 404 instead of an honest
          // 500. Throwing here is caught by the surrounding try/catch below.
          if (error) throw new Error(`Could not look up the quiz item: ${error.message}`)
          return data ?? null
        },
        getReview: async (id) => {
          const { data, error } = await admin.from('quiz_reviews')
            .select('id, user_id, lecture_id').eq('id', id).maybeSingle()
          if (error) throw new Error(`Could not look up the quiz review: ${error.message}`)
          return data ?? null
        },
        // Ownership only — deliberately just the two columns the check needs.
        // The lecture's CONTENT is loaded further down, after authorization,
        // and the two selects share no columns.
        //
        // The review owning the caller is NOT enough: `quiz_reviews.lecture_id`
        // is writable by the row's owner (RLS scopes the UPDATE by user_id, not
        // by column), so a review can legitimately be theirs while the lecture
        // it names is somebody else's. Without this the function would quote a
        // stranger's lecture into the caller's own row.
        getLecture: async (id) => {
          const { data, error } = await admin.from('lectures')
            .select('id, user_id').eq('id', id).maybeSingle()
          if (error) throw new Error(`Could not look up the lecture: ${error.message}`)
          return data ?? null
        },
      },
      req.headers.get('Authorization'),
      itemId,
    )
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
  if (!auth.ok) return json(auth.status, { error: auth.error })

  // Diagnosing a question the student got right wastes their time and reads as
  // an accusation. This is a 400, not a silent no-op.
  if (auth.item.is_correct) {
    return json(400, { error: 'This question was answered correctly; there is nothing to diagnose.' })
  }

  const fail = async (message: string) => {
    const { error: failErr } = await admin.from('quiz_review_items').update({
      diagnosis_status: 'failed',
      diagnosis_error: message.slice(0, 500),
    }).eq('id', itemId)
    // If this write itself fails, the item is stranded at 'diagnosing' while
    // the caller sees a 500 — the UI's Retry is keyed off diagnosis_status,
    // so silently discarding this error would defeat the failed state's
    // entire purpose. The response is still the honest 500 either way.
    if (failErr) console.error(`diagnose-miss: could not mark item ${itemId} failed`, failErr)
    return json(500, { error: message })
  }

  try {
    // Keyed off the lecture the AUTHORIZER cleared, not off
    // `auth.review.lecture_id` again: reading the id back off the review a
    // second time is how a check and the work it guards drift apart.
    const { data: lecture, error: lecErr } = await admin.from('lectures')
      .select('title, transcript, claims, distinctions')
      .eq('id', auth.lecture.id).maybeSingle()
    if (lecErr) return await fail(`Could not load the lecture: ${lecErr.message}`)
    if (!lecture) {
      // The review as a whole cannot proceed — every remaining item would fail
      // the same way. This is the one case that marks the REVIEW failed rather
      // than just the item, so the UI stops offering a Retry that cannot work.
      const { error: revFailErr } = await admin.from('quiz_reviews').update({
        status: 'failed',
        processing_error: 'The lecture this quiz belongs to has been deleted.',
      }).eq('id', auth.review.id)
      // If this write fails, the review is stranded permanently: every future
      // call for it hits this same branch, so nothing ever retries it. At
      // minimum this must be logged rather than silently swallowed.
      if (revFailErr) console.error(`diagnose-miss: could not mark review ${auth.review.id} failed`, revFailErr)
      return await fail('The lecture this quiz belongs to no longer exists.')
    }

    const claims: Claim[] = Array.isArray(lecture.claims) ? lecture.claims : []
    const distinctions: Distinction[] = Array.isArray(lecture.distinctions) ? lecture.distinctions : []

    const { error: markErr } = await admin.from('quiz_review_items')
      .update({ diagnosis_status: 'diagnosing', diagnosis_error: null }).eq('id', itemId)
    if (markErr) return await fail(`Could not mark the question as diagnosing: ${markErr.message}`)

    const input = buildDiagnosisInput({
      question: {
        question_text: auth.item.question_text,
        question_type: auth.item.question_type,
        options: Array.isArray(auth.item.options) ? (auth.item.options as string[]) : [],
        student_answer: auth.item.student_answer,
        correct_answer: auth.item.correct_answer,
      },
      lecture: {
        title: lecture.title ?? undefined,
        transcript: lecture.transcript,
        claims,
        distinctions,
      },
    })

    const diagnosis = await diagnoseMiss(
      new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! }),
      input,
    )

    // Citations are VERIFIED, not trusted. Anything the model quoted that does
    // not actually appear in the transcript or in a stored claim is dropped
    // before it can be shown to a student who came here precisely because they
    // do not know the material well enough to catch it.
    const { verified, rejected } = verifyCitations(diagnosis.citations, {
      transcript: lecture.transcript,
      claimQuotes: claims.map((c) => c.quote),
    })

    // 'not-in-lecture' means there was nothing to cite. Enforced here rather
    // than trusted from the model: the schema allows an empty array, and this
    // makes the combination impossible instead of merely discouraged.
    const citations = diagnosis.lecture_coverage === 'not-in-lecture' ? [] : verified

    if (rejected.length) {
      console.warn(`diagnose-miss: dropped ${rejected.length} unverifiable citation(s) for item ${itemId}`)
    }

    // The count is PERSISTED, not just logged. A 'covered' diagnosis whose
    // every quote was fabricated and rejected renders identically to one the
    // model simply chose not to cite — and a server log is not a signal the
    // student will ever see. This number is the only warning anyone gets that
    // the model made quotes up, so it goes where the card can read it.
    //
    // It counts quotes that FAILED VERIFICATION and nothing else. Citations
    // discarded just above because coverage is 'not-in-lecture' are not counted:
    // those were dropped by policy, not because they could not be matched, and
    // that case already has its own banner on the card saying so.
    const { error: saveErr } = await admin.from('quiz_review_items').update({
      diagnosis: { ...diagnosis, citations },
      confusion_tags: diagnosis.confusion_tags,
      lecture_coverage: diagnosis.lecture_coverage,
      dropped_citations: rejected.length,
      diagnosis_status: 'completed',
      diagnosis_error: null,
    }).eq('id', itemId)
    if (saveErr) return await fail(`Could not save the diagnosis: ${saveErr.message}`)

    // Roll the parent review up. Done here rather than in the browser so that
    // closing the tab cannot strand a review in 'diagnosing' forever — the last
    // invocation to finish is the one that closes it out.
    const { data: outstanding, error: outErr } = await admin.from('quiz_review_items')
      .select('id').eq('review_id', auth.review.id).in('diagnosis_status', ['pending', 'diagnosing'])
    if (outErr) {
      // The diagnosis itself is saved; only the roll-up failed. Report it
      // rather than pretending, but do not mark the item failed.
      console.error('diagnose-miss: review roll-up failed', outErr)
    } else if (!outstanding?.length) {
      const { error: revErr } = await admin.from('quiz_reviews')
        .update({ status: 'completed' }).eq('id', auth.review.id)
      if (revErr) console.error('diagnose-miss: could not complete review', revErr)
    }

    return json(200, { status: 'completed', droppedCitations: rejected.length })
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e))
  }
})
