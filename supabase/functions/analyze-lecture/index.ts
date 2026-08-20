import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { authorizeLectureAccess } from '../_shared/auth.ts'
import { buildAnalysisInput, analyzeLecture } from '../_shared/claude.ts'

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
const cors = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let lectureId: string | undefined
  try {
    ;({ lectureId } = await req.json())
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  if (!lectureId) return json(400, { error: 'lectureId is required' })

  // Identity → ownership → privileged work. Never reorder.
  const auth = await authorizeLectureAccess(
    {
      getUserFromToken: async (token) => {
        const scoped = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
        const { data } = await scoped.auth.getUser()
        return data.user ? { id: data.user.id } : null
      },
      getLecture: async (id) => {
        const { data } = await admin.from('lectures').select('*').eq('id', id).maybeSingle()
        return data ?? null
      },
    },
    req.headers.get('Authorization'),
    lectureId,
  )
  if (!auth.ok) return json(auth.status, { error: auth.error })

  const fail = async (message: string) => {
    await admin.from('lectures').update({
      processing_status: 'failed',
      processing_error: message.slice(0, 500),
    }).eq('id', lectureId)
    return json(500, { error: message })
  }

  try {
    await admin.from('lectures')
      .update({ processing_status: 'analyzing', processing_error: null })
      .eq('id', lectureId)

    let pdfBase64: string | undefined
    if ((auth.lecture.file_type ?? '').toLowerCase() === 'slides') {
      const path = new URL(auth.lecture.file_url!).pathname
        .split('/lecture-uploads/')[1]
      const { data: blob, error } = await admin.storage.from('lecture-uploads').download(path)
      if (error || !blob) return await fail(`Could not download slides: ${error?.message ?? 'not found'}`)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      pdfBase64 = btoa(bin)
    }

    const input = buildAnalysisInput({ ...auth.lecture, pdfBase64 })
    const analysis = await analyzeLecture(
      new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! }),
      input,
    )

    // Write to `lectures` — it is the ONLY table in the realtime publication.
    const { error: upErr } = await admin.from('lectures').update({
      summary_overview: analysis.summary_overview,
      key_points: analysis.key_points,
      important_terms: analysis.important_terms,
      exam_questions: analysis.exam_questions,
      claims: analysis.claims,
      distinctions: analysis.distinctions,
      processing_status: 'completed',
      processing_error: null,
      processed_at: new Date().toISOString(),
    }).eq('id', lectureId)
    if (upErr) return await fail(`Could not save analysis: ${upErr.message}`)

    if (analysis.flashcards.length) {
      await admin.from('flashcards').insert(analysis.flashcards.map((f) => ({
        lecture_id: lectureId, user_id: auth.userId,
        question: f.front, answer: f.back,
        difficulty: 'medium', is_auto_generated: true,
      })))
    }
    if (analysis.important_terms.length) {
      await admin.from('key_terms').insert(analysis.important_terms.map((t) => ({
        lecture_id: lectureId, term: t.term, definition: t.definition,
      })))
    }

    return json(200, { status: 'completed' })
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e))
  }
})
