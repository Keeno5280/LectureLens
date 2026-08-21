import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { LectureAnalysisSchema, type LectureAnalysis } from './schemas.ts'
import { LECTURE_ANALYST_SYSTEM } from './prompts.ts'

export const MODEL = 'claude-opus-5'
export const MAX_TOKENS = 16000

/** The media types the Messages API accepts for image blocks. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }

/** Structural type so tests can inject a fake with no API key and no network. */
export interface ClaudeLike {
  messages: { parse(args: unknown): Promise<{ parsed_output: unknown; stop_reason: string | null }> }
}

export function buildAnalysisInput(lecture: {
  file_type: string | null
  transcript: string | null
  pdfBase64?: string
}): ContentBlock[] {
  const kind = (lecture.file_type ?? 'audio').toLowerCase().trim()

  if (kind === 'audio' || kind === 'video') {
    if (!lecture.transcript?.trim()) {
      throw new Error('No transcript available for this lecture; cannot analyze audio/video.')
    }
    return [{ type: 'text', text: lecture.transcript }]
  }

  if (kind === 'slides') {
    if (!lecture.pdfBase64) throw new Error('No PDF data available for slides lecture.')
    return [{
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: lecture.pdfBase64 },
    }]
  }

  throw new Error(`Unsupported file_type: ${kind}`)
}

/**
 * One structured Claude call, with the truncation check every caller needs.
 *
 * Extracted so the `stop_reason === 'max_tokens'` check below lives in exactly
 * one place. Three callers copy-pasting it is three chances for one copy to
 * drift, and the failure mode of a missing check is silent: a response cut off
 * mid-generation still parses into a syntactically valid object.
 */
export async function runStructured<T>(
  client: ClaudeLike,
  args: { system: string; input: ContentBlock[]; schema: z.ZodType<T> },
): Promise<T> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: args.system,
    messages: [{ role: 'user', content: args.input }],
    output_config: { format: zodOutputFormat(args.schema) },
  })

  // Checked BEFORE the null check: `parsed_output` being non-null does not
  // mean the response is complete.
  if (res.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude's response was truncated at the ${MAX_TOKENS}-token output limit before it ` +
      'finished. Retrying will hit the same wall every time, because the input never changes.'
    )
  }

  if (!res.parsed_output) {
    throw new Error('Claude returned no structured output (parsed_output was null).')
  }
  return args.schema.parse(res.parsed_output)
}

export async function analyzeLecture(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<LectureAnalysis> {
  return await runStructured(client, {
    system: LECTURE_ANALYST_SYSTEM,
    input,
    schema: LectureAnalysisSchema,
  })
}
