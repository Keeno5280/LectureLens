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

import { buildDiagnosisInput, diagnoseMiss } from './quiz'

const REQ = {
  question: {
    question_text: 'Good systems are enough to transform people.',
    question_type: 'true_false',
    options: [] as string[],
    student_answer: 'True',
    correct_answer: 'False',
  },
  lecture: {
    title: 'Week 1 — Worldview',
    transcript: 'Systems restrain behaviour. They cannot produce a new heart.',
    claims: [{
      statement: 'Systems cannot transform',
      quote: 'They cannot produce a new heart',
      emphasis: 'flagged' as const,
      contested: false,
    }],
    distinctions: [{
      this_: 'transformation',
      not_that: 'behaviour change',
      why_confusable: 'both show up as different conduct',
    }],
  },
}

const DIAGNOSIS = {
  lecture_coverage: 'covered' as const,
  correct_answer: 'False',
  why_correct: 'It is a claim about sufficiency.',
  citations: [{ quote: 'They cannot produce a new heart', supports: 'Systems are insufficient' }],
  where_it_went_sideways: [{ confusion: 'Read tone, not claim', explanation: 'It sounds like a compliment.' }],
  collapsed_distinction: { this_: 'transformation', not_that: 'behaviour change' },
  dont_overcorrect: 'Systems still matter.',
  what_this_miss_was_not: 'Not careless.',
  remember_this: 'Systems shape behaviour; they do not change hearts.',
  why_it_matters: 'It decides how you respond to sin in a team.',
  confusion_tags: ['absolutizing-word' as const],
}

describe('buildDiagnosisInput', () => {
  it('includes the question, the student answer and the correct answer', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toContain('Good systems are enough to transform people.')
    expect(text).toContain('True')
    expect(text).toContain('False')
  })

  it('labels the student answer unambiguously so the model cannot swap them', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toMatch(/THE STUDENT ANSWERED:\s*True/)
    expect(text).toMatch(/THE CORRECT ANSWER (IS|WAS):\s*False/)
  })

  it('includes claim quotes verbatim so citations have something to match', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toContain('They cannot produce a new heart')
  })

  it('includes distinctions — a wrong answer is usually a collapsed one', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toContain('transformation')
    expect(text).toContain('behaviour change')
  })

  it('says plainly when there is no transcript rather than sending an empty section', () => {
    const text = (buildDiagnosisInput({
      ...REQ, lecture: { ...REQ.lecture, transcript: null },
    })[0] as { text: string }).text
    expect(text).toMatch(/no transcript/i)
  })

  it('renders multiple-choice options so the model can see the distractors', () => {
    const text = (buildDiagnosisInput({
      ...REQ,
      question: { ...REQ.question, question_type: 'multiple_choice', options: ['Alpha', 'Beta'] },
    })[0] as { text: string }).text
    expect(text).toContain('Alpha')
    expect(text).toContain('Beta')
  })

  it('handles a null student answer without printing "null" at the student', () => {
    const text = (buildDiagnosisInput({
      ...REQ, question: { ...REQ.question, student_answer: null },
    })[0] as { text: string }).text
    expect(text).not.toMatch(/THE STUDENT ANSWERED:\s*null/)
  })
})

describe('diagnoseMiss', () => {
  it('calls Claude with the diagnostician prompt and the pinned model', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: DIAGNOSIS, stop_reason: 'end_turn' })
    await diagnoseMiss({ messages: { parse } }, [{ type: 'text', text: 'x' }])

    const args = parse.mock.calls[0][0] as Record<string, unknown>
    expect(args.model).toBe('claude-opus-5')
    expect(args.max_tokens).toBe(16000)
    expect(args.system).toMatch(/VERBATIM/)
  })

  it('returns the validated diagnosis', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: DIAGNOSIS, stop_reason: 'end_turn' })
    expect(await diagnoseMiss({ messages: { parse } }, [{ type: 'text', text: 'x' }])).toEqual(DIAGNOSIS)
  })

  it('throws on a truncated diagnosis rather than storing half an explanation', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: DIAGNOSIS, stop_reason: 'max_tokens' })
    await expect(diagnoseMiss({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/truncated/i)
  })
})
