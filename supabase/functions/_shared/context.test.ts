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
    const out = normalizeTurns([
      { role: 'assistant', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'assistant', content: 'c' },
    ])
    expect(out).toEqual([{ role: 'assistant', content: 'a\nb\nc' }])
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

  it("handles history that starts with an 'assistant' turn", () => {
    const out = normalizeTurns([
      { role: 'assistant', content: 'a0' },
      { role: 'user', content: 'q1' },
    ])
    expect(out).toEqual([
      { role: 'assistant', content: 'a0' },
      { role: 'user', content: 'q1' },
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
