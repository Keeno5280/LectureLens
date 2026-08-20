import { describe, it, expect } from 'vitest'
import { LECTURE_ANALYST_SYSTEM, TUTOR_SYSTEM } from './prompts'

describe('LECTURE_ANALYST_SYSTEM', () => {
  it('forbids invention — the single most important instruction', () => {
    expect(LECTURE_ANALYST_SYSTEM.toLowerCase()).toContain('do not invent')
  })
  it('requires verbatim quotes', () => {
    expect(LECTURE_ANALYST_SYSTEM.toLowerCase()).toContain('verbatim')
  })
  it('asks for distinctions', () => {
    expect(LECTURE_ANALYST_SYSTEM.toLowerCase()).toContain('distinction')
  })
  it('has no unreplaced template markers', () => {
    expect(LECTURE_ANALYST_SYSTEM).not.toMatch(/\{\{|\$\{|undefined/)
  })
})

describe('TUTOR_SYSTEM', () => {
  it('has no unreplaced template markers (the old prompt shipped "provided in undefined")', () => {
    expect(TUTOR_SYSTEM).not.toMatch(/\{\{|\$\{|undefined/)
  })
  it('forbids answering beyond the provided context', () => {
    expect(TUTOR_SYSTEM.toLowerCase()).toContain('do not invent')
  })
})

import { QUIZ_PARSER_SYSTEM, MISS_DIAGNOSTICIAN_SYSTEM } from './prompts'

describe('QUIZ_PARSER_SYSTEM', () => {
  it('forbids judging correctness — that is the diagnostician\'s job', () => {
    expect(QUIZ_PARSER_SYSTEM).toMatch(/do not (decide|judge|evaluate)/i)
  })

  it('forbids guessing an unreadable answer', () => {
    expect(QUIZ_PARSER_SYSTEM).toMatch(/unreadable/i)
    expect(QUIZ_PARSER_SYSTEM).toMatch(/never guess|do not guess/i)
  })

  it('forbids correcting the student\'s answer to what they probably meant', () => {
    expect(QUIZ_PARSER_SYSTEM).toMatch(/probably meant|as it appears|exactly as/i)
  })
})

describe('MISS_DIAGNOSTICIAN_SYSTEM', () => {
  it('requires verbatim quotes', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/verbatim/i)
  })

  it('warns that citations are checked in code', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/checked in code|verified in code/i)
  })

  it('requires naming the specific confusion', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/not a diagnosis/i)
  })

  it('requires the not-in-lecture escape hatch', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/not-in-lecture/)
  })

  it('forbids inflating a careless miss', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/careless/i)
  })
})
