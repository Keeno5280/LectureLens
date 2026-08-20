/*
  # Stuck-lecture reaper: cover 'pending', and actually schedule it

  Two defects found by the final whole-branch review:

  1. The reaper from 20260819220000 was WRITTEN BUT NEVER APPLIED — the function
     did not exist in the database, so nothing could reap anything.

  2. Even once created, nothing scheduled it. `grep -rn 'reap_stuck_lectures|cron'`
     over the repo returned only the CREATE and the REVOKE. A reaper that never
     runs is decoration.

  It also only covered 'transcribing'/'analyzing'. A row is INSERTed as 'pending'
  before the client invokes the analyzer, so a tab closed in that window strands it
  at 'pending' forever — the detail page then polls it every 5 seconds indefinitely.

  15 minutes is comfortably longer than any real transcription+analysis cycle
  (the verified end-to-end run was 61 seconds).
*/

CREATE OR REPLACE FUNCTION reap_stuck_lectures()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE reaped integer;
BEGIN
  UPDATE lectures
     SET processing_status = 'failed',
         processing_error  = CASE processing_status
           WHEN 'pending'      THEN 'Never started processing. The browser tab may have been closed before analysis began. Press Retry to try again.'
           WHEN 'transcribing' THEN 'Transcription timed out. The browser tab may have been closed during transcription. Press Retry to try again.'
           ELSE                     'Analysis timed out. Press Retry to try again.'
         END
   WHERE processing_status IN ('pending','transcribing','analyzing')
     AND updated_at < now() - interval '15 minutes';
  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

REVOKE ALL ON FUNCTION reap_stuck_lectures() FROM public, anon, authenticated;

-- The partial index from 20260819210000 covered only the two in-flight states;
-- widen it so the reaper's WHERE stays index-backed now that 'pending' is included.
DROP INDEX IF EXISTS idx_lectures_status_updated;
CREATE INDEX IF NOT EXISTS idx_lectures_status_updated
  ON lectures (processing_status, updated_at)
  WHERE processing_status IN ('pending','transcribing','analyzing');
