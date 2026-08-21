import { describe, it, expect } from 'vitest'
import { summarizeTags, describePattern, MIN_QUIZZES_FOR_PATTERN } from './patterns'
import type { QuizReviewItem } from './types'

const item = (over: Partial<QuizReviewItem> = {}): QuizReviewItem => ({
  id: 'item-1',
  review_id: 'rev-1',
  position: 1,
  question_text: 'Is the law weak?',
  question_type: 'true_false',
  options: [],
  student_answer: 'True',
  correct_answer: 'False',
  is_correct: false,
  diagnosis: null,
  confusion_tags: [],
  lecture_coverage: null,
  dropped_citations: 0,
  diagnosis_status: 'pending',
  diagnosis_error: null,
  ...over,
})

describe('summarizeTags', () => {
  it('counts tags across completed items and orders by count desc, then tag name', () => {
    const items = [
      item({ id: 'a', position: 1, diagnosis_status: 'completed', confusion_tags: ['collapsed-distinction'] }),
      item({ id: 'b', position: 2, diagnosis_status: 'completed', confusion_tags: ['collapsed-distinction'] }),
      item({ id: 'c', position: 3, diagnosis_status: 'completed', confusion_tags: ['careless'] }),
      item({ id: 'd', position: 4, diagnosis_status: 'completed', confusion_tags: ['recall-gap'] }),
    ]

    const out = summarizeTags(items)

    expect(out).toEqual([
      { tag: 'collapsed-distinction', count: 2, positions: [1, 2] },
      { tag: 'careless', count: 1, positions: [3] },
      { tag: 'recall-gap', count: 1, positions: [4] },
    ])
  })

  it('breaks a tie in count by tag name, ascending', () => {
    const items = [
      item({ id: 'a', position: 1, diagnosis_status: 'completed', confusion_tags: ['wrong-category'] }),
      item({ id: 'b', position: 2, diagnosis_status: 'completed', confusion_tags: ['careless'] }),
    ]

    const out = summarizeTags(items)

    expect(out.map((c) => c.tag)).toEqual(['careless', 'wrong-category'])
  })

  it('ignores items that were never diagnosed, even if confusion_tags is populated', () => {
    // diagnosis_status only reaches 'completed' after diagnose-miss writes the
    // diagnosis, but nothing stops a stale or malformed row from carrying
    // leftover tags at some other status. Only 'completed' rows count.
    const items = [
      item({ id: 'a', diagnosis_status: 'pending', confusion_tags: ['collapsed-distinction'] }),
      item({ id: 'b', diagnosis_status: 'diagnosing', confusion_tags: ['collapsed-distinction'] }),
      item({ id: 'c', diagnosis_status: 'failed', confusion_tags: ['collapsed-distinction'] }),
      item({ id: 'd', diagnosis_status: 'not-applicable', confusion_tags: ['collapsed-distinction'] }),
    ]

    expect(summarizeTags(items)).toEqual([])
  })

  it('never counts a tag twice for one item, even if the item repeats it', () => {
    const items = [
      item({
        id: 'a',
        position: 1,
        diagnosis_status: 'completed',
        confusion_tags: ['collapsed-distinction', 'collapsed-distinction'],
      }),
    ]

    const out = summarizeTags(items)

    expect(out).toEqual([{ tag: 'collapsed-distinction', count: 1, positions: [1] }])
  })

  it('lets one item contribute to more than one distinct tag bucket', () => {
    const items = [
      item({
        id: 'a',
        position: 1,
        diagnosis_status: 'completed',
        confusion_tags: ['collapsed-distinction', 'careless'],
      }),
    ]

    const out = summarizeTags(items)

    expect(out).toEqual([
      { tag: 'careless', count: 1, positions: [1] },
      { tag: 'collapsed-distinction', count: 1, positions: [1] },
    ])
  })

  it('returns an empty array for no items', () => {
    expect(summarizeTags([])).toEqual([])
  })
})

describe('describePattern', () => {
  it('is never a pattern below MIN_QUIZZES_FOR_PATTERN, however unanimous the tag is', () => {
    expect(MIN_QUIZZES_FOR_PATTERN).toBe(3)

    // Every single diagnosed item across 2 quizzes carries the same tag —
    // as unanimous as it gets — and it must still refuse.
    const counts = [{ tag: 'collapsed-distinction' as const, count: 4, positions: [1, 2, 1, 2] }]

    for (const quizCount of [0, 1, 2]) {
      const out = describePattern(counts, quizCount)
      expect(out.isPattern).toBe(false)
    }
  })

  it("uses review.md's own refusal wording at n=1", () => {
    const counts = [{ tag: 'collapsed-distinction' as const, count: 4, positions: [1, 2, 3, 4] }]
    const out = describePattern(counts, 1)
    expect(out.isPattern).toBe(false)
    expect(out.note).toContain('Too early to call a pattern')
    expect(out.note.toLowerCase()).not.toContain('possible pattern')
  })

  it('is a pattern at 3+ quizzes when a tag holds a strict majority of diagnosed misses', () => {
    const counts = [
      { tag: 'collapsed-distinction' as const, count: 3, positions: [1, 1, 1] },
      { tag: 'careless' as const, count: 1, positions: [2] },
    ]
    const out = describePattern(counts, 3)

    expect(out.isPattern).toBe(true)
    expect(out.dominant).toEqual(counts[0])
    expect(out.note).not.toMatch(/possible|might|maybe/i)
  })

  it('is NOT a pattern at 3+ quizzes when no tag reaches a strict majority', () => {
    // A 50/50 split is not a strict majority.
    const counts = [
      { tag: 'careless' as const, count: 2, positions: [1, 2] },
      { tag: 'collapsed-distinction' as const, count: 2, positions: [3, 4] },
    ]
    const out = describePattern(counts, 3)

    expect(out.isPattern).toBe(false)
  })

  it('reports no dominant tag and no pattern for empty input', () => {
    const out = describePattern([], 0)
    expect(out.dominant).toBeNull()
    expect(out.isPattern).toBe(false)
  })
})
