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


import { ParsedQuizSchema, DiagnosisSchema } from './schemas'

const validParsed = {
  quiz_title: 'Week 01 Quiz',
  score_correct: 3,
  score_total: 4,
  items: [{
    position: 4,
    question_text: 'Good systems are enough to transform people.',
    question_type: 'true_false' as const,
    options: [],
    student_answer: 'True',
    correct_answer: 'False',
    is_correct: false,
  }],
  unreadable: [],
}

const validDiagnosis = {
  lecture_coverage: 'covered' as const,
  correct_answer: 'False',
  why_correct: 'The claim is about sufficiency, and systems are necessary but not sufficient.',
  citations: [{ quote: 'the law, weakened by the flesh, could not do', supports: 'Systems cannot transform' }],
  where_it_went_sideways: [{
    confusion: 'Agreed with the sentiment instead of evaluating the claim',
    explanation: 'The sentence reads as a compliment to good systems, so it got a nod.',
  }],
  collapsed_distinction: { this_: 'transformation', not_that: 'behavior change' },
  dont_overcorrect: 'False does not mean systems are worthless.',
  what_this_miss_was_not: 'Not careless — this question required judgment.',
  remember_this: 'Systems shape behavior; only the Spirit changes hearts.',
  why_it_matters: 'It is the difference between managing souls and shepherding them.',
  confusion_tags: ['absolutizing-word' as const, 'collapsed-distinction' as const],
}

describe('ParsedQuizSchema', () => {
  it('accepts a well-formed parsed quiz', () => {
    expect(ParsedQuizSchema.parse(validParsed)).toEqual(validParsed)
  })

  it('allows a null student_answer — an unreadable screenshot must not be guessed', () => {
    const p = { ...validParsed, items: [{ ...validParsed.items[0], student_answer: null }] }
    expect(() => ParsedQuizSchema.parse(p)).not.toThrow()
  })

  it('allows a null score — not every results page reports one', () => {
    const p = { ...validParsed, score_correct: null, score_total: null }
    expect(() => ParsedQuizSchema.parse(p)).not.toThrow()
  })

  it('rejects a position below 1', () => {
    const p = { ...validParsed, items: [{ ...validParsed.items[0], position: 0 }] }
    expect(() => ParsedQuizSchema.parse(p)).toThrow()
  })

  it('rejects an unknown question_type', () => {
    const p = { ...validParsed, items: [{ ...validParsed.items[0], question_type: 'essay' }] }
    expect(() => ParsedQuizSchema.parse(p)).toThrow()
  })
})

describe('DiagnosisSchema', () => {
  it('accepts a well-formed diagnosis', () => {
    expect(DiagnosisSchema.parse(validDiagnosis)).toEqual(validDiagnosis)
  })

  it('accepts a null collapsed_distinction — not every miss is a collapsed distinction', () => {
    expect(() => DiagnosisSchema.parse({ ...validDiagnosis, collapsed_distinction: null })).not.toThrow()
  })

  it('accepts zero citations when the lecture did not cover the question', () => {
    const d = { ...validDiagnosis, lecture_coverage: 'not-in-lecture' as const, citations: [] }
    expect(() => DiagnosisSchema.parse(d)).not.toThrow()
  })

  it('rejects an out-of-enum confusion tag — free text would not cluster', () => {
    const d = { ...validDiagnosis, confusion_tags: ['did-not-study'] }
    expect(() => DiagnosisSchema.parse(d)).toThrow()
  })

  it("accepts 'other' as a confusion tag — the escape hatch for when nothing in the closed vocabulary fits", () => {
    const d = { ...validDiagnosis, confusion_tags: ['other' as const] }
    expect(() => DiagnosisSchema.parse(d)).not.toThrow()
  })

  it('still rejects a genuinely invented tag now that other exists — the enum stays closed', () => {
    const d = { ...validDiagnosis, confusion_tags: ['absolutizing-word', 'made-up-tag'] }
    expect(() => DiagnosisSchema.parse(d)).toThrow()
  })

  it('rejects an empty confusion_tags array — an untagged miss is invisible to the pattern pass', () => {
    expect(() => DiagnosisSchema.parse({ ...validDiagnosis, confusion_tags: [] })).toThrow()
  })

  it('rejects an empty where_it_went_sideways — "incorrect" is not a diagnosis', () => {
    expect(() => DiagnosisSchema.parse({ ...validDiagnosis, where_it_went_sideways: [] })).toThrow()
  })
})
