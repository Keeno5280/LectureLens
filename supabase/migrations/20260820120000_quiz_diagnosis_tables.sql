/*
  # Phase 2 — quiz-miss diagnosis tables

  `quiz_questions` / `quiz_attempts` (from the slides system) are a scorekeeper:
  quiz_questions has no concept of a student's answer, and quiz_attempts.answers
  is an untyped blob. Neither has anywhere to record WHY an answer was wrong.
  These tables are separate on purpose.

  `confusion_tags` and `lecture_coverage` are real columns rather than fields
  inside `diagnosis` so the deferred cross-quiz pattern pass is a GROUP BY over
  an index, with no further migration.

  RLS is enabled and owner-scoped from the start. This repo's history contains
  six separate `disable_rls_for_testing` migrations; these tables do not join them.
*/

CREATE TABLE IF NOT EXISTS quiz_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id       uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('text','image')),
  raw_input        text,
  quiz_title       text,
  score_correct    integer,
  score_total      integer,
  status           text NOT NULL DEFAULT 'awaiting_confirmation'
                     CHECK (status IN ('awaiting_confirmation','diagnosing','completed','failed')),
  processing_error text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_review_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES quiz_reviews(id) ON DELETE CASCADE,
  position         integer NOT NULL,
  question_text    text NOT NULL,
  question_type    text NOT NULL CHECK (question_type IN ('multiple_choice','true_false','short_answer')),
  options          jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_answer   text,
  correct_answer   text,
  is_correct       boolean NOT NULL,
  diagnosis        jsonb,
  confusion_tags   text[] NOT NULL DEFAULT '{}',
  lecture_coverage text CHECK (lecture_coverage IN ('covered','partial','not-in-lecture')),
  diagnosis_status text NOT NULL DEFAULT 'pending'
                     CHECK (diagnosis_status IN ('pending','diagnosing','completed','failed','not-applicable')),
  diagnosis_error  text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (review_id, position)
);

CREATE INDEX IF NOT EXISTS idx_quiz_review_items_review_id
  ON quiz_review_items(review_id);
CREATE INDEX IF NOT EXISTS idx_quiz_reviews_user_created
  ON quiz_reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_reviews_lecture_id
  ON quiz_reviews(lecture_id);
-- GIN index exists for the deferred pattern pass: "which confusions repeat?"
CREATE INDEX IF NOT EXISTS idx_quiz_review_items_confusion_tags
  ON quiz_review_items USING GIN (confusion_tags);

CREATE TRIGGER update_quiz_reviews_updated_at
  BEFORE UPDATE ON quiz_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quiz_review_items_updated_at
  BEFORE UPDATE ON quiz_review_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quiz_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_review_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quiz reviews"
  ON quiz_reviews FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Users can create own quiz reviews"
  ON quiz_reviews FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own quiz reviews"
  ON quiz_reviews FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own quiz reviews"
  ON quiz_reviews FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can view own quiz review items"
  ON quiz_review_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can create own quiz review items"
  ON quiz_review_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can update own quiz review items"
  ON quiz_review_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can delete own quiz review items"
  ON quiz_review_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
