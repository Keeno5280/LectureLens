import { describe, it, expect } from 'vitest'
import { LectureAnalysisSchema } from './schemas'

const valid = {
  summary_overview: 'A lecture about worldview.',
  key_points: ['Worldview shapes action'],
  important_terms: [{ term: 'Worldview', definition: 'The lens you interpret everything through' }],
  exam_questions: ['What four things does a worldview shape?'],
  flashcards: [{ front: 'What is a worldview?', back: 'The interpretive lens' }],
  claims: [{
    statement: 'Systems cannot transform people',
    quote: 'the law, weakened by the flesh, could not do',
    emphasis: 'flagged' as const,
    contested: false,
  }],
  distinctions: [{
    this_: 'transformation',
    not_that: 'behavior change',
    why_confusable: 'both produce visible differences in conduct',
  }],
}

describe('LectureAnalysisSchema', () => {
  it('accepts a well-formed analysis', () => {
    expect(LectureAnalysisSchema.parse(valid)).toEqual(valid)
  })

  it('accepts empty arrays — an unaddressed topic must not be invented', () => {
    const empty = { ...valid, claims: [], distinctions: [], flashcards: [], key_points: [], exam_questions: [], important_terms: [] }
    expect(() => LectureAnalysisSchema.parse(empty)).not.toThrow()
  })

  it('rejects an unknown emphasis value', () => {
    const bad = { ...valid, claims: [{ ...valid.claims[0], emphasis: 'very-important' }] }
    expect(() => LectureAnalysisSchema.parse(bad)).toThrow()
  })

  it('rejects a claim missing its quote', () => {
    const bad = { ...valid, claims: [{ statement: 'x', emphasis: 'passing', contested: false }] }
    expect(() => LectureAnalysisSchema.parse(bad)).toThrow()
  })
})
