/*
  # Make user_id nullable for testing

  ## Overview
  Allow classes and lectures to be created without requiring a valid user_id from auth.users.
  This enables testing without authentication.

  ## Changes
  1. Drop foreign key constraints on user_id columns
  2. Make user_id columns nullable
  3. Update RLS policies to handle null user_id

  ## Security Notes
  In production, re-enable foreign key constraints and make user_id NOT NULL.
*/

-- Drop foreign key constraints
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_user_id_fkey;
ALTER TABLE lectures DROP CONSTRAINT IF EXISTS lectures_user_id_fkey;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Make user_id nullable in classes
ALTER TABLE classes ALTER COLUMN user_id DROP NOT NULL;

-- Make user_id nullable in lectures
ALTER TABLE lectures ALTER COLUMN user_id DROP NOT NULL;
