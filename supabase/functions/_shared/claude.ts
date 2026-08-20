import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { LectureAnalysisSchema, type LectureAnalysis } from './schemas.ts'
import { LECTURE_ANALYST_SYSTEM } from './prompts.ts'

export const MODEL = 'claude-opus-5'
export const MAX_TOKENS = 16000

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

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

export async function analyzeLecture(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<LectureAnalysis> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: LECTURE_ANALYST_SYSTEM,
    messages: [{ role: 'user', content: input }],
    output_config: { format: zodOutputFormat(LectureAnalysisSchema) },
  })

  // Check truncation BEFORE the null check: a response cut off mid-generation
  // can still parse into a syntactically valid (but incomplete) object, so
  // `parsed_output` being non-null does not mean the analysis is complete.
  // Confirmed against node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts —
  // `stop_reason: StopReason | null` is on `Message`, and `ParsedMessage<T> = Message
  // & { parsed_output: T | null }` (lib/parser.d.ts), so `messages.parse()` surfaces it.
  // 'max_tokens' is the exact StopReason enum value for hitting the requested ceiling.
  if (res.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude's response was truncated at the ${MAX_TOKENS}-token output limit before it ` +
      'finished the analysis. This lecture is too long to analyze in a single pass — retrying ' +
      'will hit the same wall every time, because the input never changes.'
    )
  }

  if (!res.parsed_output) {
    throw new Error('Claude returned no structured output (parsed_output was null).')
  }
  return LectureAnalysisSchema.parse(res.parsed_output)
}
