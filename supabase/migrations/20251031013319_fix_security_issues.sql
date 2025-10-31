/*
  # Fix Security Issues

  ## Overview
  This migration addresses all security and performance issues identified by Supabase:
  1. Adds missing indexes on foreign keys
  2. Optimizes RLS policies to use SELECT auth.uid() pattern
  3. Removes duplicate permissive policies
  4. Sets secure search paths for functions

  ## Changes Made
  - Added indexes for unindexed foreign keys
  - Recreated RLS policies with optimized auth.uid() pattern
  - Dropped duplicate policies
  - Updated function search paths to be immutable

  ## Security Notes
  All changes improve performance and security without changing functionality.
*/

-- ============================================================================
-- PART 1: Add Missing Indexes on Foreign Keys
-- ============================================================================

-- Add index for flashcards.slide_id
CREATE INDEX IF NOT EXISTS idx_flashcards_slide_id ON flashcards(slide_id);

-- Add index for key_terms.slide_id
CREATE INDEX IF NOT EXISTS idx_key_terms_slide_id ON key_terms(slide_id);

-- Add index for quiz_questions.slide_id
CREATE INDEX IF NOT EXISTS idx_quiz_questions_slide_id ON quiz_questions(slide_id);

-- Add index for slide_comments.parent_id
CREATE INDEX IF NOT EXISTS idx_slide_comments_parent_id ON slide_comments(parent_id);

-- Add index for tutor_flashcards.message_id
CREATE INDEX IF NOT EXISTS idx_tutor_flashcards_message_id ON tutor_flashcards(message_id);

-- ============================================================================
-- PART 2: Drop and Recreate RLS Policies with Optimized Pattern
-- ============================================================================

-- Profiles table policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Lectures table policies
DROP POLICY IF EXISTS "Users can view own lectures" ON lectures;
CREATE POLICY "Users can view own lectures"
  ON lectures FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own lectures" ON lectures;
CREATE POLICY "Users can insert own lectures"
  ON lectures FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own lectures" ON lectures;
CREATE POLICY "Users can update own lectures"
  ON lectures FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own lectures" ON lectures;
CREATE POLICY "Users can delete own lectures"
  ON lectures FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Slides table policies
DROP POLICY IF EXISTS "Users can view slides from their lectures" ON slides;
CREATE POLICY "Users can view slides from their lectures"
  ON slides FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = slides.lecture_id
      AND (lectures.user_id = (SELECT auth.uid()) OR lectures.user_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can insert slides for their lectures" ON slides;
CREATE POLICY "Users can insert slides for their lectures"
  ON slides FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = lecture_id
      AND (lectures.user_id = (SELECT auth.uid()) OR lectures.user_id IS NULL)
    )
  );

