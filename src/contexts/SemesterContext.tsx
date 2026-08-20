import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, Semester } from '../lib/supabase';
import { useAuth } from './AuthContext';

type SemesterContextType = {
    semesters: Semester[];
    selectedSemester: Semester | null;
    setSelectedSemester: (semester: Semester) => void;
    refreshSemesters: () => Promise<void>;
    loading: boolean;
};

const SemesterContext = createContext<SemesterContextType | undefined>(undefined);

export function SemesterProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedSemester, setSelectedSemester] = useState<Semester | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshSemesters = async () => {
        if (!user) {
            setLoading(false);
            return;
        }
        try {
            const { data, error } = await supabase
                .from('semesters')
                .select('*')
                .eq('user_id', user.id)
                .order('name', { ascending: false }); // e.g. "Spring 2026" comes after "Fall 2025" alphabetically, roughly. 
            // Ideally sorting by date would be better but we might have null dates. 
            // Let's stick to created_at descending for now as a proxy for "newest added"

            if (error) throw error;

            // Sort by created_at desc locally if needed, or rely on DB
            // Let's rely on DB order if we change the query to created_at

            const sorted = data?.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) || [];

            setSemesters(sorted);

            // Auto-select logic
            if (sorted.length > 0 && !selectedSemester) {
                // Check if we have a stored preference? For now, just pick the most recent (first)
                setSelectedSemester(sorted[0]);
            }
        } catch (err) {
            console.error('Error fetching semesters:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshSemesters();
    }, [user]);

    // If user switches, we might want to verify it still exists in the list? 
    // But simplistic approach is fine.

    return (
        <SemesterContext.Provider value={{ semesters, selectedSemester, setSelectedSemester, refreshSemesters, loading }}>
            {children}
        </SemesterContext.Provider>
    );
}

export const useSemester = () => {
    const context = useContext(SemesterContext);
    if (context === undefined) {
        throw new Error('useSemester must be used within a SemesterProvider');
    }
    return context;
};
