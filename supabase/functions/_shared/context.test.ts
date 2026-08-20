import { describe, it, expect } from 'vitest'
import { buildTutorContext, normalizeTurns, type Turn } from './context'

const lecture = {
  title: 'Worldview', summary_overview: 'A lecture.',
  transcript: 'Systems cannot transform people.',
}

describe('buildTutorContext', () => {
  it('includes lecture title and summary', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: null })
    expect(c).toContain('Worldview')
    expect(c).toContain('A lecture.')
  })

  it('includes the transcript — the old pipeline never stored one', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: null })
    expect(c).toContain('Systems cannot transform people.')
  })

  it('says so plainly when there is no lecture content', () => {
    const c = buildTutorContext({ lectures: [], assignmentPrompt: null })
    expect(c).toMatch(/no lecture content/i)
  })

  it('includes the assignment rubric when present', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: 'Write 500 words.' })
    expect(c).toContain('Write 500 words.')
  })

  it('omits the assignment section entirely when absent', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: null })
    expect(c).not.toContain('ASSIGNMENT')
  })

  it('never emits the literal "undefined" (the deployed prompt shipped that bug)', () => {
    const c = buildTutorContext({
      lectures: [{ title: 'T', summary_overview: null, transcript: null }],
      assignmentPrompt: null,
    })
    expect(c).not.toContain('undefined')
  })
})

describe('normalizeTurns', () => {
  it('merges two consecutive user turns into one', () => {
    const out = normalizeTurns([
      { role: 'user', content: 'first question' },
      { role: 'user', content: 'orphaned follow-up' },
    ])
    expect(out).toEqual([{ role: 'user', content: 'first question\norphaned follow-up' }])
  })

  it('merges three consecutive same-role turns into one', () => {
    // A leading 'user' turn keeps this test isolated to pass-1 (merging):
    // an all-assistant input would also be caught by pass 2 (drop leading
    // assistant), which is covered separately below.
    const out = normalizeTurns([
      { role: 'user', content: 'q0' },
      { role: 'assistant', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'assistant', content: 'c' },
    ])
    expect(out).toEqual([
      { role: 'user', content: 'q0' },
      { role: 'assistant', content: 'a\nb\nc' },
    ])
  })

  it('leaves strictly alternating history untouched', () => {
    const turns: Turn[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]
    expect(normalizeTurns(turns)).toEqual(turns)
  })

  it("drops a leading 'assistant' turn so messages[0] is always 'user'", () => {
    // The Anthropic API rejects a request whose first message isn't
    // 'user'. A last-10-rows window can easily start mid-conversation on
    // an assistant reply — this used to be left untouched (a bug fixed in
    // this round); it must now be dropped.
    const out = normalizeTurns([
      { role: 'assistant', content: 'a0' },
      { role: 'user', content: 'q1' },
    ])
    expect(out).toEqual([{ role: 'user', content: 'q1' }])
  })

  it('drops the entire history when it is nothing but assistant turns, leaving []', () => {
    const out = normalizeTurns([
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
    ])
    expect(out).toEqual([])
  })

  it('[assistant, user, assistant, user] becomes [user, assistant, user]', () => {
    const out = normalizeTurns([
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u2' },
    ])
    expect(out).toEqual([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u2' },
    ])
  })

  it('merges an UNMERGED multi-turn leading assistant run before dropping it — fails if drop ran before merge', () => {
    // This is the case that makes pass order load-bearing rather than
    // cosmetic. Input has two SEPARATE, not-yet-merged leading assistant
    // turns. Correct (merge-then-drop): pass 1 collapses [a1,a2] into one
    // leading assistant turn, so pass 2's single-check drop removes all
    // of it, leaving [u1, a3].
    //
    // Under the wrong order (drop-then-merge), a single-check drop run
    // FIRST on the raw, unmerged array only removes the a1 turn (the
    // check is "is turns[0] assistant", not a loop) — it has no way to
    // know a2 is also part of the same leading run without pass 1 having
    // run first. The subsequent merge pass then finds no adjacent
    // same-role turns left to merge (a2/u1/a3 all differ from their
    // neighbor), so the result is left as [a2, u1, a3] — STILL starting
    // with 'assistant', still an invalid request. Getting this test to
    // pass requires merge to run before drop.
    const out = normalizeTurns([
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a3' },
    ])
    expect(out).toEqual([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a3' },
    ])
  })

  it('handles empty history', () => {
    expect(normalizeTurns([])).toEqual([])
  })

  it('does not mutate the input array or its elements', () => {
    const input: Turn[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    normalizeTurns(input)
    expect(input).toEqual(snapshot)
  })
})
