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
 * Everything `describePattern` needs, produced by one pass over the same
 * items so the two numbers can never be computed from different inputs.
 *
 * `diagnosedItemCount` is the count of diagnosed ITEMS (misses) — NOT the
 * sum of every `TagCount.count`. A single item can carry more than one
 * confusion tag (the schema allows `.min(1)`, no max, and real diagnoses
 * here routinely carry several), so summing `count` across buckets counts
 * one item once per tag it holds. Four items carrying three tags each sum
 * to 12 — but there were only four misses. Using that sum as the majority
 * denominator makes even a fully unanimous tag look like a minority and
 * `isPattern` becomes unreachable at any quiz count. `describePattern`
 * takes this whole object rather than a bare number specifically so that
 * mistake can't be reintroduced by a caller computing the count a different
 * (wrong) way.
 */
export interface TagSummary {
  counts: TagCount[]
  diagnosedItemCount: number
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
 * `diagnosedItemCount` tracks the true number of such items separately, in
 * the same pass, precisely because that sum-across-buckets is NOT it.
 *
 * Takes a `Pick` of `QuizReviewItem` rather than the full type so a
 * class-scoped caller can select only these three columns across a
 * potentially large cross-quiz row set, instead of pulling every item's
 * full `diagnosis` jsonb blob just to count tags.
 */
export function summarizeTags(
  items: Pick<QuizReviewItem, 'position' | 'diagnosis_status' | 'confusion_tags'>[],
): TagSummary {
  const byTag = new Map<ConfusionTag, TagCount>()
  let diagnosedItemCount = 0

  for (const item of items) {
    if (item.diagnosis_status !== 'completed') continue
    diagnosedItemCount += 1

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

  const counts = Array.from(byTag.values()).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  )

  return { counts, diagnosedItemCount }
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
 * tag held by a strict majority of `summary.diagnosedItemCount` diagnosed
 * misses. Below the quiz threshold this returns false unconditionally — a
 * tag on every single item of a lone quiz is still not a pattern, because
 * one quiz is a data point, not a trend. That refusal is deliberate; the
 * caller must not soften `note` into "possible pattern" language when it
 * fires.
 *
 * The majority denominator is `summary.diagnosedItemCount`, never a sum of
 * `TagCount.count` — see `TagSummary` for why that sum is the wrong number.
 *
 * `'other'` is excluded from `dominant` even when it is the highest-count
 * tag. A student whose top confusion is "other" has learned nothing
 * actionable — a high `'other'` count means the closed vocabulary is
 * missing something, not that the student has a fixable habit. It is still
 * counted and shown in `summary.counts`; it can just never win here, and so
 * can never back an `isPattern: true` claim either.
 */
export function describePattern(summary: TagSummary, quizCount: number): PatternSummary {
  const { counts, diagnosedItemCount } = summary
  const dominant = counts.find((c) => c.tag !== 'other') ?? null

  if (dominant === null) {
    // Empty input and "every diagnosed miss was tagged 'other'" both land
    // here, but they are not the same claim — the latter has diagnosed
    // items and an honest note must not imply otherwise.
    const note = diagnosedItemCount === 0
      ? 'Nothing diagnosed yet — no pattern to show.'
      : "Every diagnosed miss so far was tagged 'other' — the tag list doesn't cover what's going wrong yet. Not a pattern to show."
    return { dominant: null, isPattern: false, note }
  }

  const isMajority = dominant.count * 2 > diagnosedItemCount
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
        `(${dominant.count} of ${diagnosedItemCount} diagnosed misses), but it's not on a majority of them — not a pattern yet.`,
    }
  }

  return {
    dominant,
    isPattern: true,
    note: `Across ${quizCount} quizzes in this class, "${dominant.tag}" shows up on ${dominant.count} of ` +
      `${diagnosedItemCount} diagnosed misses — that's a pattern.`,
  }
}
