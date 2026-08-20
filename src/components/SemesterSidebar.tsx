import { Plus, Calendar, Upload } from 'lucide-react';
import { useSemester } from '../contexts/SemesterContext';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import ScheduleUpload from './ScheduleUpload';

export default function SemesterSidebar() {
    const { semesters, selectedSemester, setSelectedSemester, refreshSemesters } = useSemester();
    const { user } = useAuth();
    const [isCreating, setIsCreating] = useState(false);
    const [newSemesterName, setNewSemesterName] = useState('');
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);

    const handleCreateSemester = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSemesterName.trim() || !user) return;

        try {
            const { error } = await supabase
                .from('semesters')
                .insert([{ user_id: user.id, name: newSemesterName.trim() }]);

            if (error) throw error;

            setNewSemesterName('');
            setIsCreating(false);
            await refreshSemesters();
        } catch (err) {
            console.error('Error creating semester:', err);
        }
    };

    return (
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen fixed left-0 top-0 overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
                <div className="flex items-center gap-2 text-blue-600 font-bold text-xl mb-6">
                    <Calendar className="w-6 h-6" />
                    <span>LectureLens</span>
                </div>

                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Semesters</h2>
                    <button
                        onClick={() => setIsCreating(!isCreating)}
                        className="text-gray-400 hover:text-blue-600 transition"
                        title="Add Semester"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                {isCreating && (
                    <form onSubmit={handleCreateSemester} className="mb-4">
                        <input
                            type="text"
                            value={newSemesterName}
                            onChange={(e) => setNewSemesterName(e.target.value)}
                            placeholder="e.g. Fall 2026"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                        />
                    </form>
                )}

                <div className="space-y-1">
                    {semesters.map((sem) => (
                        <button
                            key={sem.id}
                            onClick={() => setSelectedSemester(sem)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${selectedSemester?.id === sem.id
                                ? 'bg-blue-50 text-blue-700'
                                : 'text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            <span className="truncate">{sem.name}</span>
                            {selectedSemester?.id === sem.id && (
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 ml-auto" />
                            )}
                        </button>
                    ))}

                    {semesters.length === 0 && !isCreating && (
                        <p className="text-sm text-gray-400 italic px-3">No semesters yet.</p>
                    )}
                </div>
            </div>

            <div className="p-4 mt-auto border-t border-gray-100">
                <button
                    onClick={() => setIsScheduleModalOpen(true)}
                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition">
                    <Upload className="w-4 h-4" />
                    Upload Schedule
                </button>
            </div>

            <ScheduleUpload
                isOpen={isScheduleModalOpen}
                onClose={() => setIsScheduleModalOpen(false)}
            />
        </div>
    );
}
