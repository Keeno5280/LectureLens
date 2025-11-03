/*
  # Update Profiles Table - Add First and Last Name Fields

  ## Summary
  Updates the profiles table to collect separate first name and last name instead of a single full_name field.

  ## Changes Made

  ### Modified Tables
  1. **profiles**
     - Added `first_name` (text, required) - User's first name
     - Added `last_name` (text, required) - User's last name
     - Removed `full_name` column (after migrating existing data)

  ## Migration Steps
  1. Add new first_name and last_name columns (nullable initially)
  2. Migrate existing full_name data by splitting into first and last names
  3. Make the new columns required (NOT NULL)
  4. Drop the old full_name column

  ## Security
  - Existing RLS policies on profiles table remain unchanged
  - Users can only access and modify their own profile data

  ## Important Notes
  - Existing full_name data is preserved by splitting on the first space
  - If no space exists, the entire name becomes first_name and last_name is set to empty string
*/

-- Add new columns (nullable initially to allow data migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE profiles ADD COLUMN first_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'last_name'
  ) THEN
    ALTER TABLE profiles ADD COLUMN last_name text;
  END IF;
END $$;

-- Migrate existing data from full_name to first_name and last_name
UPDATE profiles
SET
  first_name = COALESCE(
    NULLIF(SPLIT_PART(full_name, ' ', 1), ''),
    full_name
  ),
  last_name = COALESCE(
    NULLIF(SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1), ''),
    ''
  )
WHERE first_name IS NULL OR last_name IS NULL;

-- Make the new columns required
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE profiles ALTER COLUMN first_name SET NOT NULL;
    ALTER TABLE profiles ALTER COLUMN first_name SET DEFAULT '';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'last_name'
  ) THEN
    ALTER TABLE profiles ALTER COLUMN last_name SET NOT NULL;
    ALTER TABLE profiles ALTER COLUMN last_name SET DEFAULT '';
  END IF;
END $$;

-- Drop the old full_name column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE profiles DROP COLUMN full_name;
  END IF;
END $$;