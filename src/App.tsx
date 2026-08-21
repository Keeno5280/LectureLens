import { useEffect, useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import UploadPage from './pages/UploadPage';
import ClassesPage from './pages/ClassesPage';
import ClassNotesPage from './pages/ClassNotesPage';
import LectureDetailPage from './pages/LectureDetailPage';
import SlideViewerPage from './pages/SlideViewerPage';
import TutorPage from './pages/TutorPage';
import UpdatePasswordPage from './pages/UpdatePasswordPage';
import QuizReviewPage from './pages/QuizReviewPage';
import { supabase } from './lib/supabase';
import { SemesterProvider } from './contexts/SemesterContext';
import Layout from './components/Layout';

type Page = 'dashboard' | 'upload' | 'classes' | 'class-notes' | 'lecture' | 'slide-viewer' | 'tutor' | 'update-password' | 'quiz-review';

export default function App() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [pageId, setPageId] = useState<string | undefined>();

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<{ page: Page; id?: string }>;
      setCurrentPage(customEvent.detail.page);
      setPageId(customEvent.detail.id);
    };

    // Check for recovery mode in URL hash (fallback)
    if (window.location.hash && window.location.hash.includes('type=recovery')) {
      setCurrentPage('update-password');
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      console.log('Auth Event:', event); // Debug log
      if (event === 'PASSWORD_RECOVERY') {
        setCurrentPage('update-password');
      }
    });

    window.addEventListener('navigate', handleNavigate);
    return () => {
      window.removeEventListener('navigate', handleNavigate);
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'upload':
        return <UploadPage />;
      case 'classes':
        return <ClassesPage />;
      case 'class-notes':
        return pageId ? <ClassNotesPage classId={pageId} /> : <Dashboard />;
      case 'lecture':
        return pageId ? <LectureDetailPage lectureId={pageId} /> : <Dashboard />;
      case 'quiz-review':
        return pageId ? <QuizReviewPage lectureId={pageId} /> : <Dashboard />;
      case 'slide-viewer':
        return <SlideViewerPage />;
      case 'tutor':
        return <TutorPage />;
      case 'update-password':
        return <UpdatePasswordPage />;
      case 'dashboard':
      default:
        return <Dashboard />;
    }
  };

  return (
    <>
      <SemesterProvider>
        <Layout currentPage={currentPage}>
          {renderPage()}
        </Layout>
      </SemesterProvider>
    </>
  );
}
