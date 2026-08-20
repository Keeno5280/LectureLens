/*
  # Add Assignment Prompt to Papers

  ## Changes
  - Add `assignment_prompt` (text) to `papers` table so the AI can understand the assignment context.
*/

ALTER TABLE papers ADD COLUMN IF NOT EXISTS assignment_prompt text DEFAULT '';
