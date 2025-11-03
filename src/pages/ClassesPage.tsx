import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Class } from '../lib/supabase';
import { BookOpen, Plus, ArrowLeft, Trash2, LogOut } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';
import Toast from '../components/Toast';

type ToastState = {
  message: string;
  type: 'success' | 'error';
} | null;

export default function ClassesPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [classes, setClasses] = useState<Class[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [className, setClassName] = useState('');
  const [professor, setProfessor] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [userName, setUserName] = useState<string>('Student');

  useEffect(() => {
    loadClasses();
    loadUserName();
  }, [user]);

  const loadUserName = async () => {
    if (!user) return;

    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', user.id)
        .maybeSingle();

      if (profileData) {
        setUserName(profileData.first_name);
      }
    } catch (error) {
      console.error('Error loading user name:', error);
    }
  };

  const loadClasses = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await supabase
        .from('classes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (data) setClasses(data);
    } catch (error) {
      console.error('Error loading classes:', error);
      setToast({
        message: 'Failed to load classes. Please refresh the page.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className) return;

    if (!user) {
      setToast({
        message: 'You must be logged in to create a class.',
        type: 'error',
      });
      return;
    }

    try {
      const { error } = await supabase.from('classes').insert({
        user_id: user.id,
        name: className,
        professor: professor || null,
      });

      if (error) {
        console.error('Supabase error:', error);
        setToast({
          message: 'There was an issue creating your class. Please try again.',
          type: 'error',
        });
        throw error;
      }

      setToast({
        message: '✅ Class created successfully.',
        type: 'success',
      });

      setClassName('');
      setProfessor('');
      setShowAddModal(false);
      loadClasses();
    } catch (error) {
      console.error('Full error:', error);
    }
  };

  const handleDeleteClass = async (classId: string) => {
    if (!confirm('Are you sure you want to delete this class? All associated lectures will also be deleted.')) {
      return;
    }

    try {
      const { error } = await supabase.from('classes').delete().eq('id', classId);

      if (error) throw error;

      setToast({
        message: 'Class deleted successfully.',
        type: 'success',
      });

      loadClasses();
    } catch (error) {
      setToast({
        message: 'Error deleting class. Please try again.',
        type: 'error',
      });
      console.error(error);
    }
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
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => navigate('dashboard')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Dashboard
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-2 px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium">Sign Out</span>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">Welcome, {userName}</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition"
            >
              <Plus className="w-5 h-5" />
              Add Class
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">My Classes</h1>

        {classes.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No classes yet</h3>
            <p className="text-gray-600 mb-6">Add your first class to start organizing lectures</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              <Plus className="w-5 h-5" />
              Add Class
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classes.map((cls) => (
              <div
                key={cls.id}
                className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-blue-600" />
                  </div>
                  <button
                    onClick={() => handleDeleteClass(cls.id)}
                    className="text-gray-400 hover:text-red-600 transition"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{cls.name}</h3>
                {cls.professor && (
                  <p className="text-sm text-gray-600 mb-4">Prof. {cls.professor}</p>
                )}
                <button
                  onClick={() => navigate('class-notes', cls.id)}
                  className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition"
                >
                  View Notes
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Add New Class</h2>
            <form onSubmit={handleAddClass} className="space-y-6">
              <div>
                <label htmlFor="className" className="block text-sm font-medium text-gray-700 mb-2">
                  Class Name
                </label>
                <input
                  id="className"
                  type="text"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Biology 101"
                />
              </div>

              <div>
                <label htmlFor="professor" className="block text-sm font-medium text-gray-700 mb-2">
                  Professor (Optional)
                </label>
                <input
                  id="professor"
                  type="text"
                  value={professor}
                  onChange={(e) => setProfessor(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Dr. Smith"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setClassName('');
                    setProfessor('');
                  }}
                  className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
                >
                  Add Class
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
