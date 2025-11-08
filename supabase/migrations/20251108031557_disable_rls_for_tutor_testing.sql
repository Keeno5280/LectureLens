/*
  # Disable RLS on Tutor Tables for Testing

  ## Overview
  Temporarily disable RLS on tutor tables to allow testing without authentication.

  ## Changes Made
  - Disable RLS on tutor_conversations
  - Disable RLS on tutor_messages
  - Disable RLS on saved_tutor_responses
  - Disable RLS on tutor_flashcards
  - Disable RLS on tutor_quick_actions
  - Disable RLS on tutor_context_cache

  ## Security Notes
  This is ONLY for development/testing. In production, RLS should be re-enabled.
*/

ALTER TABLE tutor_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE saved_tutor_responses DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_flashcards DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_quick_actions DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_context_cache DISABLE ROW LEVEL SECURITY;
