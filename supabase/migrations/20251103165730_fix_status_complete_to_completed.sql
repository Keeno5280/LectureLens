/*
  # Fix Processing Status Values

  ## Problem
  n8n workflow is setting processing_status to "complete" (8 chars)
  but frontend expects "completed" (9 chars).

  ## Solution
  1. Update all existing "complete" records to "completed"
  2. Add trigger to automatically fix any future "complete" values
  3. Add constraint to ensure only valid status values

  ## Valid Status Values
  - "pending" - Initial state after upload
  - "processing" - Currently being processed
  - "completed" - Successfully processed (correct spelling)
  - "failed" - Processing error
*/

-- Fix existing data: Update "complete" to "completed"
UPDATE lectures
SET processing_status = 'completed'
WHERE processing_status = 'complete';

-- Create function to normalize status values
CREATE OR REPLACE FUNCTION normalize_processing_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Automatically fix "complete" to "completed"
  IF NEW.processing_status = 'complete' THEN
    NEW.processing_status = 'completed';
    RAISE NOTICE 'Auto-corrected processing_status from "complete" to "completed" for lecture %', NEW.id;
  END IF;

  -- Ensure only valid status values
  IF NEW.processing_status NOT IN ('pending', 'processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid processing_status: %. Must be: pending, processing, completed, or failed', NEW.processing_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to normalize status on INSERT and UPDATE
DROP TRIGGER IF EXISTS normalize_lecture_status ON lectures;
CREATE TRIGGER normalize_lecture_status
  BEFORE INSERT OR UPDATE ON lectures
  FOR EACH ROW
  EXECUTE FUNCTION normalize_processing_status();

-- Add check constraint for valid status values (will work after normalization)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'lectures_processing_status_check'
  ) THEN
    ALTER TABLE lectures
    ADD CONSTRAINT lectures_processing_status_check
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
END $$;

-- Log the fix
DO $$
DECLARE
  fixed_count integer;
BEGIN
  SELECT COUNT(*) INTO fixed_count
  FROM lectures
  WHERE processing_status = 'completed'
  AND updated_at > NOW() - INTERVAL '1 minute';
  
  RAISE NOTICE 'Fixed % lecture(s) from "complete" to "completed"', fixed_count;
  RAISE NOTICE 'Trigger added to auto-normalize future updates';
END $$;
