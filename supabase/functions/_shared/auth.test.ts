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
})
