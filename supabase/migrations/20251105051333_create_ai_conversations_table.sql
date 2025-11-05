/*
  # Create AI Conversations Table for Persistent Chat History

  ## Overview
  Creates a new table to store AI tutor conversations with automatic summaries,
  enabling users to maintain chat history organized by class and search through
  previous conversations.

  ## New Tables
    - `ai_conversations`
      - `id` (uuid, primary key) - Unique conversation identifier
      - `user_id` (uuid, foreign key) - References auth.users
      - `class_id` (uuid, foreign key) - References classes table
      - `summary` (text, nullable) - AI-generated conversation summary
      - `messages` (jsonb) - Array of message objects with sender, text, timestamp
      - `created_at` (timestamptz) - When conversation started
      - `updated_at` (timestamptz) - Last message timestamp

  ## Security
    - Enable RLS on ai_conversations table
    - Users can only view/edit their own conversations
    - All operations require authentication

  ## Indexes
    - Index on user_id for fast user conversation lookup
    - Index on class_id for filtering by class
    - Index on updated_at for sorting by recent activity
*/

-- Create ai_conversations table
CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  summary text,
  messages jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_class_id ON ai_conversations(class_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_class ON ai_conversations(user_id, class_id);

-- Enable Row Level Security
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own conversations

-- Policy: Users can view their own conversations
CREATE POLICY "Users can view own conversations"
  ON ai_conversations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own conversations
CREATE POLICY "Users can create own conversations"
  ON ai_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own conversations
CREATE POLICY "Users can update own conversations"
  ON ai_conversations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own conversations
CREATE POLICY "Users can delete own conversations"
  ON ai_conversations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_ai_conversations_updated_at_trigger
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_conversations_updated_at();
