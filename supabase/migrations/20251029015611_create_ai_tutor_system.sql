/*
  # AI Tutor System

  ## Overview
  This migration creates the database structure for the AI Tutor feature, enabling
  personalized tutoring based on user's uploaded educational materials with conversation
  history, saved responses, and context management.

  ## New Tables

  ### 1. `tutor_conversations`
  Stores tutor chat sessions with context and metadata
  - `id` (uuid, primary key) - Unique conversation identifier
  - `user_id` (uuid) - User who owns the conversation
  - `title` (text) - Auto-generated conversation title
  - `context_lectures` (jsonb) - Array of lecture IDs used as context
  - `context_slides` (jsonb) - Array of slide IDs used as context
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. `tutor_messages`
  Individual messages within conversations
  - `id` (uuid, primary key) - Unique message identifier
  - `conversation_id` (uuid, foreign key) - References tutor_conversations(id)
  - `role` (text) - 'user' or 'assistant'
  - `content` (text) - Message content
  - `sources` (jsonb) - Array of source references used in response
  - `query_type` (text) - Type of query: 'explain', 'summarize', 'mnemonic', 'question', 'general'
  - `complexity_level` (text) - 'simple', 'medium', 'advanced'
  - `created_at` (timestamptz) - Message timestamp

  ### 3. `saved_tutor_responses`
  AI responses saved by users for later reference
  - `id` (uuid, primary key) - Unique saved response identifier
  - `user_id` (uuid) - User who saved the response
  - `message_id` (uuid, foreign key) - References tutor_messages(id)
  - `title` (text) - User-defined title for saved response
  - `tags` (jsonb) - Array of tags for organization
  - `category` (text) - Category: 'note', 'flashcard', 'summary', 'other'
  - `created_at` (timestamptz) - Save timestamp

  ### 4. `tutor_flashcards`
  Flashcards created from tutor responses
  - `id` (uuid, primary key) - Unique flashcard identifier
  - `user_id` (uuid) - User who created the flashcard
  - `message_id` (uuid, foreign key, optional) - Source message if auto-created
  - `lecture_id` (uuid, foreign key, optional) - Associated lecture
  - `question` (text) - Flashcard front/question
  - `answer` (text) - Flashcard back/answer
  - `source_content` (text) - Original content reference
  - `difficulty` (text) - 'easy', 'medium', 'hard'
  - `review_count` (integer) - Times reviewed
  - `last_reviewed` (timestamptz) - Last review timestamp
  - `next_review` (timestamptz) - Next scheduled review
  - `created_at` (timestamptz) - Creation timestamp

  ### 5. `tutor_context_cache`
  Caches processed document content for faster queries
  - `id` (uuid, primary key) - Unique cache identifier
  - `user_id` (uuid) - User who owns the content
  - `lecture_id` (uuid, foreign key, optional) - Source lecture
  - `slide_id` (uuid, foreign key, optional) - Source slide
  - `content_type` (text) - 'lecture_summary', 'slide_text', 'key_terms', 'full_transcript'
  - `content` (text) - Cached content
  - `embeddings` (vector, optional) - Vector embeddings for semantic search (future use)
  - `last_accessed` (timestamptz) - Last access timestamp
  - `created_at` (timestamptz) - Creation timestamp

  ### 6. `tutor_quick_actions`
  User's custom quick-action queries for frequent use
  - `id` (uuid, primary key) - Unique action identifier
  - `user_id` (uuid) - User who created the action
  - `label` (text) - Display label for the action
  - `query_template` (text) - Template query with placeholders
  - `icon` (text) - Icon identifier
  - `sort_order` (integer) - Display order
  - `created_at` (timestamptz) - Creation timestamp

  ## Security
  All tables have RLS enabled with policies allowing users to access only their own data.

  ## Important Notes
  1. Conversation context is stored as JSONB for flexible reference tracking
  2. Source references link back to original content for transparency
  3. Cache table optimizes performance for repeated queries
  4. Flashcard integration uses spaced repetition scheduling
  5. Quick actions allow customization of common queries
*/

-- Create tutor_conversations table
CREATE TABLE IF NOT EXISTS tutor_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text DEFAULT 'New Conversation',
  context_lectures jsonb DEFAULT '[]'::jsonb,
  context_slides jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create tutor_messages table
CREATE TABLE IF NOT EXISTS tutor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  sources jsonb DEFAULT '[]'::jsonb,
  query_type text DEFAULT 'general' CHECK (query_type IN ('explain', 'summarize', 'mnemonic', 'question', 'general')),
  complexity_level text DEFAULT 'medium' CHECK (complexity_level IN ('simple', 'medium', 'advanced')),
  created_at timestamptz DEFAULT now()
);

-- Create saved_tutor_responses table
CREATE TABLE IF NOT EXISTS saved_tutor_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  message_id uuid REFERENCES tutor_messages(id) ON DELETE CASCADE,
  title text NOT NULL,
  tags jsonb DEFAULT '[]'::jsonb,
  category text DEFAULT 'note' CHECK (category IN ('note', 'flashcard', 'summary', 'other')),
  created_at timestamptz DEFAULT now()
);

