import { runStructured, type ClaudeLike, type ContentBlock, type ImageMediaType } from './claude.ts'
import { ParsedQuizSchema, type ParsedQuiz, DiagnosisSchema, type Diagnosis, type Claim, type Distinction } from './schemas.ts'
import { QUIZ_PARSER_SYSTEM, MISS_DIAGNOSTICIAN_SYSTEM } from './prompts.ts'

export interface ParseSource {
  text?: string
  imageBase64?: string
  imageMediaType?: ImageMediaType
}

/**
 * Screenshots are read and discarded — the base64 never reaches storage.
 * The handover records 382MB of orphaned objects against a 1GB free tier;
 * there is no reason to add an image we read exactly once.
 */
export function buildParseInput(src: ParseSource): ContentBlock[] {
  if (src.text !== undefined) {
    if (!src.text.trim()) throw new Error('Pasted quiz text is empty.')
    return [{ type: 'text', text: src.text }]
  }

  if (src.imageBase64) {
    if (!src.imageMediaType) throw new Error('An image requires a media type.')
    return [{
      type: 'image',
      source: { type: 'base64', media_type: src.imageMediaType, data: src.imageBase64 },
    }]
  }

  throw new Error('Provide either quiz text or an image.')
}

export async function parseQuiz(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<ParsedQuiz> {
  return await runStructured(client, {
    system: QUIZ_PARSER_SYSTEM,
    input,
    schema: ParsedQuizSchema,
  })
}

export interface DiagnosisRequest {
  question: {
    question_text: string
    question_type: string
    options: string[]
    student_answer: string | null
    correct_answer: string | null
  }
  lecture: {
    title?: string
    /** Null for `slides` lectures — Phase 1 never stores a transcript for them. */
    transcript: string | null
    claims: Claim[]
    distinctions: Distinction[]
  }
}

/**
 * Assembles the whole diagnosis prompt as one text block.
 *
 * Claim quotes are included VERBATIM and unabridged: they are the corpus the
 * citation verifier later checks the model's quotes against, so paraphrasing
 * them here would guarantee every citation is rejected.
 *
 * The student's answer and the correct answer are labelled in caps and on
 * their own lines. Prose like "the student said True but the answer is False"
 * is exactly the kind of sentence a model can read backwards, and a diagnosis
 * built on a swapped pair is fluent, confident and about the wrong mistake.
 */
export function buildDiagnosisInput(req: DiagnosisRequest): ContentBlock[] {
  const { question: q, lecture: l } = req
  const parts: string[] = []

  parts.push('# THE QUESTION THE STUDENT MISSED\n')
  parts.push(q.question_text)
  if (q.options.length) {
    parts.push('\nOptions:')
    for (const o of q.options) parts.push(`- ${o}`)
  }
  parts.push('')
  parts.push(`THE STUDENT ANSWERED: ${q.student_answer ?? '(not recorded)'}`)
  parts.push(`THE CORRECT ANSWER IS: ${q.correct_answer ?? '(not recorded)'}`)

  parts.push('\n# THE LECTURE')
  if (l.title) parts.push(`Title: ${l.title}`)

  parts.push('\n## Claims the lecturer made')
  if (l.claims.length) {
    for (const c of l.claims) {
      parts.push(`- ${c.statement}`)
      parts.push(`  Verbatim: "${c.quote}"`)
      parts.push(`  Emphasis: ${c.emphasis}${c.contested ? ' — CONTESTED across traditions' : ''}`)
    }
  } else {
    parts.push('(none recorded)')
  }

  parts.push('\n## Distinctions the lecturer drew')
  if (l.distinctions.length) {
    for (const d of l.distinctions) {
      parts.push(`- "${d.this_}" is NOT "${d.not_that}" — confusable because ${d.why_confusable}`)
    }
  } else {
    parts.push('(none recorded)')
  }

  parts.push('\n## Transcript')
  parts.push(
    l.transcript?.trim()
      ? l.transcript
      : '(No transcript is available for this lecture — it was uploaded as slides. ' +
        'The claims above are the only record of what was said.)'
  )

  return [{ type: 'text', text: parts.join('\n') }]
}

export async function diagnoseMiss(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<Diagnosis> {
  return await runStructured(client, {
    system: MISS_DIAGNOSTICIAN_SYSTEM,
    input,
    schema: DiagnosisSchema,
  })
}
