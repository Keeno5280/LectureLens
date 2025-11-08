import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lecture } from '../lib/supabase';
import { ArrowLeft, Download, Mail, Trash2, Sparkles, RefreshCw } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';
import Toast from '../components/Toast';

type ToastState = {
  message: string;
  type: 'success' | 'error';
} | null;

function parseMaybeJson(value: any, fallback: any) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export default function LectureDetailPage({ lectureId }: { lectureId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadLecture();

    if (!lectureId || !user) return;

    console.log('🔌 Setting up Realtime subscription for lecture:', lectureId);

    const channel = supabase
      .channel(`lecture-${lectureId}`, {
        config: {
          broadcast: { self: true },
        },
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lectures',
          filter: `id=eq.${lectureId}`,
        },
        (payload) => {
          console.log('✅ Real-time update received:', payload);
          console.log('Old status:', payload.old?.processing_status);
          console.log('New status:', payload.new?.processing_status);
          setLecture(payload.new as Lecture);

          if (payload.new.processing_status === 'completed') {
            setToast({
              message: 'AI analysis complete! Your lecture notes are ready.',
              type: 'success',
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to lecture updates');
          setRealtimeStatus('connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Realtime subscription error');
          setRealtimeStatus('disconnected');
        } else if (status === 'CLOSED') {
          console.warn('⚠️ Realtime connection closed');
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      console.log('🔌 Cleaning up Realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [lectureId, user]);

  useEffect(() => {
    if (!lecture || !lectureId || !user) return;
    if (lecture.processing_status === 'completed' || lecture.processing_status === 'failed') return;

    console.log('⏰ Setting up polling fallback for processing lecture');
    const pollInterval = setInterval(async () => {
      console.log('🔄 Polling for lecture updates...');
      const { data } = await supabase
        .from('lectures')
        .select('processing_status, summary_overview, key_points, important_terms, flashcards')
        .eq('id', lectureId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (data && data.processing_status !== lecture.processing_status) {
        console.log('✅ Status changed via polling:', data.processing_status);
        setLecture((prev) => prev ? { ...prev, ...data } : null);

        if (data.processing_status === 'completed') {
          setToast({
            message: 'AI analysis complete! Your lecture notes are ready.',
            type: 'success',
          });
        }
      }
    }, 5000);

    return () => {
      console.log('⏰ Cleaning up polling interval');
      clearInterval(pollInterval);
    };
  }, [lecture, lectureId, user]);

  const loadLecture = async () => {
    if (!lectureId || !user) return;

    console.log('📥 Fetching lecture data:', lectureId);

    try {
      const { data, error } = await supabase
        .from('lectures')
        .select('*')
        .eq('id', lectureId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('❌ Error loading lecture:', error);
        throw error;
      }

      if (data) {
        console.log('✅ Lecture loaded:', {
          id: data.id,
          title: data.title,
          status: data.processing_status,
          hasData: {
            summary: !!data.summary_overview,
            keyPoints: !!data.key_points,
            terms: !!data.important_terms,
            flashcards: !!data.flashcards,
          },
        });
        setLecture(data);
      } else {
        console.warn('⚠️ No lecture found with ID:', lectureId);
      }
    } catch (error) {
      console.error('❌ Error loading lecture:', error);
      setToast({
        message: 'Failed to load lecture. Please try refreshing the page.',
        type: 'error',
      });
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

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    console.log('🔄 Manual refresh triggered');
    await loadLecture();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleDeleteLecture = async () => {
    if (!lecture || !user) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${lecture.title}"?\n\nThis action cannot be undone. All associated data including slides, notes, and AI analysis will be permanently deleted.`
    );

    if (!confirmed) return;

    setIsDeleting(true);

    try {
      if (lecture.file_url) {
        const urlParts = lecture.file_url.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const userId = urlParts[urlParts.length - 2];
        const filePath = `${userId}/${fileName}`;

        const { error: storageError } = await supabase.storage
          .from('lecture-uploads')
          .remove([filePath]);

        if (storageError) {
          console.warn('Storage deletion warning:', storageError);
        }
      }

      const { error: deleteError } = await supabase
        .from('lectures')
        .delete()
        .eq('id', lectureId)
        .eq('user_id', user.id);

      if (deleteError) {
        throw deleteError;
      }

      setToast({
        message: 'Lecture deleted successfully. Redirecting...',
        type: 'success',
      });

      setTimeout(() => {
        navigate('dashboard');
      }, 1500);
    } catch (error) {
      console.error('Error deleting lecture:', error);
      setToast({
        message: 'Failed to delete lecture. Please try again.',
        type: 'error',
      });
      setIsDeleting(false);
    }
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

  const keyPoints = parseMaybeJson(lecture.key_points, []);
  const importantTerms = parseMaybeJson(lecture.important_terms, []);
  const flashcards = parseMaybeJson(lecture.flashcards, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        {realtimeStatus === 'connected' && process.env.NODE_ENV === 'development' && (
          <div className="bg-green-50 border-b border-green-200 px-4 py-1 text-xs text-green-700 text-center">
            🟢 Real-time updates enabled
          </div>
        )}
        {realtimeStatus === 'disconnected' && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-1 text-xs text-yellow-700 text-center">
            ⚠️ Real-time updates disconnected. Page will refresh automatically.
          </div>
        )}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {lecture.title || 'Untitled Lecture'}
              </h1>
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-full ${
                    lecture.processing_status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : lecture.processing_status === 'pending'
                      ? 'bg-yellow-100 text-yellow-800'
                      : lecture.processing_status === 'processing'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {lecture.processing_status === 'completed' && '✓'}
                  {lecture.processing_status === 'pending' && '⏳'}
                  {lecture.processing_status === 'processing' && '⚙️'}
                  {lecture.processing_status === 'failed' && '✕'}
                  {lecture.processing_status || 'Unknown'}
                </span>
                <span className="text-sm text-gray-500">
                  {new Date(lecture.recording_date || lecture.created_at).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
                title="Refresh lecture data"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
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
              <button
                onClick={handleDeleteLecture}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Delete lecture"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {lecture.processing_status === 'pending' || lecture.processing_status === 'processing' ? (
            <div className="bg-white rounded-2xl shadow-md p-8">
              <div className="flex items-center gap-3 mb-6">
                <Sparkles className="w-6 h-6 text-blue-600 animate-pulse" />
                <h2 className="text-xl font-bold text-gray-900">
                  {lecture.processing_status === 'processing' ? 'AI Analysis in Progress' : 'Waiting to Process'}
                </h2>
              </div>
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                <div className="h-4 bg-gray-200 rounded w-4/5"></div>
              </div>
              <p className="mt-6 text-center text-gray-600">
                {lecture.processing_status === 'processing'
                  ? 'Your lecture is being analyzed by AI. This page will update automatically when complete.'
                  : 'Your lecture is in the queue. Processing will begin shortly.'}
              </p>
            </div>
          ) : lecture.processing_status === 'completed' ? (
            <>
              {lecture.summary_overview && (
                <div className="bg-white rounded-2xl shadow-md p-8">
                  <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
                    <span className="text-2xl">🧾</span>
                    <span>Summary Overview</span>
                  </h2>
                  <p className="text-gray-700 bg-gray-50 p-4 rounded-lg whitespace-pre-line leading-relaxed">
                    {lecture.summary_overview}
                  </p>
                </div>
              )}

              {keyPoints.length > 0 && (
                <div className="bg-white rounded-2xl shadow-md p-8">
                  <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
                    <span className="text-2xl">🔑</span>
                    <span>Key Points</span>
                  </h2>
                  <ul className="space-y-3">
                    {keyPoints.map((point: string, index: number) => (
                      <li key={index} className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center text-green-700 text-sm font-medium mt-1">
                          {index + 1}
                        </span>
                        <span className="text-gray-700 leading-relaxed">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importantTerms.length > 0 && (
                <div className="bg-white rounded-2xl shadow-md p-8">
                  <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
                    <span className="text-2xl">📘</span>
                    <span>Important Terms</span>
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {importantTerms.map((term: any, index: number) => (
                      <div
                        key={index}
                        className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-100 hover:shadow-md transition"
                      >
                        <strong className="text-gray-900 text-lg block mb-2">
                          {term.term || term.name || term.word}
                        </strong>
                        <p className="text-gray-700 text-sm leading-relaxed">
                          {term.definition || term.def || term.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {flashcards.length > 0 && (
                <div className="bg-white rounded-2xl shadow-md p-8">
                  <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
                    <span className="text-2xl">🧠</span>
                    <span>Flashcards</span>
                  </h2>
                  <div className="space-y-3">
                    {flashcards.map((card: any, index: number) => (
                      <details
                        key={index}
                        className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg shadow-sm hover:shadow-md transition group"
                      >
                        <summary className="font-medium cursor-pointer text-gray-900 p-4 select-none list-none">
                          <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 w-6 h-6 bg-purple-200 rounded-full flex items-center justify-center text-purple-700 text-xs font-bold">
                              {index + 1}
                            </span>
                            <div className="flex-1">
                              <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide block mb-1">
                                Question
                              </span>
                              <p className="text-gray-900 font-medium">
                                {card.front || card.question || card.q}
                              </p>
                            </div>
                            <span className="text-purple-600 group-open:rotate-180 transition-transform">
                              ▼
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 pt-2 border-t border-purple-100 mt-2">
                          <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide block mb-2">
                            Answer
                          </span>
                          <p className="text-gray-700 leading-relaxed bg-white p-3 rounded">
                            {card.back || card.answer || card.a}
                          </p>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              {!lecture.summary_overview && keyPoints.length === 0 && importantTerms.length === 0 && flashcards.length === 0 && (
                <div className="bg-white rounded-2xl shadow-md p-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No AI Analysis Yet</h3>
                  <p className="text-gray-600">
                    The AI analysis data will appear here once processing is complete.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-2xl shadow-md p-12 text-center">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-4xl">✕</span>
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
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