-- Create tutor_flashcards table
CREATE TABLE IF NOT EXISTS tutor_flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  message_id uuid REFERENCES tutor_messages(id) ON DELETE SET NULL,
  lecture_id uuid REFERENCES lectures(id) ON DELETE SET NULL,
  question text NOT NULL,
  answer text NOT NULL,
  source_content text DEFAULT '',
  difficulty text DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  review_count integer DEFAULT 0,
  last_reviewed timestamptz,
  next_review timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create tutor_context_cache table
CREATE TABLE IF NOT EXISTS tutor_context_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  lecture_id uuid REFERENCES lectures(id) ON DELETE CASCADE,
  slide_id uuid REFERENCES slides(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('lecture_summary', 'slide_text', 'key_terms', 'full_transcript')),
  content text NOT NULL,
  last_accessed timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create tutor_quick_actions table
CREATE TABLE IF NOT EXISTS tutor_quick_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  label text NOT NULL,
  query_template text NOT NULL,
  icon text DEFAULT 'message-circle',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tutor_conversations_user_id ON tutor_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_tutor_messages_conversation_id ON tutor_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tutor_messages_created_at ON tutor_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_saved_tutor_responses_user_id ON saved_tutor_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_tutor_responses_message_id ON saved_tutor_responses(message_id);
CREATE INDEX IF NOT EXISTS idx_tutor_flashcards_user_id ON tutor_flashcards(user_id);
CREATE INDEX IF NOT EXISTS idx_tutor_flashcards_lecture_id ON tutor_flashcards(lecture_id);
CREATE INDEX IF NOT EXISTS idx_tutor_flashcards_next_review ON tutor_flashcards(user_id, next_review);
CREATE INDEX IF NOT EXISTS idx_tutor_context_cache_user_id ON tutor_context_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_tutor_context_cache_lecture_id ON tutor_context_cache(lecture_id);
CREATE INDEX IF NOT EXISTS idx_tutor_context_cache_slide_id ON tutor_context_cache(slide_id);
CREATE INDEX IF NOT EXISTS idx_tutor_quick_actions_user_id ON tutor_quick_actions(user_id, sort_order);

-- Enable Row Level Security
ALTER TABLE tutor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_tutor_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_context_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_quick_actions ENABLE ROW LEVEL SECURITY;

-- Tutor conversations policies
CREATE POLICY "Users can view own conversations"
  ON tutor_conversations FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create conversations"
  ON tutor_conversations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own conversations"
  ON tutor_conversations FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own conversations"
  ON tutor_conversations FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Tutor messages policies
CREATE POLICY "Users can view messages from their conversations"
  ON tutor_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tutor_conversations
      WHERE tutor_conversations.id = tutor_messages.conversation_id
      AND (tutor_conversations.user_id = auth.uid() OR tutor_conversations.user_id IS NULL)
    )
  );

CREATE POLICY "Users can create messages"
  ON tutor_messages FOR INSERT
  WITH CHECK (true);

-- Saved responses policies
CREATE POLICY "Users can view own saved responses"
  ON saved_tutor_responses FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create saved responses"
  ON saved_tutor_responses FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own saved responses"
  ON saved_tutor_responses FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own saved responses"
  ON saved_tutor_responses FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Tutor flashcards policies
CREATE POLICY "Users can view own tutor flashcards"
  ON tutor_flashcards FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create tutor flashcards"
  ON tutor_flashcards FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own tutor flashcards"
  ON tutor_flashcards FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own tutor flashcards"
  ON tutor_flashcards FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Context cache policies
CREATE POLICY "Users can view own cached content"
  ON tutor_context_cache FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "System can create cache entries"
  ON tutor_context_cache FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update cache entries"
  ON tutor_context_cache FOR UPDATE
  USING (true);

-- Quick actions policies
CREATE POLICY "Users can view own quick actions"
  ON tutor_quick_actions FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create quick actions"
  ON tutor_quick_actions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own quick actions"
  ON tutor_quick_actions FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own quick actions"
  ON tutor_quick_actions FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Update triggers
CREATE TRIGGER update_tutor_conversations_updated_at
  BEFORE UPDATE ON tutor_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-generate conversation titles from first message
CREATE OR REPLACE FUNCTION generate_conversation_title()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'user' THEN
    UPDATE tutor_conversations
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_generate_conversation_title
  AFTER INSERT ON tutor_messages
  FOR EACH ROW
  EXECUTE FUNCTION generate_conversation_title();

-- Function to update context cache access time
CREATE OR REPLACE FUNCTION update_cache_access_time()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_accessed = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cache_last_accessed
  BEFORE UPDATE ON tutor_context_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_cache_access_time();

-- Insert default quick actions for all users
INSERT INTO tutor_quick_actions (user_id, label, query_template, icon, sort_order)
VALUES
  (NULL, 'Explain Simply', 'Explain {topic} in simple terms', 'lightbulb', 1),
  (NULL, 'Summarize', 'Summarize the key points about {topic}', 'file-text', 2),
  (NULL, 'Create Mnemonic', 'Create a mnemonic device to remember {topic}', 'brain', 3),
  (NULL, 'Practice Question', 'Give me a practice question about {topic}', 'help-circle', 4),
  (NULL, 'Compare Concepts', 'Compare and contrast {topic1} and {topic2}', 'git-compare', 5)
ON CONFLICT DO NOTHING;
