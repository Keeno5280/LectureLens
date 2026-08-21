import { describe, it, expect, vi } from 'vitest'
import { buildParseInput, parseQuiz } from './quiz'

const PARSED = {
  quiz_title: null, score_correct: null, score_total: null,
  items: [], unreadable: [],
}

describe('buildParseInput', () => {
  it('sends pasted text as a text block', () => {
    expect(buildParseInput({ text: 'Q1. What is a worldview?' }))
      .toEqual([{ type: 'text', text: 'Q1. What is a worldview?' }])
  })

  it('sends a screenshot as an image block with its media type', () => {
    expect(buildParseInput({ imageBase64: 'iVBOR', imageMediaType: 'image/png' }))
      .toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }])
  })

  it('throws on empty text rather than sending an empty prompt', () => {
    expect(() => buildParseInput({ text: '   ' })).toThrow(/empty/i)
  })

  it('throws when given neither text nor an image', () => {
    expect(() => buildParseInput({})).toThrow(/text or an image/i)
  })

  it('throws when an image is supplied without a media type', () => {
    expect(() => buildParseInput({ imageBase64: 'iVBOR' })).toThrow(/media type/i)
  })
})

describe('parseQuiz', () => {
  it('calls Claude with the parser prompt, pinned model and ceiling', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: PARSED, stop_reason: 'end_turn' })
    await parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }])

    const args = parse.mock.calls[0][0] as Record<string, unknown>
    expect(args.model).toBe('claude-opus-5')
    expect(args.max_tokens).toBe(16000)
    expect(args.system).toMatch(/STRUCTURAL EXTRACTION ONLY/)
    expect(args).not.toHaveProperty('thinking')
  })

  it('returns the validated parsed quiz', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: PARSED, stop_reason: 'end_turn' })
    expect(await parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }])).toEqual(PARSED)
  })

  it('throws on a truncated response instead of storing a half-read quiz', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: PARSED, stop_reason: 'max_tokens' })
    await expect(parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/truncated/i)
  })

  it('throws when parsed_output is null', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: null, stop_reason: 'end_turn' })
    await expect(parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/no structured output/i)
  })
})
