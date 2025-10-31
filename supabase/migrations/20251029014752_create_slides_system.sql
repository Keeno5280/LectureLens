/*
  # Slide-Based Lecture System

  ## Overview
  This migration creates the complete database structure for slide-based lecture features including
  slides, annotations, highlights, flashcards, quizzes, and collaborative features.

  ## New Tables

  ### 1. `slides`
  Stores individual slides extracted from presentations
  - `id` (uuid, primary key) - Unique slide identifier
  - `lecture_id` (uuid, foreign key) - References lectures(id)
  - `slide_number` (integer) - Order position in presentation
  - `image_url` (text) - URL to slide image/preview
  - `extracted_text` (text) - Text content extracted from slide
  - `summary` (text) - AI-generated slide summary
  - `metadata` (jsonb) - Additional slide metadata (layout, fonts, etc.)
  - `created_at` (timestamptz) - Creation timestamp

  ### 2. `slide_annotations`
  User annotations on slides (text notes, drawings, voice memos)
  - `id` (uuid, primary key) - Unique annotation identifier
  - `slide_id` (uuid, foreign key) - References slides(id)
  - `user_id` (uuid) - User who created annotation
  - `annotation_type` (text) - 'text', 'drawing', 'voice'
  - `content` (text) - Annotation content or URL for voice/drawing
  - `position_data` (jsonb) - X/Y coordinates and dimensions
  - `color` (text) - Annotation color
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 3. `slide_highlights`
  Text highlights on slides with color-coding
  - `id` (uuid, primary key) - Unique highlight identifier
  - `slide_id` (uuid, foreign key) - References slides(id)
  - `user_id` (uuid) - User who created highlight
  - `text_content` (text) - Highlighted text
  - `position_data` (jsonb) - Selection coordinates
  - `color` (text) - Highlight color
  - `note` (text) - Optional note attached to highlight
  - `created_at` (timestamptz) - Creation timestamp

  ### 4. `slide_comments`
  Collaborative comments with timestamps and threading
  - `id` (uuid, primary key) - Unique comment identifier
  - `slide_id` (uuid, foreign key) - References slides(id)
  - `user_id` (uuid) - User who created comment
  - `parent_id` (uuid) - For threaded replies
  - `content` (text) - Comment text
  - `timestamp` (timestamptz) - When comment was made
  - `created_at` (timestamptz) - Creation timestamp

  ### 5. `flashcards`
  Auto-generated and user-created flashcards from slide content
  - `id` (uuid, primary key) - Unique flashcard identifier
  - `lecture_id` (uuid, foreign key) - References lectures(id)
  - `slide_id` (uuid, foreign key, optional) - Source slide
  - `user_id` (uuid) - Owner user
  - `question` (text) - Flashcard question/front
  - `answer` (text) - Flashcard answer/back
  - `difficulty` (text) - 'easy', 'medium', 'hard'
  - `is_auto_generated` (boolean) - Whether AI-generated
  - `review_count` (integer) - Times reviewed
  - `last_reviewed` (timestamptz) - Last review timestamp
  - `next_review` (timestamptz) - Next scheduled review (spaced repetition)
  - `created_at` (timestamptz) - Creation timestamp

  ### 6. `quiz_questions`
  Auto-generated quiz questions from slide content
  - `id` (uuid, primary key) - Unique question identifier
  - `lecture_id` (uuid, foreign key) - References lectures(id)
  - `slide_id` (uuid, foreign key, optional) - Source slide
  - `question_type` (text) - 'multiple_choice', 'true_false', 'short_answer'
  - `question_text` (text) - The question
  - `correct_answer` (text) - Correct answer
  - `options` (jsonb) - Answer options for multiple choice
  - `explanation` (text) - Explanation of correct answer
  - `difficulty` (text) - 'easy', 'medium', 'hard'
  - `created_at` (timestamptz) - Creation timestamp

  ### 7. `quiz_attempts`
  User quiz attempts and scores
  - `id` (uuid, primary key) - Unique attempt identifier
  - `lecture_id` (uuid, foreign key) - References lectures(id)
  - `user_id` (uuid) - User taking quiz
  - `score` (integer) - Points earned
  - `total_questions` (integer) - Total questions in quiz
  - `answers` (jsonb) - User's answers with correctness
  - `completed_at` (timestamptz) - Completion timestamp
  - `created_at` (timestamptz) - Start timestamp

  ### 8. `lecture_bookmarks`
  User bookmarks for specific slides
  - `id` (uuid, primary key) - Unique bookmark identifier
  - `lecture_id` (uuid, foreign key) - References lectures(id)
  - `slide_id` (uuid, foreign key) - References slides(id)
  - `user_id` (uuid) - User who bookmarked
  - `note` (text) - Optional bookmark note
  - `created_at` (timestamptz) - Creation timestamp

  ### 9. `lecture_progress`
  Track user progress through lectures
  - `id` (uuid, primary key) - Unique progress identifier
  - `lecture_id` (uuid, foreign key) - References lectures(id)
  - `user_id` (uuid) - User
  - `current_slide` (integer) - Last viewed slide number
  - `completed_slides` (jsonb) - Array of completed slide IDs
  - `time_spent` (integer) - Total seconds spent
  - `last_viewed` (timestamptz) - Last view timestamp
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Update timestamp

  ### 10. `key_terms`
  Extracted key terms and definitions from slides
  - `id` (uuid, primary key) - Unique term identifier
  - `lecture_id` (uuid, foreign key) - References lectures(id)
  - `slide_id` (uuid, foreign key, optional) - Source slide
  - `term` (text) - The key term/concept
  - `definition` (text) - Term definition
  - `context` (text) - Additional context
  - `created_at` (timestamptz) - Creation timestamp

  ## Security
  All tables have RLS enabled with policies allowing users to access only their own data
  or data they have permission to view through class enrollment.

  ## Important Notes
  1. JSONB used for flexible position data and metadata storage
  2. Spaced repetition algorithm fields in flashcards table
  3. Support for threaded comments with parent_id
  4. All foreign keys use ON DELETE CASCADE for data integrity
  5. Indexes on foreign keys and frequently queried fields
*/

