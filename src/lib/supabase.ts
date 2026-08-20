import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  updated_at: string;
};

export type Class = {
  id: string;
  user_id: string;
  name: string;
  professor: string;
  created_at: string;
  updated_at: string;
  semester_id?: string;
};

export type Semester = {
  id: string;
  user_id: string;
  name: string;
  start_date?: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
};

export type Schedule = {
  id: string;
  user_id: string;
  semester_id: string;
  file_url: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  raw_data?: any;
  created_at: string;
  updated_at: string;
};

export type Lecture = {
  id: string;
  class_id: string;
  user_id: string;
  title: string;
  file_url: string;
  file_type?: string;
  recording_date: string;
  processing_status: 'pending' | 'processing' | 'transcribing' | 'transcribed' | 'analyzing' | 'completed' | 'failed';
  summary_overview: string;
  created_at: string;
  updated_at: string;
  key_terms?: Array<{ term: string; definition: string }>;
  flashcards?: Array<{ question: string; answer: string }>;
  transcript?: string | null;
  transcript_source?: string | null;
  key_points?: string[];
  important_terms?: { term: string; definition: string }[];
  exam_questions?: string[];
  claims?: { statement: string; quote: string; emphasis: string; contested: boolean }[];
  distinctions?: { this_: string; not_that: string; why_confusable: string }[];
  processing_error?: string | null;
  processed_at?: string | null;
};
