import { useCallback } from 'react';

type Page = 'login' | 'dashboard' | 'upload' | 'classes' | 'class-notes' | 'lecture' | 'slide-viewer' | 'tutor' | 'update-password' | 'quiz-review';

export function useNavigate() {
  return useCallback((page: Page, id?: string) => {
    const event = new CustomEvent('navigate', { detail: { page, id } });
    window.dispatchEvent(event);
  }, []);
}
