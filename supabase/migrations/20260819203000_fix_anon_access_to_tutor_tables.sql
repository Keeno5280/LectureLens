/*
  # Revoke anonymous access to tutor tables

  ## Problem
  20251108024904_allow_anon_access_to_tutor.sql wrote policies containing
  `OR auth.role() = 'anon'` and `WITH CHECK (... OR true)`. Because the Supabase
  anon key's JWT carries role="anon", those disjuncts are unconditionally true for
  any anon-key request — and the anon key ships in the public JS bundle.

  Verified against the live database on 2026-08-19: 24 rows in tutor_messages are
  currently readable, updatable, and deletable by any anonymous caller.

  RLS is already ENABLED on all six tables (20251112025602). Only the policies are wrong.

  ## Note on `classes`
  The local migration history suggests `classes` also carries a permissive
  "Allow all access to classes" policy. It does NOT exist on the live database —
  live policies are correct own-row `TO authenticated`. No change needed here.

  ## Approach
  Drop every policy carrying an anon clause or a `true` tautology. Where a correct
  own-row policy already exists it is left in place; where none exists, one is created.
  All replacements are `TO authenticated` with `user_id = (SELECT auth.uid())`.

  `service_role` bypasses RLS entirely, so Edge Functions are unaffected.

  ## Deliberately preserved
  tutor_quick_actions keeps `user_id IS NULL` readable — those are seeded global
  action templates the app reads by design (TutorPage.tsx:201). Restricted to
  authenticated readers, and writes are own-row only.
*/

-- ============================================================
-- tutor_conversations  (correct SELECT/INSERT/DELETE already exist)
-- ============================================================
DROP POLICY IF EXISTS "Users can view own conversations"   ON tutor_conversations;
DROP POLICY IF EXISTS "Users can create conversations"     ON tutor_conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON tutor_conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON tutor_conversations;

CREATE POLICY "Users can update their own conversations"
  ON tutor_conversations FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================
-- tutor_messages  (correct SELECT/INSERT already exist)
-- ============================================================
DROP POLICY IF EXISTS "Users can view messages from their conversations" ON tutor_messages;
DROP POLICY IF EXISTS "Users can create messages"                        ON tutor_messages;

-- ============================================================
-- tutor_flashcards  (no correct policies exist — create all)
-- ============================================================
DROP POLICY IF EXISTS "Users can view own tutor flashcards"   ON tutor_flashcards;
DROP POLICY IF EXISTS "Users can create tutor flashcards"     ON tutor_flashcards;
DROP POLICY IF EXISTS "Users can update own tutor flashcards" ON tutor_flashcards;
DROP POLICY IF EXISTS "Users can delete own tutor flashcards" ON tutor_flashcards;

CREATE POLICY "own_select" ON tutor_flashcards FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "own_insert" ON tutor_flashcards FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "own_update" ON tutor_flashcards FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "own_delete" ON tutor_flashcards FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================
-- saved_tutor_responses  (no correct policies exist — create all)
-- ============================================================
DROP POLICY IF EXISTS "Users can view own saved responses"   ON saved_tutor_responses;
DROP POLICY IF EXISTS "Users can create saved responses"     ON saved_tutor_responses;
DROP POLICY IF EXISTS "Users can update own saved responses" ON saved_tutor_responses;
DROP POLICY IF EXISTS "Users can delete own saved responses" ON saved_tutor_responses;

CREATE POLICY "own_select" ON saved_tutor_responses FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "own_insert" ON saved_tutor_responses FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "own_update" ON saved_tutor_responses FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "own_delete" ON saved_tutor_responses FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================
-- tutor_context_cache  (UPDATE was USING(true) — anyone could rewrite any row)
-- ============================================================
DROP POLICY IF EXISTS "Users can view own cached content" ON tutor_context_cache;
DROP POLICY IF EXISTS "System can create cache entries"   ON tutor_context_cache;
DROP POLICY IF EXISTS "System can update cache entries"   ON tutor_context_cache;

CREATE POLICY "own_select" ON tutor_context_cache FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "own_insert" ON tutor_context_cache FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "own_update" ON tutor_context_cache FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================
-- tutor_quick_actions  (global seeded rows stay readable — authenticated only)
-- ============================================================
DROP POLICY IF EXISTS "Users can view own quick actions"   ON tutor_quick_actions;
DROP POLICY IF EXISTS "Users can create quick actions"     ON tutor_quick_actions;
DROP POLICY IF EXISTS "Users can update own quick actions" ON tutor_quick_actions;
DROP POLICY IF EXISTS "Users can delete own quick actions" ON tutor_quick_actions;

CREATE POLICY "own_or_global_select" ON tutor_quick_actions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);
CREATE POLICY "own_insert" ON tutor_quick_actions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "own_update" ON tutor_quick_actions FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "own_delete" ON tutor_quick_actions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
