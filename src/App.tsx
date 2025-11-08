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
import DebugPanel from './components/DebugPanel';

type Page = 'dashboard' | 'upload' | 'classes' | 'class-notes' | 'lecture' | 'slide-viewer' | 'tutor';

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

    window.addEventListener('navigate', handleNavigate);
    return () => window.removeEventListener('navigate', handleNavigate);
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
      case 'slide-viewer':
        return <SlideViewerPage />;
      case 'tutor':
        return <TutorPage />;
      case 'dashboard':
      default:
        return <Dashboard />;
    }
  };

  return (
    <>
      {renderPage()}
      <DebugPanel />
    </>
  );
}