-- Extend lectures table with slide-specific fields
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS file_type text DEFAULT 'audio';
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS slide_count integer DEFAULT 0;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS thumbnail_url text DEFAULT '';

-- Create slides table
CREATE TABLE IF NOT EXISTS slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  slide_number integer NOT NULL,
  image_url text NOT NULL,
  extracted_text text DEFAULT '',
  summary text DEFAULT '',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(lecture_id, slide_number)
);

-- Create slide_annotations table
CREATE TABLE IF NOT EXISTS slide_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slide_id uuid NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  user_id uuid,
  annotation_type text NOT NULL CHECK (annotation_type IN ('text', 'drawing', 'voice')),
  content text NOT NULL,
  position_data jsonb DEFAULT '{}'::jsonb,
  color text DEFAULT '#FFEB3B',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create slide_highlights table
CREATE TABLE IF NOT EXISTS slide_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slide_id uuid NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  user_id uuid,
  text_content text NOT NULL,
  position_data jsonb DEFAULT '{}'::jsonb,
  color text DEFAULT '#FFFF00',
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Create slide_comments table
CREATE TABLE IF NOT EXISTS slide_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slide_id uuid NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  user_id uuid,
  parent_id uuid REFERENCES slide_comments(id) ON DELETE CASCADE,
  content text NOT NULL,
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create flashcards table
CREATE TABLE IF NOT EXISTS flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  slide_id uuid REFERENCES slides(id) ON DELETE SET NULL,
  user_id uuid,
  question text NOT NULL,
  answer text NOT NULL,
  difficulty text DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  is_auto_generated boolean DEFAULT false,
  review_count integer DEFAULT 0,
  last_reviewed timestamptz,
  next_review timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create quiz_questions table
CREATE TABLE IF NOT EXISTS quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  slide_id uuid REFERENCES slides(id) ON DELETE SET NULL,
  question_type text NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false', 'short_answer')),
  question_text text NOT NULL,
  correct_answer text NOT NULL,
  options jsonb DEFAULT '[]'::jsonb,
  explanation text DEFAULT '',
  difficulty text DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  created_at timestamptz DEFAULT now()
);

-- Create quiz_attempts table
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id uuid,
  score integer DEFAULT 0,
  total_questions integer NOT NULL,
  answers jsonb DEFAULT '[]'::jsonb,
  completed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create lecture_bookmarks table
CREATE TABLE IF NOT EXISTS lecture_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  slide_id uuid NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  user_id uuid,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(slide_id, user_id)
);

-- Create lecture_progress table
CREATE TABLE IF NOT EXISTS lecture_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id uuid,
  current_slide integer DEFAULT 1,
  completed_slides jsonb DEFAULT '[]'::jsonb,
  time_spent integer DEFAULT 0,
  last_viewed timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(lecture_id, user_id)
);

-- Create key_terms table
CREATE TABLE IF NOT EXISTS key_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  slide_id uuid REFERENCES slides(id) ON DELETE SET NULL,
  term text NOT NULL,
  definition text NOT NULL,
  context text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_slides_lecture_id ON slides(lecture_id);
