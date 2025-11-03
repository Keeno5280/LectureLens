import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lecture, Class } from '../lib/supabase';
import { ArrowLeft, FileText, Clock, Trash2 } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';
import Toast from '../components/Toast';

type ToastState = {
  message: string;
  type: 'success' | 'error';
} | null;

export default function ClassNotesPage({ classId }: { classId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [classData, setClassData] = useState<Class | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    loadData();
  }, [classId]);

  const loadData = async () => {
    if (!classId) return;

    try {
      const { data: classInfo } = await supabase
        .from('classes')
        .select('*')
        .eq('id', classId)
        .maybeSingle();

      if (classInfo) setClassData(classInfo);

      const { data: lecturesData } = await supabase
        .from('lectures')
        .select('*')
        .eq('class_id', classId)
        .order('recording_date', { ascending: false });

      if (lecturesData) setLectures(lecturesData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  /**
   * Handles deletion of a lecture from the class
   * @param lectureId - Unique identifier of the lecture
   * @param lectureTitle - Title of the lecture for confirmation
   * @param e - Mouse event to prevent card click propagation
   */
  const handleDeleteLecture = async (lectureId: string, lectureTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const confirmed = window.confirm(
      `Are you sure you want to delete "${lectureTitle}"?\n\nThis action cannot be undone. All associated data will be permanently deleted.`
    );

    if (!confirmed) return;

    setDeletingId(lectureId);

    try {
      const lectureToDelete = lectures.find(l => l.id === lectureId);

      if (lectureToDelete?.file_url) {
        const urlParts = lectureToDelete.file_url.split('/');
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
        .eq('user_id', user?.id);

      if (deleteError) {
        throw deleteError;
      }

      setLectures(prev => prev.filter(l => l.id !== lectureId));

      setToast({
        message: 'Lecture deleted successfully',
        type: 'success',
      });
    } catch (error) {
      console.error('Error deleting lecture:', error);
      setToast({
        message: 'Failed to delete lecture. Please try again.',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!classData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Class not found</p>
          <button
            onClick={() => navigate('classes')}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to Classes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => navigate('classes')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Classes
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{classData.name}</h1>
            {classData.professor && (
              <p className="text-gray-600 mt-1">Prof. {classData.professor}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Lectures</h2>

        {lectures.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No lectures yet</h3>
            <p className="text-gray-600 mb-6">
              Upload a lecture for this class to see it here
            </p>
            <button
              onClick={() => navigate('upload')}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Upload Lecture
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {lectures.map((lecture) => (
              <div
                key={lecture.id}
                className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition cursor-pointer"
                onClick={() => navigate('lecture', lecture.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900">{lecture.title}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Clock className="w-4 h-4" />
                          {formatDate(lecture.recording_date)}
                        </div>
                      </div>
                    </div>
                    {lecture.summary_overview && lecture.processing_status === 'completed' && (
                      <p className="text-gray-600 text-sm line-clamp-3 ml-13">
                        {lecture.summary_overview}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                        lecture.processing_status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : lecture.processing_status === 'processing'
                          ? 'bg-blue-100 text-blue-700'
                          : lecture.processing_status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {lecture.processing_status}
                    </span>
                    <button
                      onClick={(e) => handleDeleteLecture(lecture.id, lecture.title, e)}
                      disabled={deletingId === lecture.id}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Delete lecture"
                    >
                      {deletingId === lecture.id ? (
                        <div className="w-5 h-5 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Trash2 className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
