import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lecture } from '../lib/supabase';
import { ArrowLeft, Download, Mail, FileText, Lightbulb, BookOpen, HelpCircle, Presentation } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';

export default function LectureDetailPage({ lectureId }: { lectureId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [loading, setLoading] = useState(true);
  const [slideCount, setSlideCount] = useState(0);

  useEffect(() => {
    loadLecture();

    if (!lectureId || !user) return;

    const channel = supabase
      .channel(`lecture-${lectureId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lectures',
          filter: `id=eq.${lectureId}`,
        },
        (payload) => {
          console.log('Lecture updated:', payload);
          if (payload.new.processing_status === 'completed') {
            loadLecture();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [lectureId, user]);

  const loadLecture = async () => {
    if (!lectureId || !user) return;

    try {
      const { data } = await supabase
        .from('lectures')
        .select('*')
        .eq('id', lectureId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const parsedLecture = {
          ...data,
          key_points: Array.isArray(data.key_points)
            ? data.key_points
            : typeof data.key_points === 'string'
            ? JSON.parse(data.key_points || '[]')
            : data.key_points || [],
          important_terms: typeof data.important_terms === 'object' && !Array.isArray(data.important_terms)
            ? data.important_terms
            : typeof data.important_terms === 'string'
            ? JSON.parse(data.important_terms || '{}')
            : data.important_terms || {},
          exam_questions: Array.isArray(data.exam_questions)
            ? data.exam_questions
            : typeof data.exam_questions === 'string'
            ? JSON.parse(data.exam_questions || '[]')
            : data.exam_questions || [],
          flashcards: Array.isArray(data.flashcards)
            ? data.flashcards
            : typeof data.flashcards === 'string'
            ? JSON.parse(data.flashcards || '[]')
            : data.flashcards || [],
        };

        setLecture(parsedLecture);

        if (data.file_type === 'slides' || data.slide_count > 0) {
          const { count } = await supabase
            .from('slides')
            .select('*', { count: 'exact', head: true })
            .eq('lecture_id', lectureId);

          setSlideCount(count || 0);
        }
      }
    } catch (error) {
      console.error('Error loading lecture:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = () => {
    alert('PDF download functionality would be implemented here');
  };

  const handleEmailNotes = () => {
    alert('Email functionality would be implemented here');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading lecture details...</p>
        </div>
      </div>
    );
  }

  if (!lecture) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Lecture not found</p>
          <button
            onClick={() => navigate('dashboard')}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{lecture.title}</h1>
              <p className="text-gray-600 mt-1">
                {new Date(lecture.recording_date).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDownloadPDF}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
              >
                <Download className="w-4 h-4" />
                PDF
              </button>
              <button
                onClick={handleEmailNotes}
                className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition"
              >
                <Mail className="w-4 h-4" />
                Email
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {slideCount > 0 && (
          <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-2xl shadow-lg p-8 mb-8 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/20 rounded-xl flex items-center justify-center">
                  <Presentation className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold mb-1">Slide Presentation Available</h3>
                  <p className="text-purple-100">
                    {slideCount} slide{slideCount !== 1 ? 's' : ''} with interactive features
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('slide-viewer', { id: lectureId })}
                className="px-6 py-3 bg-white text-purple-600 rounded-lg font-semibold hover:bg-purple-50 transition-all shadow-lg"
              >
                View Slides
              </button>
            </div>
          </div>
        )}

        {lecture.processing_status !== 'completed' ? (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center">
            {lecture.processing_status === 'processing' && (
              <>
                <div className="w-20 h-20 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium mb-4">
                  🟡 Processing
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">AI Analysis in Progress</h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  Your lecture is being analyzed by our AI. This page will automatically update when processing is complete.
                </p>
              </>
            )}
            {lecture.processing_status === 'failed' && (
              <>
                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <FileText className="w-10 h-10 text-red-600" />
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-full text-sm font-medium mb-4">
                  🔴 Failed
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">Processing Failed</h3>
                <p className="text-gray-600 max-w-md mx-auto mb-6">
                  There was an error processing this lecture. Please try uploading again or contact support if the issue persists.
                </p>
                <button
                  onClick={() => navigate('upload')}
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
                >
                  Upload New Lecture
                </button>
              </>
            )}
            {lecture.processing_status === 'pending' && (
              <>
                <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <FileText className="w-10 h-10 text-yellow-600" />
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium mb-4">
                  🟡 Pending
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">In Queue</h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  Your lecture is waiting to be processed. We'll notify you when analysis begins.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {lecture.summary_overview && (
              <div className="bg-white rounded-2xl shadow-md p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Overview</h2>
                </div>
                <p className="text-gray-700 leading-relaxed">{lecture.summary_overview}</p>
              </div>
            )}

            {lecture.key_points && lecture.key_points.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Lightbulb className="w-5 h-5 text-green-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Key Points</h2>
                </div>
                <ul className="space-y-3">
                  {lecture.key_points.map((point, index) => (
                    <li key={index} className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center text-green-700 text-sm font-medium">
                        {index + 1}
                      </span>
                      <span className="text-gray-700 leading-relaxed">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lecture.important_terms &&
              Object.keys(lecture.important_terms).length > 0 && (
                <div className="bg-white rounded-2xl shadow-md p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <BookOpen className="w-5 h-5 text-purple-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900">Important Terms</h2>
                  </div>
                  <dl className="space-y-4">
                    {Object.entries(lecture.important_terms).map(([term, definition]) => (
                      <div key={term} className="border-l-4 border-purple-200 pl-4">
                        <dt className="font-semibold text-gray-900 mb-1">{term}</dt>
                        <dd className="text-gray-700">{definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

            {lecture.exam_questions && lecture.exam_questions.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <HelpCircle className="w-5 h-5 text-orange-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Possible Exam Questions</h2>
                </div>
                <ul className="space-y-4">
                  {lecture.exam_questions.map((question, index) => (
                    <li key={index} className="flex gap-3 p-4 bg-orange-50 rounded-lg">
                      <span className="flex-shrink-0 w-6 h-6 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 text-sm font-medium">
                        Q{index + 1}
                      </span>
                      <span className="text-gray-800">{question}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lecture.flashcards && lecture.flashcards.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-indigo-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Flashcards</h2>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {lecture.flashcards.map((card: any, index: number) => (
                    <div key={index} className="border-2 border-indigo-200 rounded-lg p-6 hover:border-indigo-400 transition">
                      <div className="mb-4">
                        <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Question</span>
                        <p className="text-gray-900 font-medium mt-1">{card.question || card.front || card.q}</p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Answer</span>
                        <p className="text-gray-700 mt-1">{card.answer || card.back || card.a}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
