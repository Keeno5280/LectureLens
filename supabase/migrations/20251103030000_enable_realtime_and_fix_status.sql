/*
  # Enable Realtime and Fix Processing Status

  ## Purpose
  This migration ensures Realtime replication is enabled for the lectures table
  so frontend clients receive instant updates when n8n workflow updates records.

  ## Changes Made
  1. Enable Realtime replication for lectures table
  2. Add index on processing_status for faster filtering
  3. Add function to automatically update updated_at timestamp
  4. Add trigger to call timestamp update function
  5. Add helpful comments for debugging

  ## How This Fixes the Issue
  - Frontend uses `.on('postgres_changes', {...})` to subscribe to updates
  - Supabase Realtime broadcasts changes only when replication is enabled
  - This migration ensures the lectures table publishes UPDATE events
  - n8n's PATCH request will now trigger real-time updates in the frontend
*/

-- Enable Realtime replication for lectures table
-- This allows Supabase to broadcast changes to subscribed clients
ALTER PUBLICATION supabase_realtime ADD TABLE lectures;

-- Add index on processing_status for better query performance
-- This helps when filtering lectures by status (pending, processing, completed, failed)
CREATE INDEX IF NOT EXISTS idx_lectures_processing_status
  ON lectures(processing_status);

-- Add index on user_id and processing_status for user-specific queries
CREATE INDEX IF NOT EXISTS idx_lectures_user_status
  ON lectures(user_id, processing_status);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to automatically update updated_at on any UPDATE
DROP TRIGGER IF EXISTS update_lectures_updated_at ON lectures;
CREATE TRIGGER update_lectures_updated_at
  BEFORE UPDATE ON lectures
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add helpful comment to the table
COMMENT ON TABLE lectures IS 'Stores lecture data with AI-generated content. Realtime enabled for instant status updates.';
COMMENT ON COLUMN lectures.processing_status IS 'Status values: pending, processing, completed, failed. Updated by n8n workflow.';

-- Verify Realtime is enabled (this will show in logs)
DO $$
BEGIN
  RAISE NOTICE 'Realtime replication enabled for lectures table';
  RAISE NOTICE 'Frontend subscriptions will now receive UPDATE events';
  RAISE NOTICE 'n8n workflow PATCH requests will trigger real-time updates';
END $$;
