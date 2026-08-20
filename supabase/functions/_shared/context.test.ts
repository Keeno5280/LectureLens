import { describe, it, expect } from 'vitest'
import { buildTutorContext } from './context'

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
