/*
  # Allow Anonymous Access to Tutor Tables
  
  ## Overview
  This migration fixes RLS policies to allow unauthenticated access for testing.
  The frontend uses the anon key and MOCK_USER_ID for testing purposes.
  
  ## Changes Made
  - Update all tutor table policies to allow anon role access
  - Policies now check: auth.uid() OR user_id IS NULL OR current_user = 'anon'
  
  ## Security Notes
  This is for development/testing. In production, you would restrict to authenticated users only.
*/

-- Drop and recreate tutor_conversations policies with anon access
DROP POLICY IF EXISTS "Users can view own conversations" ON tutor_conversations;
CREATE POLICY "Users can view own conversations"
  ON tutor_conversations FOR SELECT
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can create conversations" ON tutor_conversations;
CREATE POLICY "Users can create conversations"
  ON tutor_conversations FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'anon' OR auth.role() = 'authenticated' OR true);

DROP POLICY IF EXISTS "Users can update own conversations" ON tutor_conversations;
CREATE POLICY "Users can update own conversations"
  ON tutor_conversations FOR UPDATE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon')
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can delete own conversations" ON tutor_conversations;
CREATE POLICY "Users can delete own conversations"
  ON tutor_conversations FOR DELETE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

-- Drop and recreate tutor_messages policies with anon access
DROP POLICY IF EXISTS "Users can view messages from their conversations" ON tutor_messages;
CREATE POLICY "Users can view messages from their conversations"
  ON tutor_messages FOR SELECT
  TO public
  USING (
    auth.role() = 'anon' OR
    EXISTS (
      SELECT 1 FROM tutor_conversations
      WHERE tutor_conversations.id = tutor_messages.conversation_id
      AND (tutor_conversations.user_id = auth.uid() OR tutor_conversations.user_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can create messages" ON tutor_messages;
CREATE POLICY "Users can create messages"
  ON tutor_messages FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'anon' OR auth.role() = 'authenticated' OR true);

-- Drop and recreate saved_tutor_responses policies with anon access
DROP POLICY IF EXISTS "Users can view own saved responses" ON saved_tutor_responses;
CREATE POLICY "Users can view own saved responses"
  ON saved_tutor_responses FOR SELECT
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can create saved responses" ON saved_tutor_responses;
CREATE POLICY "Users can create saved responses"
  ON saved_tutor_responses FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'anon' OR auth.role() = 'authenticated' OR true);

DROP POLICY IF EXISTS "Users can update own saved responses" ON saved_tutor_responses;
CREATE POLICY "Users can update own saved responses"
  ON saved_tutor_responses FOR UPDATE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can delete own saved responses" ON saved_tutor_responses;
CREATE POLICY "Users can delete own saved responses"
  ON saved_tutor_responses FOR DELETE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

-- Drop and recreate tutor_flashcards policies with anon access
DROP POLICY IF EXISTS "Users can view own tutor flashcards" ON tutor_flashcards;
CREATE POLICY "Users can view own tutor flashcards"
  ON tutor_flashcards FOR SELECT
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can create tutor flashcards" ON tutor_flashcards;
CREATE POLICY "Users can create tutor flashcards"
  ON tutor_flashcards FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'anon' OR auth.role() = 'authenticated' OR true);

DROP POLICY IF EXISTS "Users can update own tutor flashcards" ON tutor_flashcards;
CREATE POLICY "Users can update own tutor flashcards"
  ON tutor_flashcards FOR UPDATE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can delete own tutor flashcards" ON tutor_flashcards;
CREATE POLICY "Users can delete own tutor flashcards"
  ON tutor_flashcards FOR DELETE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

-- Drop and recreate tutor_quick_actions policies with anon access
DROP POLICY IF EXISTS "Users can view own quick actions" ON tutor_quick_actions;
CREATE POLICY "Users can view own quick actions"
  ON tutor_quick_actions FOR SELECT
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can create quick actions" ON tutor_quick_actions;
CREATE POLICY "Users can create quick actions"
  ON tutor_quick_actions FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'anon' OR auth.role() = 'authenticated' OR true);

DROP POLICY IF EXISTS "Users can update own quick actions" ON tutor_quick_actions;
CREATE POLICY "Users can update own quick actions"
  ON tutor_quick_actions FOR UPDATE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can delete own quick actions" ON tutor_quick_actions;
CREATE POLICY "Users can delete own quick actions"
  ON tutor_quick_actions FOR DELETE
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

-- Drop and recreate tutor_context_cache policies with anon access
DROP POLICY IF EXISTS "Users can view own cached content" ON tutor_context_cache;
CREATE POLICY "Users can view own cached content"
  ON tutor_context_cache FOR SELECT
  TO public
  USING (user_id = auth.uid() OR user_id IS NULL OR auth.role() = 'anon');

DROP POLICY IF EXISTS "System can create cache entries" ON tutor_context_cache;
CREATE POLICY "System can create cache entries"
  ON tutor_context_cache FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'anon' OR auth.role() = 'authenticated' OR true);

DROP POLICY IF EXISTS "System can update cache entries" ON tutor_context_cache;
CREATE POLICY "System can update cache entries"
  ON tutor_context_cache FOR UPDATE
  TO public
  USING (true);
