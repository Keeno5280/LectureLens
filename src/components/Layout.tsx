import SemesterSidebar from './SemesterSidebar';
import GlobalChatWidget from './GlobalChatWidget';

export default function Layout({ children, currentPage }: { children: React.ReactNode; currentPage?: string }) {
    return (
        <div className="min-h-screen bg-gray-50 flex">
            <SemesterSidebar />
            <div className="flex-1 ml-64 transition-all">
                {children}
            </div>
            {currentPage !== 'tutor' && <GlobalChatWidget />}
        </div>
    );
}
