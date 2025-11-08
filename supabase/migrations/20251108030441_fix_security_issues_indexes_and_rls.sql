/*
  # Fix Security Issues - Indexes and RLS
  
  ## Overview
  This migration addresses critical security and performance issues:
  - Adds missing indexes on foreign key columns
  - Removes duplicate RLS policies
  - Re-enables RLS on tutor tables (with permissive policies for testing)
  
  ## Changes Made
  
  ### 1. Performance Improvements - Add Indexes
  - ai_conversations: index on class_id
  - flashcards: index on slide_id
  - key_terms: index on slide_id
  - quiz_questions: index on slide_id
  - saved_tutor_responses: index on message_id
  - slide_annotations: index on slide_id
  - slide_comments: indexes on slide_id and parent_id
  - slide_highlights: index on slide_id
  - tutor_context_cache: index on slide_id
  - tutor_flashcards: index on message_id
  - tutor_messages: index on conversation_id
  
  ### 2. Fix Duplicate Policies
  - Remove duplicate INSERT policy on lecture_progress table
  
  ### 3. Re-enable RLS
  - Enable RLS on all tutor tables
  - Keep permissive policies for testing with anon access
  
  ## Security Notes
  RLS is enabled but policies are permissive for testing purposes.
  In production, policies should be restricted to authenticated users only.
*/

-- =====================================================
-- PART 1: Add Missing Indexes on Foreign Keys
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_ai_conversations_class_id 
  ON ai_conversations(class_id);

CREATE INDEX IF NOT EXISTS idx_flashcards_slide_id 
  ON flashcards(slide_id);

CREATE INDEX IF NOT EXISTS idx_key_terms_slide_id 
  ON key_terms(slide_id);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_slide_id 
  ON quiz_questions(slide_id);

CREATE INDEX IF NOT EXISTS idx_saved_tutor_responses_message_id 
  ON saved_tutor_responses(message_id);

CREATE INDEX IF NOT EXISTS idx_slide_annotations_slide_id 
  ON slide_annotations(slide_id);

CREATE INDEX IF NOT EXISTS idx_slide_comments_slide_id 
  ON slide_comments(slide_id);

CREATE INDEX IF NOT EXISTS idx_slide_comments_parent_id 
  ON slide_comments(parent_id);

CREATE INDEX IF NOT EXISTS idx_slide_highlights_slide_id 
  ON slide_highlights(slide_id);

CREATE INDEX IF NOT EXISTS idx_tutor_context_cache_slide_id 
  ON tutor_context_cache(slide_id);

CREATE INDEX IF NOT EXISTS idx_tutor_flashcards_message_id 
  ON tutor_flashcards(message_id);

CREATE INDEX IF NOT EXISTS idx_tutor_messages_conversation_id 
  ON tutor_messages(conversation_id);

-- =====================================================
-- PART 2: Fix Duplicate Policies on lecture_progress
-- =====================================================

-- Drop one of the duplicate INSERT policies
DROP POLICY IF EXISTS "Users can create progress records" ON lecture_progress;

-- Keep "Users can create progress" policy

-- =====================================================
-- PART 3: Re-enable RLS on Tutor Tables
-- =====================================================

-- Re-enable RLS (policies already exist from previous migrations)
ALTER TABLE tutor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_tutor_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_context_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_quick_actions ENABLE ROW LEVEL SECURITY;

-- Note: Policies are already permissive for testing (allow anon access)
-- This was set in migration: 20251108024904_allow_anon_access_to_tutor.sql
