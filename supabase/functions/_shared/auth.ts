export interface LectureRow {
  id: string
  user_id: string
  file_type: string | null
  transcript: string | null
  file_url: string | null
  title?: string
}

export interface AuthDeps {
  /** Resolve a user from the caller's own JWT. MUST NOT use the service-role key. */
  getUserFromToken(token: string): Promise<{ id: string } | null>
  /** Load the lecture. May use service-role — ownership is checked after. */
  getLecture(id: string): Promise<LectureRow | null>
}

export type AuthResult =
  | { ok: true; userId: string; lecture: LectureRow }
  | { ok: false; status: 401 | 403 | 404; error: string }

/**
 * Identity first, ownership second, privileged work third.
 * The previous implementation went straight to service-role and never asked who
 * was calling, which let anyone pass another user's lectureId.
 */
export async function authorizeLectureAccess(
  deps: AuthDeps,
  authHeader: string | null,
  lectureId: string,
): Promise<AuthResult> {
  if (!authHeader) return { ok: false, status: 401, error: 'missing authorization header' }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'malformed authorization header' }

  const user = await deps.getUserFromToken(token)
  if (!user) return { ok: false, status: 401, error: 'invalid or expired token' }

  const lecture = await deps.getLecture(lectureId)
  if (!lecture) return { ok: false, status: 404, error: 'lecture not found' }

  if (lecture.user_id !== user.id) return { ok: false, status: 403, error: 'forbidden' }

  return { ok: true, userId: user.id, lecture }
}
