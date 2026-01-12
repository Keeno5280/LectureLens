/*
  # Add DELETE policy for classes table

  ## Overview
  Users are unable to delete their own classes because there is no DELETE policy in place.
  This migration adds the missing DELETE policy.

  ## Changes
  1. Add DELETE policy for authenticated users to delete their own classes

  ## Security
  - Users can only delete classes where they are the owner (user_id = auth.uid())
  - Policy is restrictive and checks ownership before allowing deletion
*/

-- Add DELETE policy for classes
CREATE POLICY "Users can delete their own classes"
  ON classes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