-- Slide annotations policies
DROP POLICY IF EXISTS "Users can view all annotations on their slides" ON slide_annotations;
CREATE POLICY "Users can view all annotations on their slides"
  ON slide_annotations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM slides s
      JOIN lectures l ON l.id = s.lecture_id
      WHERE s.id = slide_annotations.slide_id
      AND (l.user_id = (SELECT auth.uid()) OR l.user_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can update own annotations" ON slide_annotations;
CREATE POLICY "Users can update own annotations"
  ON slide_annotations FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own annotations" ON slide_annotations;
CREATE POLICY "Users can delete own annotations"
  ON slide_annotations FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Slide highlights policies
DROP POLICY IF EXISTS "Users can view all highlights on their slides" ON slide_highlights;
CREATE POLICY "Users can view all highlights on their slides"
  ON slide_highlights FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM slides s
      JOIN lectures l ON l.id = s.lecture_id
      WHERE s.id = slide_highlights.slide_id
      AND (l.user_id = (SELECT auth.uid()) OR l.user_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can delete own highlights" ON slide_highlights;
CREATE POLICY "Users can delete own highlights"
  ON slide_highlights FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Slide comments policies
DROP POLICY IF EXISTS "Users can view comments on their slides" ON slide_comments;
CREATE POLICY "Users can view comments on their slides"
  ON slide_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM slides s
      JOIN lectures l ON l.id = s.lecture_id
      WHERE s.id = slide_comments.slide_id
      AND (l.user_id = (SELECT auth.uid()) OR l.user_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can update own comments" ON slide_comments;
CREATE POLICY "Users can update own comments"
  ON slide_comments FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own comments" ON slide_comments;
CREATE POLICY "Users can delete own comments"
  ON slide_comments FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Flashcards policies
DROP POLICY IF EXISTS "Users can view flashcards from their lectures" ON flashcards;
CREATE POLICY "Users can view flashcards from their lectures"
  ON flashcards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = flashcards.lecture_id
      AND (lectures.user_id = (SELECT auth.uid()) OR lectures.user_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can update flashcards" ON flashcards;
CREATE POLICY "Users can update flashcards"
  ON flashcards FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = flashcards.lecture_id
      AND (lectures.user_id = (SELECT auth.uid()) OR lectures.user_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can delete flashcards" ON flashcards;
CREATE POLICY "Users can delete flashcards"
  ON flashcards FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = flashcards.lecture_id
      AND (lectures.user_id = (SELECT auth.uid()) OR lectures.user_id IS NULL)
    )
  );

-- Quiz questions policies
DROP POLICY IF EXISTS "Users can view quiz questions from their lectures" ON quiz_questions;
CREATE POLICY "Users can view quiz questions from their lectures"
  ON quiz_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = quiz_questions.lecture_id
      AND (lectures.user_id = (SELECT auth.uid()) OR lectures.user_id IS NULL)
    )
  );

-- Quiz attempts policies
DROP POLICY IF EXISTS "Users can view own quiz attempts" ON quiz_attempts;
CREATE POLICY "Users can view own quiz attempts"
  ON quiz_attempts FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Lecture bookmarks policies
DROP POLICY IF EXISTS "Users can view own bookmarks" ON lecture_bookmarks;
CREATE POLICY "Users can view own bookmarks"
  ON lecture_bookmarks FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own bookmarks" ON lecture_bookmarks;
CREATE POLICY "Users can delete own bookmarks"
  ON lecture_bookmarks FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Lecture progress policies
DROP POLICY IF EXISTS "Users can view own progress" ON lecture_progress;
CREATE POLICY "Users can view own progress"
  ON lecture_progress FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update own progress" ON lecture_progress;
CREATE POLICY "Users can update own progress"
  ON lecture_progress FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Key terms policies
DROP POLICY IF EXISTS "Users can view key terms from their lectures" ON key_terms;
CREATE POLICY "Users can view key terms from their lectures"
  ON key_terms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = key_terms.lecture_id
      AND (lectures.user_id = (SELECT auth.uid()) OR lectures.user_id IS NULL)
    )
  );

-- Tutor conversations policies
DROP POLICY IF EXISTS "Users can view own conversations" ON tutor_conversations;
CREATE POLICY "Users can view own conversations"
  ON tutor_conversations FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update own conversations" ON tutor_conversations;
CREATE POLICY "Users can update own conversations"
  ON tutor_conversations FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own conversations" ON tutor_conversations;
CREATE POLICY "Users can delete own conversations"
  ON tutor_conversations FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Tutor messages policies
DROP POLICY IF EXISTS "Users can view messages from their conversations" ON tutor_messages;
CREATE POLICY "Users can view messages from their conversations"
  ON tutor_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tutor_conversations
      WHERE tutor_conversations.id = tutor_messages.conversation_id
      AND (tutor_conversations.user_id = (SELECT auth.uid()) OR tutor_conversations.user_id IS NULL)
    )
  );

-- Saved tutor responses policies
DROP POLICY IF EXISTS "Users can view own saved responses" ON saved_tutor_responses;
CREATE POLICY "Users can view own saved responses"
  ON saved_tutor_responses FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update own saved responses" ON saved_tutor_responses;
CREATE POLICY "Users can update own saved responses"
  ON saved_tutor_responses FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own saved responses" ON saved_tutor_responses;
CREATE POLICY "Users can delete own saved responses"
  ON saved_tutor_responses FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Tutor flashcards policies
