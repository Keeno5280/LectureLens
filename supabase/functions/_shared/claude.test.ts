import { describe, it, expect, vi } from 'vitest'
import { buildAnalysisInput, analyzeLecture, MODEL, MAX_TOKENS } from './claude'

const ANALYSIS = {
  summary_overview: 's', key_points: [], important_terms: [],
  exam_questions: [], flashcards: [], claims: [], distinctions: [],
}

describe('buildAnalysisInput', () => {
  it('sends a transcript as a text block for audio', () => {
    const blocks = buildAnalysisInput({ file_type: 'audio', transcript: 'hello lecture' })
    expect(blocks).toEqual([{ type: 'text', text: 'hello lecture' }])
  })

  it('treats video the same as audio — it fell off the old n8n switch entirely', () => {
    const blocks = buildAnalysisInput({ file_type: 'video', transcript: 'hello lecture' })
    expect(blocks).toEqual([{ type: 'text', text: 'hello lecture' }])
  })

  it('sends slides as a PDF document block, not extracted text', () => {
    const blocks = buildAnalysisInput({ file_type: 'slides', transcript: null, pdfBase64: 'JVBER' })
    expect(blocks[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' },
    })
  })

  it('throws when audio has no transcript rather than sending an empty prompt', () => {
    expect(() => buildAnalysisInput({ file_type: 'audio', transcript: '' }))
      .toThrow(/transcript/i)
  })

  it('throws on an unknown file_type instead of silently producing nothing', () => {
    expect(() => buildAnalysisInput({ file_type: 'zip', transcript: 'x' }))
      .toThrow(/file_type/i)
  })
})

describe('analyzeLecture', () => {
  it('calls Claude with the pinned model and token ceiling', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: ANALYSIS })
    await analyzeLecture({ messages: { parse } }, [{ type: 'text', text: 'x' }])

    const args = parse.mock.calls[0][0] as Record<string, unknown>
    expect(args.model).toBe('claude-opus-5')
    expect(args.max_tokens).toBe(16000)
    expect(args).toHaveProperty('output_config')
    expect(args).not.toHaveProperty('output_format')   // deprecated
    expect(args).not.toHaveProperty('thinking')        // budget_tokens 400s on opus-5
  })

  it('returns the validated parsed_output', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: ANALYSIS })
    const out = await analyzeLecture({ messages: { parse } }, [{ type: 'text', text: 'x' }])
    expect(out).toEqual(ANALYSIS)
  })

  it('throws when parsed_output is null instead of writing garbage to the DB', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: null })
    await expect(analyzeLecture({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/structured output/i)
  })

  it('exports the pinned constants', () => {
    expect(MODEL).toBe('claude-opus-5')
    expect(MAX_TOKENS).toBe(16000)
  })

  it('throws on a truncated response instead of writing a silently incomplete analysis', async () => {
    // stop_reason: 'max_tokens' with a parsed_output that still looks usable —
    // truncation can land mid-object and still parse, so the null check alone
    // would miss this and let a partial analysis through as 'completed'.
    const parse = vi.fn().mockResolvedValue({ parsed_output: ANALYSIS, stop_reason: 'max_tokens' })
    await expect(analyzeLecture({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/too long|truncat/i)
  })
})
