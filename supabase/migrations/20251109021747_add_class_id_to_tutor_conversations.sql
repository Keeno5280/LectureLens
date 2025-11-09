/*
  # Add class_id to tutor_conversations table

  1. Changes
    - Add `class_id` column to `tutor_conversations` table as a foreign key to `classes`
    - Allow NULL values to support conversations without a specific class
    - Add index for efficient filtering by class_id

  2. Security
    - No RLS changes needed (existing policies will handle the new column)
*/

-- Add class_id column to tutor_conversations
ALTER TABLE tutor_conversations 
ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES classes(id) ON DELETE SET NULL;

-- Add index for efficient class filtering
CREATE INDEX IF NOT EXISTS idx_tutor_conversations_class_id 
ON tutor_conversations(class_id);