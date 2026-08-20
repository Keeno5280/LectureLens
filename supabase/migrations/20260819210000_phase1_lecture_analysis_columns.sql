/*
  # Phase 1 — lecture analysis columns

  Additive only. The old n8n pipeline PATCHed key_points / important_terms /
  exam_questions / flashcards onto `lectures`; none of those columns existed, so
  PostgREST returned 400 and n8n never checked the response. That — not the dead
  webhook — is why audio processing never completed.

  `claims` and `distinctions` exist for Phase 2 (quiz-miss diagnosis): a diagnosis
  must cite the lecture verbatim and name the distinction the student collapsed.

  Note: 'processing' is retained in the status machine for backward compatibility.
  It is still read in the Dashboard, SearchBar, ClassNotesPage, UploadPage, and DebugPanel.
  It will be retired deliberately in a later phase; do not remove it without coordinating
  that deprecation.
*/

ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS key_points        jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS important_terms   jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exam_questions    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS claims            jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS distinctions      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_error  text,
  ADD COLUMN IF NOT EXISTS transcript_source text;

ALTER TABLE lectures DROP CONSTRAINT IF EXISTS lectures_processing_status_check;
ALTER TABLE lectures ADD CONSTRAINT lectures_processing_status_check
  CHECK (processing_status IN
    ('pending','processing','transcribing','transcribed','analyzing','completed','failed'));

CREATE INDEX IF NOT EXISTS idx_lectures_status_updated
  ON lectures (processing_status, updated_at)
  WHERE processing_status IN ('transcribing','analyzing');
