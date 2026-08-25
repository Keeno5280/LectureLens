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

    expect(out.counts).toEqual([
      { tag: 'collapsed-distinction', count: 2, positions: [1, 2] },
      { tag: 'careless', count: 1, positions: [3] },
      { tag: 'recall-gap', count: 1, positions: [4] },
    ])
    expect(out.diagnosedItemCount).toBe(4)
  })

  it('breaks a tie in count by tag name, ascending', () => {
    const items = [
      item({ id: 'a', position: 1, diagnosis_status: 'completed', confusion_tags: ['wrong-category'] }),
      item({ id: 'b', position: 2, diagnosis_status: 'completed', confusion_tags: ['careless'] }),
    ]

    const out = summarizeTags(items)

    expect(out.counts.map((c) => c.tag)).toEqual(['careless', 'wrong-category'])
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

    const out = summarizeTags(items)
    expect(out.counts).toEqual([])
    expect(out.diagnosedItemCount).toBe(0)
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

    expect(out.counts).toEqual([{ tag: 'collapsed-distinction', count: 1, positions: [1] }])
    expect(out.diagnosedItemCount).toBe(1)
  })

  it('lets one item contribute to more than one distinct tag bucket, but only counts once toward diagnosedItemCount', () => {
    const items = [
      item({
        id: 'a',
        position: 1,
        diagnosis_status: 'completed',
        confusion_tags: ['collapsed-distinction', 'careless'],
      }),
    ]

    const out = summarizeTags(items)

    expect(out.counts).toEqual([
      { tag: 'careless', count: 1, positions: [1] },
      { tag: 'collapsed-distinction', count: 1, positions: [1] },
    ])
    // REGRESSION GUARD: one item, two tags. diagnosedItemCount must stay 1 —
    // it is the miss count, not the sum of TagCount.count (which is 2 here).
    // This is the exact number describePattern's majority check depends on.
    expect(out.diagnosedItemCount).toBe(1)
  })

  it('returns an empty summary for no items', () => {
    const out = summarizeTags([])
    expect(out.counts).toEqual([])
    expect(out.diagnosedItemCount).toBe(0)
  })
})

