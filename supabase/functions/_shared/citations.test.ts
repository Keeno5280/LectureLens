import { describe, it, expect } from 'vitest'
import { verifyCitations, normalizeForMatch, MIN_VERIFIABLE_QUOTE_LENGTH } from './citations'

const TRANSCRIPT = 'The law, weakened by the flesh, could not do what God has now done.'
const CLAIM_QUOTES = ['nobody has ever made a seed grow']

const cite = (quote: string) => ({ quote, supports: 'x' })

describe('normalizeForMatch', () => {
  it('collapses runs of whitespace', () => {
    expect(normalizeForMatch('a   b\n\nc')).toBe('a b c')
  })

  it('normalizes curly quotes and apostrophes to straight ones', () => {
    expect(normalizeForMatch('“the lecturer’s words”')).toBe('"the lecturer\'s words"')
  })

  it('is case-insensitive — case does not change attribution', () => {
    expect(normalizeForMatch('The Law')).toBe(normalizeForMatch('the law'))
  })
})

describe('verifyCitations', () => {
  it('accepts a quote found verbatim in the transcript', () => {
    const r = verifyCitations([cite('weakened by the flesh, could not do')],
      { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.verified).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
  })

  it('accepts a quote that differs only in whitespace', () => {
    const r = verifyCitations([cite('weakened   by the\nflesh, could not do')],
      { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.verified).toHaveLength(1)
  })

  it('accepts a quote found in a stored claim quote when there is no transcript', () => {
    const r = verifyCitations([cite('nobody has ever made a seed grow')],
      { transcript: null, claimQuotes: CLAIM_QUOTES })
    expect(r.verified).toHaveLength(1)
  })

  it('REJECTS a fabricated quote that appears nowhere in the source', () => {
    const r = verifyCitations([cite('systems are the engine of transformation')],
      { transcript: TRANSCRIPT, claimQuotes: CLAIM_QUOTES })
    expect(r.verified).toHaveLength(0)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].quote).toBe('systems are the engine of transformation')
  })

  it('rejects a quote too short to verify meaningfully', () => {
    expect('the law'.length).toBeLessThan(MIN_VERIFIABLE_QUOTE_LENGTH)
    const r = verifyCitations([cite('the law')], { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.rejected).toHaveLength(1)
  })

  it('separates the good from the bad rather than failing the whole set', () => {
    const r = verifyCitations(
      [cite('weakened by the flesh, could not do'), cite('a quote nobody ever said out loud')],
      { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.verified).toHaveLength(1)
    expect(r.rejected).toHaveLength(1)
  })

  it('rejects everything when there is no source at all', () => {
    const r = verifyCitations([cite('weakened by the flesh, could not do')],
      { transcript: null, claimQuotes: [] })
    expect(r.verified).toHaveLength(0)
    expect(r.rejected).toHaveLength(1)
  })

  it('returns empty sets for no citations', () => {
    const r = verifyCitations([], { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r).toEqual({ verified: [], rejected: [] })
  })
})
