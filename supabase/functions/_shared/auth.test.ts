import { describe, it, expect } from 'vitest'
import { authorizeLectureAccess, type AuthDeps } from './auth'

const LECTURE = { id: 'lec-1', user_id: 'user-A', file_type: 'audio', transcript: 'x', file_url: '' }

const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
  getUserFromToken: async (t) => (t === 'good-token' ? { id: 'user-A' } : null),
  getLecture: async (id) => (id === 'lec-1' ? (LECTURE as never) : null),
  ...over,
})

describe('authorizeLectureAccess', () => {
  it('401s with no Authorization header', async () => {
    const r = await authorizeLectureAccess(deps(), null, 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('401s on an invalid token', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer bad-token', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('404s when the lecture does not exist', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer good-token', 'nope')
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it("403s when the lecture belongs to someone else", async () => {
    const r = await authorizeLectureAccess(
      deps({ getUserFromToken: async () => ({ id: 'user-B' }) }),
      'Bearer good-token', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('succeeds for the owner and returns the row', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer good-token', 'lec-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.userId).toBe('user-A')
      expect(r.lecture.id).toBe('lec-1')
    }
  })

  it('accepts a bare token without the Bearer prefix', async () => {
    const r = await authorizeLectureAccess(deps(), 'good-token', 'lec-1')
    expect(r.ok).toBe(true)
  })

  it('accepts a token with leading whitespace before the Bearer prefix', async () => {
    // Regression for the anchored ^Bearer regex missing a leading-space header.
    const r = await authorizeLectureAccess(deps(), ' Bearer good-token', 'lec-1')
    expect(r.ok).toBe(true)
  })

  it('401s on "Bearer" with nothing after it', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('401s on "Bearer" followed by only whitespace', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer   ', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('401s when the resolved user has a falsy id, even if it would otherwise equal the lecture owner', async () => {
    // Reproduces the exact bypass from the finding: undefined !== undefined (or
    // '' !== '') is FALSE, so without the explicit guard this falls through the
    // ownership comparison and is wrongly granted access instead of rejected.
    const ownerlessLecture = { ...LECTURE, user_id: '' }
    const r = await authorizeLectureAccess(
      deps({
        getUserFromToken: async (t) => (t === 'ghost-token' ? { id: '' } : null),
        getLecture: async (id) => (id === 'lec-1' ? (ownerlessLecture as never) : null),
      }),
      'Bearer ghost-token', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('403s when the lecture row has a falsy owner, even for a legitimately identified caller', async () => {
    const ownerlessLecture = { ...LECTURE, user_id: '' }
    const r = await authorizeLectureAccess(
      deps({ getLecture: async (id) => (id === 'lec-1' ? (ownerlessLecture as never) : null) }),
      'Bearer good-token', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })
})

import { authorizeQuizItemAccess, type QuizAuthDeps } from './auth'

const ITEM = {
  id: 'item-1', review_id: 'rev-1', is_correct: false,
  question_text: 'q', question_type: 'true_false', options: [],
  student_answer: 'True', correct_answer: 'False',
}
const REVIEW = { id: 'rev-1', user_id: 'user-A', lecture_id: 'lec-1' }

const qDeps = (over: Partial<QuizAuthDeps> = {}): QuizAuthDeps => ({
  getUserFromToken: async (t) => (t === 'good-token' ? { id: 'user-A' } : null),
  getItem: async (id) => (id === 'item-1' ? ITEM : null),
  getReview: async (id) => (id === 'rev-1' ? REVIEW : null),
  ...over,
})

describe('authorizeQuizItemAccess', () => {
  it('401s with no Authorization header', async () => {
    expect(await authorizeQuizItemAccess(qDeps(), null, 'item-1'))
      .toMatchObject({ ok: false, status: 401 })
  })

  it('401s on an invalid token', async () => {
    expect(await authorizeQuizItemAccess(qDeps(), 'Bearer bad-token', 'item-1'))
      .toMatchObject({ ok: false, status: 401 })
  })

  it('404s when the item does not exist', async () => {
    expect(await authorizeQuizItemAccess(qDeps(), 'Bearer good-token', 'nope'))
      .toMatchObject({ ok: false, status: 404 })
  })

  it('404s when the parent review is missing', async () => {
    const r = await authorizeQuizItemAccess(
      qDeps({ getReview: async () => null }), 'Bearer good-token', 'item-1')
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it("403s when the review belongs to someone else — the IDOR case", async () => {
    const r = await authorizeQuizItemAccess(
      qDeps({ getUserFromToken: async () => ({ id: 'user-B' }) }), 'Bearer good-token', 'item-1')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('403s when the review has no owner', async () => {
    const r = await authorizeQuizItemAccess(
      qDeps({ getReview: async () => ({ ...REVIEW, user_id: '' }) }), 'Bearer good-token', 'item-1')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('succeeds for the owner and returns the item and review', async () => {
    const r = await authorizeQuizItemAccess(qDeps(), 'Bearer good-token', 'item-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.userId).toBe('user-A')
      expect(r.item.id).toBe('item-1')
      expect(r.review.lecture_id).toBe('lec-1')
    }
  })
})
