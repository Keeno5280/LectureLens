import { runStructured, type ClaudeLike, type ContentBlock, type ImageMediaType } from './claude.ts'
import { ParsedQuizSchema, type ParsedQuiz } from './schemas.ts'
import { QUIZ_PARSER_SYSTEM } from './prompts.ts'

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
