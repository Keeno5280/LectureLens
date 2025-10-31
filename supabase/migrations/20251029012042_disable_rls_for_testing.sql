/*
  # Disable RLS for Testing

  ## Overview
  Temporarily disable Row Level Security for all tables to allow testing without authentication.

  ## Security Notes
  WARNING: This is for TESTING ONLY. Re-enable RLS and authentication before production use.
*/

-- Disable RLS on all tables
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE lectures DISABLE ROW LEVEL SECURITY;
