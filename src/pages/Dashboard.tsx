import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lecture } from '../lib/supabase';
import { Upload, BookOpen, Clock, Brain, LogOut } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';
import SearchBar from '../components/SearchBar';

export default function Dashboard() {
  const [recentLectures, setRecentLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string>('Student');
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  useEffect(() => {
    loadData();

    if (!user) return;

    const channel = supabase
      .channel('lectures-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lectures',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('Lecture update received:', payload);
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const loadData = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const { data: lecturesData } = await supabase
        .from('lectures')
        .select('*')
        .eq('user_id', user.id)
        .order('recording_date', { ascending: false })
        .limit(5);

      if (lecturesData) setRecentLectures(lecturesData);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', user.id)
        .maybeSingle();

      if (profileData) {
        setUserName(profileData.first_name);
      }
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
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {userName}
          </h1>
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <SearchBar />
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <button
            onClick={() => navigate('upload')}
            className="bg-white p-8 rounded-2xl shadow-md hover:shadow-lg transition border-2 border-transparent hover:border-blue-500 text-left group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-200 transition">
                <Upload className="w-7 h-7 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Upload / Record</h2>
                <p className="text-gray-600 text-sm mt-1">Add lecture materials</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => navigate('classes')}
            className="bg-white p-8 rounded-2xl shadow-md hover:shadow-lg transition border-2 border-transparent hover:border-blue-500 text-left group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center group-hover:bg-green-200 transition">
                <BookOpen className="w-7 h-7 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">My Classes</h2>
                <p className="text-gray-600 text-sm mt-1">Manage classes and notes</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => navigate('tutor')}
            className="bg-gradient-to-br from-purple-500 to-blue-600 p-8 rounded-2xl shadow-md hover:shadow-xl transition text-left group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center group-hover:bg-white/30 transition">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">AI Tutor</h2>
                <p className="text-purple-100 text-sm mt-1">Get personalized help</p>
              </div>
            </div>
          </button>
        </div>

        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-6">Recent Lectures</h2>
          {recentLectures.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-md p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No lectures yet</h3>
              <p className="text-gray-600 mb-6">
                Get started by uploading or recording your first lecture
              </p>
              <button
                onClick={() => navigate('upload')}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
              >
                <Upload className="w-5 h-5" />
                Upload Lecture
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {recentLectures.map((lecture) => (
                <div
                  key={lecture.id}
                  className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition cursor-pointer"
                  onClick={() => navigate('lecture', lecture.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {lecture.title}
                      </h3>
                      {lecture.summary_overview && lecture.processing_status === 'completed' && (
                        <p className="text-gray-600 text-sm line-clamp-2 mb-3">
                          {lecture.summary_overview}
                        </p>
                      )}
                      {lecture.processing_status === 'completed' && (
                        <p className="text-green-600 text-sm font-medium mb-2">
                          ✅ AI Analysis Complete
                        </p>
                      )}
                      {lecture.processing_status === 'processing' && (
                        <p className="text-blue-600 text-sm font-medium mb-2">
                          ⏳ AI processing in progress...
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Clock className="w-4 h-4" />
                        {formatDate(lecture.recording_date)}
                      </div>
                    </div>
                    <div>
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                          lecture.processing_status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : lecture.processing_status === 'processing'
                            ? 'bg-blue-100 text-blue-700 animate-pulse'
                            : lecture.processing_status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {lecture.processing_status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
