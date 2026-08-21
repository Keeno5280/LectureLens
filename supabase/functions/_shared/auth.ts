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

  // Trim the whole header first so leading/trailing whitespace (e.g. a stray
  // space before "Bearer") doesn't defeat the anchored prefix match below.
  const token = authHeader.trim().replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'malformed authorization header' }

  const user = await deps.getUserFromToken(token)
  if (!user) return { ok: false, status: 401, error: 'invalid or expired token' }

  // Defense in depth: `undefined !== undefined` (and `'' !== ''`) is FALSE, so a
  // defective AuthDeps implementation that resolves a falsy/empty id on either
  // side would otherwise fall through the comparison below and be granted
  // access. Both ids must be real, non-empty strings before we trust them.
  if (!user.id) return { ok: false, status: 401, error: 'caller identity missing' }

  const lecture = await deps.getLecture(lectureId)
  if (!lecture) return { ok: false, status: 404, error: 'lecture not found' }

  if (!lecture.user_id) return { ok: false, status: 403, error: 'lecture has no owner' }

  if (lecture.user_id !== user.id) return { ok: false, status: 403, error: 'forbidden' }

  return { ok: true, userId: user.id, lecture }
}

export interface QuizItemRow {
  id: string
  review_id: string
  is_correct: boolean
  question_text: string
  question_type: string
  options: unknown
  student_answer: string | null
  correct_answer: string | null
}

export interface QuizReviewRow {
  id: string
  user_id: string
  lecture_id: string
}

/** Only what ownership needs. The diagnosis content is fetched separately. */
export interface QuizLectureRow {
  id: string
  user_id: string
}

export interface QuizAuthDeps {
  /** Resolve a user from the caller's OWN JWT. MUST NOT use the service-role key. */
  getUserFromToken(token: string): Promise<{ id: string } | null>
  /** May use service-role — ownership is checked after. */
  getItem(id: string): Promise<QuizItemRow | null>
  getReview(id: string): Promise<QuizReviewRow | null>
  /** May use service-role — ownership is checked after. */
  getLecture(id: string): Promise<QuizLectureRow | null>
}

export type QuizAuthResult =
  | { ok: true; userId: string; item: QuizItemRow; review: QuizReviewRow; lecture: QuizLectureRow }
  | { ok: false; status: 401 | 403 | 404; error: string }

/**
 * Identity → ownership → privileged work, walking item → review → lecture → owner.
 *
 * `itemId` comes straight off the request body. Nothing has checked it belongs
 * to the caller, so this must resolve the parent review and compare its owner
 * against the caller's own JWT before any service-role work happens. Skipping
 * that walk is how both of this repo's IDORs happened.
 *
 * The walk does NOT stop at the review. `quiz_reviews.lecture_id` is writable
 * by the row's owner — RLS scopes the UPDATE by `user_id`, not by column — so
 * a caller can repoint their own review at somebody else's lecture and every
 * check above this line still passes. Whatever loads that lecture afterwards
 * would then read, quote and persist a stranger's material into a row the
 * attacker can read back. The lecture's own owner is therefore checked here,
 * not assumed from the review.
 */
export async function authorizeQuizItemAccess(
  deps: QuizAuthDeps,
  authHeader: string | null,
  itemId: string,
): Promise<QuizAuthResult> {
  if (!authHeader) return { ok: false, status: 401, error: 'missing authorization header' }

  const token = authHeader.trim().replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'malformed authorization header' }

  const user = await deps.getUserFromToken(token)
  if (!user) return { ok: false, status: 401, error: 'invalid or expired token' }
  if (!user.id) return { ok: false, status: 401, error: 'caller identity missing' }

  const item = await deps.getItem(itemId)
  if (!item) return { ok: false, status: 404, error: 'quiz item not found' }

  const review = await deps.getReview(item.review_id)
  if (!review) return { ok: false, status: 404, error: 'quiz review not found' }

  // Both ids must be real, non-empty strings before the comparison is trusted —
  // `'' !== ''` is false, so a defective deps implementation returning empty
  // strings on both sides would otherwise fall straight through.
  if (!review.user_id) return { ok: false, status: 403, error: 'quiz review has no owner' }
  if (review.user_id !== user.id) return { ok: false, status: 403, error: 'forbidden' }

  const lecture = await deps.getLecture(review.lecture_id)
  if (!lecture) return { ok: false, status: 404, error: 'lecture not found' }

  // Same empty-string rationale as the review guard above: `'' !== ''` is
  // false, so an ownerless lecture must be rejected explicitly rather than
  // being allowed to fall through the comparison.
  if (!lecture.user_id) return { ok: false, status: 403, error: 'lecture has no owner' }
  if (lecture.user_id !== user.id) return { ok: false, status: 403, error: 'forbidden' }

  return { ok: true, userId: user.id, item, review, lecture }
}
