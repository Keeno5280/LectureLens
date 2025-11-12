/*
  # Enable RLS on Tutor Tables and Remove Unused Indexes

  ## Security Changes
  
  1. Enable RLS on all tutor-related tables:
    - `tutor_messages` - Messages in tutor conversations
    - `tutor_conversations` - Tutor conversation records
    - `tutor_quick_actions` - User quick actions
    - `tutor_context_cache` - Cached context for tutor
    - `saved_tutor_responses` - Saved responses
    - `tutor_flashcards` - Tutor-generated flashcards

  2. Remove unused indexes:
    - `idx_slide_annotations_slide_id`
    - `idx_slide_comments_slide_id`
    - `idx_ai_conversations_class_id`
    - `idx_flashcards_slide_id`
    - `idx_key_terms_slide_id`
    - `idx_quiz_questions_slide_id`
    - `idx_slide_comments_parent_id`
    - `idx_slide_highlights_slide_id`
    - `idx_tutor_context_cache_slide_id`

  ## Notes
  - All tables have existing policies that will become active when RLS is enabled
  - Removing unused indexes improves database performance and reduces storage
*/

-- Enable RLS on tutor-related tables
ALTER TABLE tutor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_quick_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_context_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_tutor_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_flashcards ENABLE ROW LEVEL SECURITY;

-- Drop unused indexes if they exist
DROP INDEX IF EXISTS idx_slide_annotations_slide_id;
DROP INDEX IF EXISTS idx_slide_comments_slide_id;
DROP INDEX IF EXISTS idx_ai_conversations_class_id;
DROP INDEX IF EXISTS idx_flashcards_slide_id;
DROP INDEX IF EXISTS idx_key_terms_slide_id;
DROP INDEX IF EXISTS idx_quiz_questions_slide_id;
DROP INDEX IF EXISTS idx_slide_comments_parent_id;
DROP INDEX IF EXISTS idx_slide_highlights_slide_id;
DROP INDEX IF EXISTS idx_tutor_context_cache_slide_id;