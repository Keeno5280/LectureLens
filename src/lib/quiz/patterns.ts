import type { ConfusionTag, QuizReviewItem } from './types'

/**
 * The bar this codebase's own study-review discipline sets before calling
 * anything a "pattern" (`~/hcli-school/CLAUDE.md`, `templates/review.md`):
 * 3+ diagnosed quizzes. Below it, `review.md` refuses outright — "Too early
 * to call a pattern. One quiz is a data point." — rather than hedging into
 * "possible pattern" language. `describePattern` below honours that literally.
 */
export const MIN_QUIZZES_FOR_PATTERN = 3

export interface TagCount {
  tag: ConfusionTag
  count: number
  positions: number[]
}

/**
 * Counts `confusion_tags` across `items` whose diagnosis actually finished.
 *
 * Only `diagnosis_status === 'completed'` rows count. Everything else —
 * pending, diagnosing, failed, not-applicable — has nothing to say yet, even
 * if `confusion_tags` happens to carry leftover values.
 *
 * A tag repeated within one item's own `confusion_tags` array (the schema
 * does not forbid it — `.min(1)`, no dedup, no cap) counts once for that
 * item, not once per repetition: this describes how many MISSES carry the
 * tag, not how many times the model said it. An item that legitimately
 * carries more than one DISTINCT tag contributes to each of those buckets —
 * that is not double-counting, it is one miss with two named confusions.
 *
 * Takes a `Pick` of `QuizReviewItem` rather than the full type so a
 * class-scoped caller can select only these three columns across a
 * potentially large cross-quiz row set, instead of pulling every item's
 * full `diagnosis` jsonb blob just to count tags.
 */
export function summarizeTags(
  items: Pick<QuizReviewItem, 'position' | 'diagnosis_status' | 'confusion_tags'>[],
): TagCount[] {
  const byTag = new Map<ConfusionTag, TagCount>()

  for (const item of items) {
    if (item.diagnosis_status !== 'completed') continue

    // De-duplicate within this one item's own tag list before folding it in,
    // so a repeated tag on a single item can never inflate that item past a
    // single contribution to its own bucket.
    const distinctTagsOnThisItem = new Set(item.confusion_tags)
    for (const tag of distinctTagsOnThisItem) {
      const existing = byTag.get(tag)
      if (existing) {
        existing.count += 1
        existing.positions.push(item.position)
      } else {
        byTag.set(tag, { tag, count: 1, positions: [item.position] })
      }
    }
  }

  return Array.from(byTag.values()).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  )
}

export interface PatternSummary {
  dominant: TagCount | null
  isPattern: boolean
  note: string
}

/**
 * Turns a tag breakdown into an honest verdict.
 *
 * `isPattern` requires BOTH: `quizCount >= MIN_QUIZZES_FOR_PATTERN`, and a
 * tag holding a strict majority of the diagnosed misses `counts` describes.
 * Below the quiz threshold this returns false unconditionally — a tag on
 * every single item of a lone quiz is still not a pattern, because one quiz
 * is a data point, not a trend. That refusal is deliberate; the caller must
 * not soften `note` into "possible pattern" language when it fires.
 *
 * The majority denominator is the sum of every bucket's `count` in `counts`,
 * not a separately-tracked item total. `summarizeTags` lets one item
 * contribute to more than one bucket when a diagnosis names more than one
 * confusion, so this sum can run higher than the true number of diagnosed
 * items — which only ever makes the majority bar HARDER to clear, never
 * easier. A compound-tagged miss can suppress a real majority; it can never
 * manufacture a fake one. Given the choice, this feature is required to
 * under-claim rather than over-claim.
 */
export function describePattern(counts: TagCount[], quizCount: number): PatternSummary {
  const dominant = counts[0] ?? null

  if (dominant === null) {
    return { dominant: null, isPattern: false, note: 'Nothing diagnosed yet — no pattern to show.' }
  }

  const totalTagged = counts.reduce((sum, c) => sum + c.count, 0)
  const isMajority = dominant.count * 2 > totalTagged
  const isPattern = quizCount >= MIN_QUIZZES_FOR_PATTERN && isMajority

  if (quizCount < MIN_QUIZZES_FOR_PATTERN) {
    return {
      dominant,
      isPattern: false,
      note: quizCount <= 1
        ? 'Too early to call a pattern. One quiz is a data point.'
        : `Too early to call a pattern — only ${quizCount} quizzes diagnosed in this class so far. ` +
          `${MIN_QUIZZES_FOR_PATTERN}+ are needed before calling anything a pattern.`,
    }
  }

  if (!isPattern) {
    return {
      dominant,
      isPattern: false,
      note: `${quizCount} quizzes diagnosed in this class. "${dominant.tag}" is the most common tag ` +
        `(${dominant.count} of ${totalTagged} diagnosed misses), but it's not on a majority of them — not a pattern yet.`,
    }
  }

  return {
    dominant,
    isPattern: true,
    note: `Across ${quizCount} quizzes in this class, "${dominant.tag}" shows up on ${dominant.count} of ` +
      `${totalTagged} diagnosed misses — that's a pattern.`,
  }
}
