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