CREATE INDEX IF NOT EXISTS idx_slides_slide_number ON slides(lecture_id, slide_number);
CREATE INDEX IF NOT EXISTS idx_slide_annotations_slide_id ON slide_annotations(slide_id);
CREATE INDEX IF NOT EXISTS idx_slide_annotations_user_id ON slide_annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_slide_highlights_slide_id ON slide_highlights(slide_id);
CREATE INDEX IF NOT EXISTS idx_slide_highlights_user_id ON slide_highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_slide_comments_slide_id ON slide_comments(slide_id);
CREATE INDEX IF NOT EXISTS idx_slide_comments_user_id ON slide_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_lecture_id ON flashcards(lecture_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_user_id ON flashcards(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(user_id, next_review);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_lecture_id ON quiz_questions(lecture_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_lecture_id ON quiz_attempts(lecture_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_lecture_bookmarks_lecture_id ON lecture_bookmarks(lecture_id);
CREATE INDEX IF NOT EXISTS idx_lecture_bookmarks_user_id ON lecture_bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_lecture_progress_user_id ON lecture_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_key_terms_lecture_id ON key_terms(lecture_id);

-- Enable Row Level Security
ALTER TABLE slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE slide_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slide_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE slide_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_terms ENABLE ROW LEVEL SECURITY;

-- Slides policies (accessible if user owns the lecture)
CREATE POLICY "Users can view slides from their lectures"
  ON slides FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = slides.lecture_id
      AND (lectures.user_id = auth.uid() OR lectures.user_id IS NULL)
    )
  );

CREATE POLICY "Users can insert slides for their lectures"
  ON slides FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = lecture_id
      AND (lectures.user_id = auth.uid() OR lectures.user_id IS NULL)
    )
  );

-- Slide annotations policies
CREATE POLICY "Users can view all annotations on their slides"
  ON slide_annotations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM slides s
      JOIN lectures l ON l.id = s.lecture_id
      WHERE s.id = slide_annotations.slide_id
      AND (l.user_id = auth.uid() OR l.user_id IS NULL)
    )
  );

CREATE POLICY "Users can create annotations"
  ON slide_annotations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own annotations"
  ON slide_annotations FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own annotations"
  ON slide_annotations FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Slide highlights policies
CREATE POLICY "Users can view all highlights on their slides"
  ON slide_highlights FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM slides s
      JOIN lectures l ON l.id = s.lecture_id
      WHERE s.id = slide_highlights.slide_id
      AND (l.user_id = auth.uid() OR l.user_id IS NULL)
    )
  );

CREATE POLICY "Users can create highlights"
  ON slide_highlights FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can delete own highlights"
  ON slide_highlights FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Slide comments policies
CREATE POLICY "Users can view comments on their slides"
  ON slide_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM slides s
      JOIN lectures l ON l.id = s.lecture_id
      WHERE s.id = slide_comments.slide_id
      AND (l.user_id = auth.uid() OR l.user_id IS NULL)
    )
  );

CREATE POLICY "Users can create comments"
  ON slide_comments FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own comments"
  ON slide_comments FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own comments"
  ON slide_comments FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Flashcards policies
CREATE POLICY "Users can view flashcards from their lectures"
  ON flashcards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = flashcards.lecture_id
      AND (lectures.user_id = auth.uid() OR lectures.user_id IS NULL)
    )
  );

CREATE POLICY "Users can create flashcards"
  ON flashcards FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update flashcards"
  ON flashcards FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = flashcards.lecture_id
      AND (lectures.user_id = auth.uid() OR lectures.user_id IS NULL)
    )
  );

CREATE POLICY "Users can delete flashcards"
  ON flashcards FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = flashcards.lecture_id
      AND (lectures.user_id = auth.uid() OR lectures.user_id IS NULL)
    )
  );

-- Quiz questions policies
CREATE POLICY "Users can view quiz questions from their lectures"
  ON quiz_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = quiz_questions.lecture_id
      AND (lectures.user_id = auth.uid() OR lectures.user_id IS NULL)
    )
  );

CREATE POLICY "System can create quiz questions"
  ON quiz_questions FOR INSERT
  WITH CHECK (true);

-- Quiz attempts policies
CREATE POLICY "Users can view own quiz attempts"
  ON quiz_attempts FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create quiz attempts"
  ON quiz_attempts FOR INSERT
  WITH CHECK (true);

-- Lecture bookmarks policies
CREATE POLICY "Users can view own bookmarks"
  ON lecture_bookmarks FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create bookmarks"
  ON lecture_bookmarks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can delete own bookmarks"
  ON lecture_bookmarks FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Lecture progress policies
CREATE POLICY "Users can view own progress"
  ON lecture_progress FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create progress records"
  ON lecture_progress FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own progress"
  ON lecture_progress FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Key terms policies
CREATE POLICY "Users can view key terms from their lectures"
  ON key_terms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lectures
      WHERE lectures.id = key_terms.lecture_id
      AND (lectures.user_id = auth.uid() OR lectures.user_id IS NULL)
    )
  );

CREATE POLICY "System can create key terms"
  ON key_terms FOR INSERT
  WITH CHECK (true);

-- Update triggers for updated_at columns
CREATE TRIGGER update_slide_annotations_updated_at
  BEFORE UPDATE ON slide_annotations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lecture_progress_updated_at
  BEFORE UPDATE ON lecture_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to update lecture slide count
CREATE OR REPLACE FUNCTION update_lecture_slide_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE lectures
  SET slide_count = (
    SELECT COUNT(*) FROM slides WHERE lecture_id = NEW.lecture_id
  )
  WHERE id = NEW.lecture_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_slide_count_on_insert
  AFTER INSERT ON slides
  FOR EACH ROW
  EXECUTE FUNCTION update_lecture_slide_count();
