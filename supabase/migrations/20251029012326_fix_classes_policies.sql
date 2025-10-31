/*
  # Fix Classes RLS Policies

  ## Overview
  Remove conflicting restrictive policy and ensure only the permissive policy exists.

  ## Changes
  1. Drop the restrictive "Users can view own classes" policy
  2. Ensure "Allow all access to classes" policy is the only one active
*/

-- Drop the restrictive policy that's causing conflicts
DROP POLICY IF EXISTS "Users can view own classes" ON classes;
DROP POLICY IF EXISTS "Users can insert own classes" ON classes;
DROP POLICY IF EXISTS "Users can update own classes" ON classes;
DROP POLICY IF EXISTS "Users can delete own classes" ON classes;
DROP POLICY IF EXISTS "Users can read own classes" ON classes;

-- Ensure the permissive policy exists
DROP POLICY IF EXISTS "Allow all access to classes" ON classes;

CREATE POLICY "Allow all access to classes"
  ON classes
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
