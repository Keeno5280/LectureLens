/*
  # Enable RLS with Permissive Policies for Testing

  ## Overview
  Re-enable Row Level Security and add permissive policies that allow anonymous access for testing.

  ## Changes
  1. Enable RLS on all tables
  2. Add policies that allow anonymous users to perform all operations
  3. This maintains security structure while allowing testing without authentication

  ## Security Notes
  These policies are permissive for testing. In production, restrict to authenticated users only.
*/

-- Re-enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;

-- Drop existing restrictive policies if any
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own classes" ON classes;
DROP POLICY IF EXISTS "Users can insert own classes" ON classes;
DROP POLICY IF EXISTS "Users can update own classes" ON classes;
DROP POLICY IF EXISTS "Users can delete own classes" ON classes;
DROP POLICY IF EXISTS "Users can read own lectures" ON lectures;
DROP POLICY IF EXISTS "Users can insert own lectures" ON lectures;
DROP POLICY IF EXISTS "Users can update own lectures" ON lectures;
DROP POLICY IF EXISTS "Users can delete own lectures" ON lectures;

-- Profiles: Allow all operations for testing
CREATE POLICY "Allow all access to profiles"
  ON profiles
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Classes: Allow all operations for testing
CREATE POLICY "Allow all access to classes"
  ON classes
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Lectures: Allow all operations for testing
CREATE POLICY "Allow all access to lectures"
  ON lectures
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
