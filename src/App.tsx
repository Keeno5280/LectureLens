import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import UploadPage from './pages/UploadPage';
import ClassesPage from './pages/ClassesPage';
import ClassNotesPage from './pages/ClassNotesPage';
import LectureDetailPage from './pages/LectureDetailPage';
import SlideViewerPage from './pages/SlideViewerPage';
import TutorPage from './pages/TutorPage';

type Page = 'dashboard' | 'upload' | 'classes' | 'class-notes' | 'lecture' | 'slide-viewer' | 'tutor';

export default function App() {
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
}
