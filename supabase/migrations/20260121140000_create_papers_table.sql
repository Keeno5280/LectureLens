/*
  # Paper Lab System

  ## Overview
  Creates the `papers` table to store student drafts.
  Links papers to a specific `tutor_conversation` so context is preserved.

  ## New Tables
  - `papers`
    - `id` (uuid, PK)
    - `user_id` (uuid, FK)
    - `conversation_id` (uuid, FK) - One-to-one relationship with a chat
    - `title` (text)
    - `content` (jsonb) - Stores TipTap document structure
    - `created_at`
    - `updated_at`

  ## Security
  - Enable RLS
  - Policies for full CRUD by owner
*/

CREATE TABLE IF NOT EXISTS papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES tutor_conversations(id) ON DELETE SET NULL,
  title text DEFAULT 'Untitled Paper',
  content jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_papers_user_id ON papers(user_id);
CREATE INDEX IF NOT EXISTS idx_papers_conversation_id ON papers(conversation_id);

-- RLS
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own papers"
  ON papers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own papers"
  ON papers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own papers"
  ON papers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own papers"
  ON papers FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update timestamp
CREATE TRIGGER update_papers_updated_at
  BEFORE UPDATE ON papers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