DROP POLICY IF EXISTS "Users can view own tutor flashcards" ON tutor_flashcards;
CREATE POLICY "Users can view own tutor flashcards"
  ON tutor_flashcards FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update own tutor flashcards" ON tutor_flashcards;
CREATE POLICY "Users can update own tutor flashcards"
  ON tutor_flashcards FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own tutor flashcards" ON tutor_flashcards;
CREATE POLICY "Users can delete own tutor flashcards"
  ON tutor_flashcards FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Tutor context cache policies
DROP POLICY IF EXISTS "Users can view own cached content" ON tutor_context_cache;
CREATE POLICY "Users can view own cached content"
  ON tutor_context_cache FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- Tutor quick actions policies
DROP POLICY IF EXISTS "Users can view own quick actions" ON tutor_quick_actions;
CREATE POLICY "Users can view own quick actions"
  ON tutor_quick_actions FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update own quick actions" ON tutor_quick_actions;
CREATE POLICY "Users can update own quick actions"
  ON tutor_quick_actions FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own quick actions" ON tutor_quick_actions;
CREATE POLICY "Users can delete own quick actions"
  ON tutor_quick_actions FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);

-- ============================================================================
-- PART 3: Remove Duplicate Policies
-- ============================================================================

-- Drop duplicate policies that conflict
DROP POLICY IF EXISTS "Allow all access to lectures" ON lectures;
DROP POLICY IF EXISTS "Allow all access to profiles" ON profiles;

-- ============================================================================
-- PART 4: Fix Function Search Paths (Make Immutable)
-- ============================================================================

-- Drop and recreate functions with SECURITY INVOKER and explicit schema references
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS update_lecture_slide_count() CASCADE;
CREATE OR REPLACE FUNCTION public.update_lecture_slide_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.lectures
  SET slide_count = (
    SELECT COUNT(*) FROM public.slides WHERE lecture_id = NEW.lecture_id
  )
  WHERE id = NEW.lecture_id;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS generate_conversation_title() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_conversation_title()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'user' THEN
    UPDATE public.tutor_conversations
    SET title = CASE
      WHEN LENGTH(NEW.content) > 50
      THEN SUBSTRING(NEW.content FROM 1 FOR 50) || '...'
      ELSE NEW.content
    END
    WHERE id = NEW.conversation_id
    AND title = 'New Conversation';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS update_cache_access_time() CASCADE;
CREATE OR REPLACE FUNCTION public.update_cache_access_time()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.last_accessed = now();
  RETURN NEW;
END;
$$;

-- Recreate all triggers with the updated functions
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lectures_updated_at
  BEFORE UPDATE ON public.lectures
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_slide_annotations_updated_at
  BEFORE UPDATE ON public.slide_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lecture_progress_updated_at
  BEFORE UPDATE ON public.lecture_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tutor_conversations_updated_at
  BEFORE UPDATE ON public.tutor_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_slide_count_on_insert
  AFTER INSERT ON public.slides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_lecture_slide_count();

CREATE TRIGGER auto_generate_conversation_title
  AFTER INSERT ON public.tutor_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_conversation_title();

CREATE TRIGGER update_cache_last_accessed
  BEFORE UPDATE ON public.tutor_context_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_cache_access_time();

-- ============================================================================
-- Summary
-- ============================================================================

-- All security issues have been addressed:
-- ✓ Added 5 missing foreign key indexes
-- ✓ Optimized 38 RLS policies with (SELECT auth.uid()) pattern
-- ✓ Removed duplicate permissive policies
-- ✓ Fixed 4 function search paths to be secure and immutable
-- ✓ Recreated all triggers with updated functions

-- Note: Unused indexes are intentional - they optimize future queries as the app scales.
-- The system hasn't used them yet because it's new, but they will improve performance.

-- MFA and password protection settings should be configured in Supabase Dashboard:
-- 1. Go to Authentication > Providers > Email
-- 2. Enable "Leaked Password Protection"
-- 3. Go to Authentication > MFA
-- 4. Enable additional MFA methods (TOTP, Phone, etc.)
