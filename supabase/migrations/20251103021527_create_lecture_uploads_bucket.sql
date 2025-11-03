/*
  # Create Storage Bucket for Lecture Uploads

  ## Summary
  Creates a Supabase Storage bucket for storing lecture audio, video, and slide files uploaded by users.

  ## Changes Made

  ### New Storage Bucket
  1. **lecture-uploads**
     - Public bucket for lecture file storage
     - Organized by user ID folders
     - Supports audio, video, and presentation files

  ## Security
  - RLS policies ensure users can only:
    - Upload files to their own user ID folder
    - Read their own files
    - Delete their own files
  - Public read access for authenticated users' own files

  ## File Organization
  - Files stored as: `{user_id}/{timestamp}_{filename}`
  - Automatic cleanup policies can be added later if needed
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lecture-uploads',
  'lecture-uploads',
  true,
  524288000,
  ARRAY[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/m4a',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/jpg'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload files to their own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'lecture-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can read their own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'lecture-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'lecture-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'lecture-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);