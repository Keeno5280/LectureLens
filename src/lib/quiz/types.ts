// These mirror supabase/functions/_shared/schemas.ts. They are duplicated
// rather than imported because tsconfig.app.json has "include": ["src"] and
// the _shared modules are Deno-flavoured (explicit .ts import extensions).
// If the schema changes, change this file with it.

export type ConfusionTag =
  | 'absolutizing-word'
  | 'collapsed-distinction'
  | 'answered-tone-not-claim'
  | 'wrong-category'
  | 'recall-gap'
  | 'judgment-under-tension'
  | 'misread-question'
  | 'careless'

export type LectureCoverage = 'covered' | 'partial' | 'not-in-lecture'

export interface Diagnosis {
  lecture_coverage: LectureCoverage
  correct_answer: string
  why_correct: string
  citations: { quote: string; supports: string }[]
  where_it_went_sideways: { confusion: string; explanation: string }[]
  collapsed_distinction: { this_: string; not_that: string } | null
  dont_overcorrect: string
  what_this_miss_was_not: string
  remember_this: string
  why_it_matters: string
  confusion_tags: ConfusionTag[]
}

export type DiagnosisStatus =
  | 'pending' | 'diagnosing' | 'completed' | 'failed' | 'not-applicable'

export interface QuizReviewItem {
  id: string
  review_id: string
  position: number
  question_text: string
  question_type: 'multiple_choice' | 'true_false' | 'short_answer'
  options: string[]
  student_answer: string | null
  correct_answer: string | null
  is_correct: boolean
  diagnosis: Diagnosis | null
  confusion_tags: ConfusionTag[]
  lecture_coverage: LectureCoverage | null
  diagnosis_status: DiagnosisStatus
  diagnosis_error: string | null
}

export interface QuizReview {
  id: string
  lecture_id: string
  user_id: string
  source: 'text' | 'image'
  raw_input: string | null
  quiz_title: string | null
  score_correct: number | null
  score_total: number | null
  status: 'awaiting_confirmation' | 'diagnosing' | 'completed' | 'failed'
  processing_error: string | null
  created_at: string
}
