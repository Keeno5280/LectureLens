/*
  # LectureLens Database Schema

  ## Overview
  This migration creates the complete database structure for LectureLens, a student lecture management system with AI-powered note summaries.

  ## New Tables

  ### 1. `profiles`
  Stores extended user profile information linked to Supabase auth.users
  - `id` (uuid, primary key) - References auth.users(id)
  - `email` (text) - User's email address
  - `full_name` (text) - Student's full name
  - `created_at` (timestamptz) - Account creation timestamp
  - `updated_at` (timestamptz) - Last profile update timestamp

  ### 2. `classes`
  Stores information about classes/courses students are enrolled in
  - `id` (uuid, primary key) - Unique class identifier
  - `user_id` (uuid, foreign key) - References profiles(id)
  - `name` (text) - Class name (e.g., "Biology 101")
  - `professor` (text, optional) - Professor's name
  - `created_at` (timestamptz) - Class creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 3. `lectures`
  Stores lecture recordings and their AI-generated summaries
  - `id` (uuid, primary key) - Unique lecture identifier
  - `class_id` (uuid, foreign key) - References classes(id)
  - `user_id` (uuid, foreign key) - References profiles(id)
  - `title` (text) - Lecture title
  - `file_url` (text, optional) - URL to uploaded audio/video file
  - `recording_date` (timestamptz) - When lecture was recorded/uploaded
  - `processing_status` (text) - Status: 'pending', 'processing', 'completed', 'failed'
  - `summary_overview` (text, optional) - AI-generated overview
  - `key_points` (jsonb, optional) - Array of key points from lecture
  - `important_terms` (jsonb, optional) - Dictionary of important terms and definitions
  - `exam_questions` (jsonb, optional) - Array of potential exam questions
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security

  ### Row Level Security (RLS)
  All tables have RLS enabled to ensure data privacy and security.

  ### Profiles Table Policies
  - Users can view their own profile
  - Users can insert their own profile during signup
  - Users can update their own profile

  ### Classes Table Policies
  - Users can view only their own classes
  - Users can insert classes for themselves
  - Users can update their own classes
  - Users can delete their own classes

  ### Lectures Table Policies
  - Users can view only their own lectures
  - Users can insert lectures for themselves
  - Users can update their own lectures
  - Users can delete their own lectures

  ## Important Notes
  1. All timestamps use `timestamptz` for timezone awareness
  2. Foreign keys include `ON DELETE CASCADE` to maintain referential integrity
  3. JSONB is used for flexible storage of AI-generated structured data
  4. Processing status tracks the AI summary generation workflow
  5. All tables have proper indexes on foreign keys for query performance
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create classes table
CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  professor text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create lectures table
CREATE TABLE IF NOT EXISTS lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_url text DEFAULT '',
  recording_date timestamptz DEFAULT now(),
  processing_status text DEFAULT 'pending',
  summary_overview text DEFAULT '',
  key_points jsonb DEFAULT '[]'::jsonb,
  important_terms jsonb DEFAULT '{}'::jsonb,
  exam_questions jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_classes_user_id ON classes(user_id);
CREATE INDEX IF NOT EXISTS idx_lectures_class_id ON lectures(class_id);
CREATE INDEX IF NOT EXISTS idx_lectures_user_id ON lectures(user_id);
CREATE INDEX IF NOT EXISTS idx_lectures_processing_status ON lectures(processing_status);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Classes policies
CREATE POLICY "Users can view own classes"
  ON classes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own classes"
  ON classes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own classes"
  ON classes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own classes"
  ON classes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Lectures policies
CREATE POLICY "Users can view own lectures"
  ON lectures FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lectures"
  ON lectures FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lectures"
  ON lectures FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own lectures"
  ON lectures FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lectures_updated_at
  BEFORE UPDATE ON lectures
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call function on new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
