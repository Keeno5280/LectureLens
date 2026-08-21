/*
  # Freeze the ownership columns on quiz_reviews (and record dropped citations)

  ## Why the trigger exists

  `quiz_reviews`' UPDATE policy is `user_id = auth.uid()` on both USING and
  WITH CHECK. That is ROW-scoped, not COLUMN-scoped: the owner of a row may
  rewrite any column in it, including `lecture_id`. RLS is satisfied the whole
  time because `user_id` never moves.

  That made a cross-user disclosure possible straight from the browser console:

      supabase.from('quiz_reviews')
        .update({ lecture_id: SOMEONE_ELSES_LECTURE })
        .eq('id', MY_REVIEW_ID)
      supabase.functions.invoke('diagnose-miss', { body: { itemId: MY_ITEM_ID } })

  `diagnose-miss` then loaded that lecture with the service-role key and wrote
  verbatim excerpts of it into a row the attacker can read back.

  The authorizer now walks item → review → LECTURE → owner and rejects a
  lecture the caller does not own (`_shared/auth.ts`). This trigger closes the
  other half: the repoint itself no longer succeeds, so no review can ever name
  a lecture its owner cannot see.

  Both halves are kept. The check in the function protects rows repointed by any
  future path; the trigger protects the data even if a function is deployed
  without it.

  Nothing legitimate breaks: the browser only ever updates `status` (and, on
  items, the student's corrections). `lecture_id` and `user_id` are written once,
  at INSERT, by `parse-quiz` under the service-role key.

  ## Why dropped_citations exists

  Citations the model fabricates are verified away in `diagnose-miss` before
  they can be shown to a student who came here precisely because they cannot
  catch them. Until now that was a `console.warn` nobody would ever see: a
  `covered` diagnosis whose every quote was rejected renders identically to one
  the model simply chose not to cite. The count is persisted so the card can say
  so out loud. It is a column, not a field inside `diagnosis`, for the same
  reason `confusion_tags` is — it is a fact about the verification pass, and it
  is the one number worth aggregating if fabrication rates ever need watching.
*/

CREATE OR REPLACE FUNCTION public.quiz_reviews_freeze_ownership_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.lecture_id IS DISTINCT FROM OLD.lecture_id THEN
    RAISE EXCEPTION 'quiz_reviews.lecture_id is immutable: a review cannot be repointed at another lecture.';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'quiz_reviews.user_id is immutable: a review cannot change owner.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_reviews_freeze_ownership ON quiz_reviews;
CREATE TRIGGER quiz_reviews_freeze_ownership
  BEFORE UPDATE ON quiz_reviews
  FOR EACH ROW EXECUTE FUNCTION public.quiz_reviews_freeze_ownership_columns();

ALTER TABLE quiz_review_items
  ADD COLUMN IF NOT EXISTS dropped_citations integer NOT NULL DEFAULT 0;