describe('describePattern', () => {
  it('is never a pattern below MIN_QUIZZES_FOR_PATTERN, however unanimous the tag is', () => {
    expect(MIN_QUIZZES_FOR_PATTERN).toBe(3)

    // 4 diagnosed items, all carrying the same tag — as unanimous as it
    // gets — across 2 quizzes. Must still refuse.
    const summary = {
      counts: [{ tag: 'collapsed-distinction' as const, count: 4, positions: [1, 2, 1, 2] }],
      diagnosedItemCount: 4,
    }

    for (const quizCount of [0, 1, 2]) {
      const out = describePattern(summary, quizCount)
      expect(out.isPattern).toBe(false)
    }
  })

  it("uses review.md's own refusal wording at n=1", () => {
    const summary = {
      counts: [{ tag: 'collapsed-distinction' as const, count: 4, positions: [1, 2, 3, 4] }],
      diagnosedItemCount: 4,
    }
    const out = describePattern(summary, 1)
    expect(out.isPattern).toBe(false)
    expect(out.note).toContain('Too early to call a pattern')
    expect(out.note.toLowerCase()).not.toContain('possible pattern')
  })

  it('is a pattern at 3+ quizzes when a tag holds a strict majority of diagnosed misses', () => {
    const counts = [
      { tag: 'collapsed-distinction' as const, count: 3, positions: [1, 1, 1] },
      { tag: 'careless' as const, count: 1, positions: [2] },
    ]
    const out = describePattern({ counts, diagnosedItemCount: 4 }, 3)

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
    const out = describePattern({ counts, diagnosedItemCount: 4 }, 3)

    expect(out.isPattern).toBe(false)
  })

  it('reports no dominant tag and no pattern for empty input', () => {
    const out = describePattern({ counts: [], diagnosedItemCount: 0 }, 0)
    expect(out.dominant).toBeNull()
    expect(out.isPattern).toBe(false)
  })

  // 'other' means the model reached for the vocabulary's escape hatch — that
  // is a signal the TAG LIST is inadequate, not a habit the student can act
  // on. A high 'other' count must still show up in the breakdown (that is
  // `summarizeTags`'s job, tested above), but it must never win `dominant`
  // here, and therefore can never itself back `isPattern: true` — even when
  // it is the single highest-count tag.
  it("excludes 'other' from dominant even when it has the highest count, and picks the real runner-up instead", () => {
    const counts = [
      { tag: 'other' as const, count: 5, positions: [1, 2, 3, 4, 5] },
      { tag: 'careless' as const, count: 4, positions: [6, 7, 8, 9] },
    ]
    const out = describePattern({ counts, diagnosedItemCount: 9 }, 3)

    expect(out.dominant?.tag).toBe('careless')
    expect(out.dominant?.count).toBe(4)
  })

  it("never reports a dominant tag or a pattern when 'other' is the only tag present, and says so honestly (not 'nothing diagnosed yet')", () => {
    const counts = [{ tag: 'other' as const, count: 4, positions: [1, 2, 3, 4] }]
    const out = describePattern({ counts, diagnosedItemCount: 4 }, 3)

    expect(out.dominant).toBeNull()
    expect(out.isPattern).toBe(false)
    expect(out.note).not.toBe('Nothing diagnosed yet — no pattern to show.')
    expect(out.note).toMatch(/other/i)
  })

  // REGRESSION (caught in review): real diagnoses here commonly carry more
  // than one confusion_tag per miss. A tag that is unanimous across every
  // diagnosed ITEM must count as a majority even though each item also
  // carries other tags — the denominator has to be the number of diagnosed
  // items, never the sum of tag instances across buckets (4 items x 3 tags
  // = 12 tag instances, but there were only 4 misses). Before the fix, this
  // test failed with `isPattern: false` — see task-patterns-report.md for
  // the captured before/after output.
  it('is a pattern when one tag is unanimous across every diagnosed item, even though each item carries three tags total', () => {
    const items = [
      item({ id: 'a', position: 1, diagnosis_status: 'completed', confusion_tags: ['collapsed-distinction', 'careless', 'recall-gap'] }),
      item({ id: 'b', position: 2, diagnosis_status: 'completed', confusion_tags: ['collapsed-distinction', 'misread-question', 'wrong-category'] }),
      item({ id: 'c', position: 3, diagnosis_status: 'completed', confusion_tags: ['collapsed-distinction', 'absolutizing-word', 'judgment-under-tension'] }),
      item({ id: 'd', position: 4, diagnosis_status: 'completed', confusion_tags: ['collapsed-distinction', 'answered-tone-not-claim', 'careless'] }),
    ]

    const summary = summarizeTags(items)
    const out = describePattern(summary, 3)

    expect(summary.diagnosedItemCount).toBe(4)
    expect(out.dominant?.tag).toBe('collapsed-distinction')
    expect(out.dominant?.count).toBe(4)
    expect(out.isPattern).toBe(true)
  })

  // Matches the real quiz that motivated this feature: 4 misses, one tag
  // each, at n=1. Must show the true miss count (4 of 4, not 4 of anything
  // else) and must still refuse to call it a pattern — only one quiz exists.
  it('sanity check: 4 misses all tagged the same way at quizCount 1 -> honest 4-of-4 count, no pattern claimed', () => {
    const items = [1, 2, 3, 4].map((position) =>
      item({ id: `m${position}`, position, diagnosis_status: 'completed', confusion_tags: ['collapsed-distinction'] }),
    )

    const summary = summarizeTags(items)
    const out = describePattern(summary, 1)

    expect(summary.diagnosedItemCount).toBe(4)
    expect(out.dominant).toEqual({ tag: 'collapsed-distinction', count: 4, positions: [1, 2, 3, 4] })
    expect(out.isPattern).toBe(false)
    expect(out.note).toBe('Too early to call a pattern. One quiz is a data point.')
  })
})
