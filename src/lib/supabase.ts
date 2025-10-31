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
};

export type Lecture = {
  id: string;
  class_id: string;
  user_id: string;
  title: string;
  file_url: string;
  recording_date: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  summary_overview: string;
  key_points: string[];
  important_terms: Record<string, string>;
  exam_questions: string[];
  created_at: string;
  updated_at: string;
};
