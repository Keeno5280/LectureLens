/**
 * Citations are VERIFIED, not trusted.
 *
 * The diagnosis prompt requires quotes to be verbatim from the lecture. A prompt
 * instruction is not a guarantee, and a fabricated quote attributed to a student's
 * own lecturer is the single worst thing this feature could produce — it is both
 * confidently wrong and impossible for the student to catch, because they came here
 * precisely because they don't know the material.
 *
 * So every returned quote is checked against the actual source before it is stored.
 */

export interface Citation {
  quote: string
  supports: string
}

export interface CitationSources {
  /** Null for `slides` lectures — Phase 1 sends the PDF as a document block and never stores a transcript. */
  transcript: string | null
  /** `lectures.claims[].quote` — the only corpus available for slides lectures. */
  claimQuotes: string[]
}

export interface CitationVerification {
  verified: Citation[]
  rejected: Citation[]
}

/**
 * Below this length a "quote" matches too much to mean anything — "the law"
 * would verify against almost any lecture. Short fragments are unverifiable,
 * and unverifiable is treated the same as unverified.
 */
export const MIN_VERIFIABLE_QUOTE_LENGTH = 12

/**
 * Verbatim is checked semantically, not byte-for-byte. A model reproducing a
 * transcript will legitimately vary whitespace and quote characters; neither
 * changes who said what. Case is folded for the same reason. Anything beyond
 * that — different words — is a different quote.
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function verifyCitations(
  citations: Citation[],
  sources: CitationSources,
): CitationVerification {
  const haystacks = [
    ...(sources.transcript ? [sources.transcript] : []),
    ...sources.claimQuotes,
  ].map(normalizeForMatch)

  const verified: Citation[] = []
  const rejected: Citation[] = []

  for (const c of citations) {
    const needle = normalizeForMatch(c.quote)
    const longEnough = needle.length >= MIN_VERIFIABLE_QUOTE_LENGTH
    if (longEnough && haystacks.some((h) => h.includes(needle))) {
      verified.push(c)
    } else {
      rejected.push(c)
    }
  }

  return { verified, rejected }
}
