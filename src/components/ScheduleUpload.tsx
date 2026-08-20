import { useState } from 'react';
import { Upload, X, Loader2, FileText, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useSemester } from '../contexts/SemesterContext';
import { motion, AnimatePresence } from 'framer-motion';
import Toast from './Toast';

type Props = {
    isOpen: boolean;
    onClose: () => void;
};

type ToastState = {
    message: string;
    type: 'success' | 'error' | 'info';
} | null;

export default function ScheduleUpload({ isOpen, onClose }: Props) {
    const { user } = useAuth();
    const { selectedSemester } = useSemester();
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const handleUpload = async () => {
        if (!file || !user || !selectedSemester) return;

        setUploading(true);
        setError(null);

        try {
            // 1. Upload to Storage
            const fileExt = file.name.split('.').pop();
            const filePath = `${user.id}/schedules/${Date.now()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('lecture-uploads')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('lecture-uploads')
                .getPublicUrl(filePath);

            // 2. Insert into DB
            const { error: dbError } = await supabase
                .from('schedules')
                .insert({
                    user_id: user.id,
                    semester_id: selectedSemester.id,
                    file_url: publicUrl,
                    processing_status: 'pending'
                });

            if (dbError) throw dbError;

            // 3. There is no automatic extraction pipeline for schedules yet — the old
            // n8n webhook this used to call 404'd on every attempt. Tell the user the
            // truth instead of showing a fake success screen with confetti.
            setToast({
                message: 'Schedule saved. Automatic class extraction is not available yet.',
                type: 'info',
            });
            setFile(null);
        } catch (err: any) {
            console.error('Upload failed:', err);
            setError(err.message || 'Failed to upload schedule');
        } finally {
            setUploading(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setError(null);
        setToast(null);
        onClose();
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                {toast && (
                    <Toast
                        message={toast.message}
                        type={toast.type}
                        onClose={() => setToast(null)}
                    />
                )}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative overflow-hidden"
                >
                    <button
                        onClick={handleClose}
                        className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    <div className="mb-6">
                        <h2 className="text-xl font-bold text-gray-900">Upload Schedule</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            Upload your syllabus or class schedule (PDF/Image) for {selectedSemester?.name}.
                        </p>
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">
                            {error}
                        </div>
                    )}

                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 mb-6 text-center hover:bg-gray-50 transition cursor-pointer relative">
                        <input
                            type="file"
                            onChange={handleFileChange}
                            accept="image/*,application/pdf"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        {file ? (
                            <div className="flex flex-col items-center">
                                {file.type.includes('image') ? <ImageIcon className="w-8 h-8 text-blue-500 mb-2" /> : <FileText className="w-8 h-8 text-blue-500 mb-2" />}
                                <p className="font-medium text-gray-900">{file.name}</p>
                                <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center">
                                <Upload className="w-8 h-8 text-gray-400 mb-2" />
                                <p className="font-medium text-gray-600">Click to upload</p>
                                <p className="text-xs text-gray-400">PDF or Images</p>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleUpload}
                        disabled={!file || uploading || !selectedSemester}
                        className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {uploading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Uploading...
                            </>
                        ) : (
                            'Process Schedule'
                        )}
                    </button>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
