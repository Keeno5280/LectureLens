/*
  # Disable RLS on Tutor Tables for Testing
  
  ## Overview
  Temporarily disable RLS on tutor tables to allow unauthenticated testing.
  This is for development purposes using MOCK_USER_ID.
  
  ## Changes Made
  - Disable RLS on all tutor-related tables
  
  ## Security Notes
  This is ONLY for testing. In production, RLS should be re-enabled with proper policies.
*/

-- Disable RLS on tutor tables
ALTER TABLE tutor_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE saved_tutor_responses DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_flashcards DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_context_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_quick_actions DISABLE ROW LEVEL SECURITY;
