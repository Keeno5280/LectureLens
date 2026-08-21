import { describe, it, expect } from 'vitest'
import { reconcileAfterRun } from './reconcile'
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

describe('reconcileAfterRun', () => {
  it("marks an item failed when the fan-out saw it fail but the DB still says 'diagnosing'", () => {
    // The 401/403/404/timeout/CORS paths: diagnose-miss never reached its own
    // fail(), so the row is stranded mid-flight. Left alone it renders as a
    // spinner that never resolves and offers no Retry, under a banner telling
    // the student to retry it.
    const loaded = [item({ diagnosis_status: 'diagnosing' })]
    const [out] = reconcileAfterRun(loaded, {
      succeeded: [],
      failed: [{ itemId: 'item-1', error: 'forbidden' }],
    })

    expect(out.diagnosis_status).toBe('failed')
    expect(out.diagnosis_error).toBe('forbidden')
  })

  it("marks an item failed when the DB still says 'pending' — which renders as nothing at all", () => {
    const loaded = [item({ diagnosis_status: 'pending' })]
    const [out] = reconcileAfterRun(loaded, {
      succeeded: [],
      failed: [{ itemId: 'item-1', error: 'Failed to fetch' }],
    })

    expect(out.diagnosis_status).toBe('failed')
    expect(out.diagnosis_error).toBe('Failed to fetch')
  })

  it("keeps the DB's own error when the row already says 'failed'", () => {
    // diagnose-miss reached fail() and wrote what actually went wrong. That
    // beats the generic message the invoker saw on the way back.
    const loaded = [item({
      diagnosis_status: 'failed',
      diagnosis_error: 'Could not save the diagnosis: connection reset',
    })]
    const [out] = reconcileAfterRun(loaded, {
      succeeded: [],
      failed: [{ itemId: 'item-1', error: 'Edge Function returned a non-2xx status code' }],
    })

    expect(out.diagnosis_status).toBe('failed')
    expect(out.diagnosis_error).toBe('Could not save the diagnosis: connection reset')
  })

  it("fills in the fan-out's message when the DB says 'failed' with no reason", () => {
    const loaded = [item({ diagnosis_status: 'failed', diagnosis_error: null })]
    const [out] = reconcileAfterRun(loaded, {
      succeeded: [],
      failed: [{ itemId: 'item-1', error: 'gateway timeout' }],
    })

    expect(out.diagnosis_status).toBe('failed')
    expect(out.diagnosis_error).toBe('gateway timeout')
  })

  it('leaves succeeded items exactly as the DB returned them', () => {
    const completed = item({
      id: 'item-2', position: 2, diagnosis_status: 'completed', diagnosis_error: null,
    })
    const loaded = [completed]
    const out = reconcileAfterRun(loaded, { succeeded: ['item-2'], failed: [] })

    expect(out[0]).toBe(completed)
  })

  it('touches only the failed neighbours in a mixed run', () => {
    const loaded = [
      item({ id: 'a', diagnosis_status: 'completed' }),
      item({ id: 'b', position: 2, diagnosis_status: 'diagnosing' }),
      item({ id: 'c', position: 3, diagnosis_status: 'not-applicable' }),
    ]
    const out = reconcileAfterRun(loaded, {
      succeeded: ['a'],
      failed: [{ itemId: 'b', error: 'boom' }],
    })

    expect(out.map((i) => i.diagnosis_status)).toEqual(['completed', 'failed', 'not-applicable'])
    expect(out[0]).toBe(loaded[0])
    expect(out[2]).toBe(loaded[2])
  })

  it('returns the loaded rows untouched when nothing failed', () => {
    const loaded = [item({ diagnosis_status: 'completed' })]
    expect(reconcileAfterRun(loaded, { succeeded: ['item-1'], failed: [] })).toBe(loaded)
  })

  it('ignores a reported failure for an item the reload no longer contains', () => {
    const loaded = [item({ id: 'still-here', diagnosis_status: 'completed' })]
    const out = reconcileAfterRun(loaded, {
      succeeded: ['still-here'],
      failed: [{ itemId: 'deleted-since', error: 'boom' }],
    })

    expect(out).toHaveLength(1)
    expect(out[0].diagnosis_status).toBe('completed')
  })
})
