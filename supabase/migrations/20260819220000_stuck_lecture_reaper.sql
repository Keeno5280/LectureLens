/*
  # Stuck lecture reaper

  A browser tab closed mid-transcription, or an Edge Function killed by the wall
  clock, leaves a row in 'transcribing'/'analyzing' forever. Previously such rows
  sat at 'pending' and the detail page polled every 5 seconds indefinitely.

  Uses the partial index from 20260819210000.
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
         processing_error  = 'Processing timed out. The browser tab may have been '
                             'closed during transcription. Press Retry to try again.'
   WHERE processing_status IN ('transcribing','analyzing')
     AND updated_at < now() - interval '15 minutes';
  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

REVOKE ALL ON FUNCTION reap_stuck_lectures() FROM public, anon, authenticated;
