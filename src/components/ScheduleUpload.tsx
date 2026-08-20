import { useState } from 'react';
import { Upload, X, Loader2, FileText, Image as ImageIcon, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useSemester } from '../contexts/SemesterContext';
import { useNavigate } from '../hooks/useNavigate';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

type Props = {
    isOpen: boolean;
    onClose: () => void;
};

export default function ScheduleUpload({ isOpen, onClose }: Props) {
    const { user } = useAuth();
    const { selectedSemester } = useSemester();
    const navigate = useNavigate();
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const triggerConfetti = () => {
        const duration = 3000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 60 };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval: any = setInterval(function () {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
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
            const { data: schedule, error: dbError } = await supabase
                .from('schedules')
                .insert({
                    user_id: user.id,
                    semester_id: selectedSemester.id,
                    file_url: publicUrl,
                    processing_status: 'pending'
                })
                .select()
                .single();

            if (dbError) throw dbError;

            // 3. Trigger n8n Webhook
            const webhookUrl = 'https://n8n-e2ph.onrender.com/webhook/schedule-upload';

            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: schedule.id,
                    user_id: user.id,
                    semester_id: selectedSemester.id,
                    file_url: publicUrl
                })
            });

            // 4. Success State
            setSuccess(true);
            triggerConfetti();

        } catch (err: any) {
            console.error('Upload failed:', err);
            setError(err.message || 'Failed to upload schedule');
        } finally {
            setUploading(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setSuccess(false);
        setError(null);
        onClose();
    };

    const handleViewClasses = () => {
        navigate('classes');
        handleClose();
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
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

                    <AnimatePresence mode="wait">
                        {!success ? (
                            <motion.div
                                key="upload-form"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
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
                        ) : (
                            <motion.div
                                key="success-view"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center py-8 text-center"
                            >
                                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                                    <motion.svg
                                        initial={{ pathLength: 0 }}
                                        animate={{ pathLength: 1 }}
                                        transition={{ duration: 0.5, ease: "easeInOut" }}
                                        className="w-10 h-10 text-green-600"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={3}
                                    >
                                        <motion.path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M5 13l4 4L19 7"
                                        />
                                    </motion.svg>
                                </div>

                                <h3 className="text-2xl font-bold text-gray-900 mb-2">Upload Complete!</h3>
                                <p className="text-gray-600 mb-8 max-w-[260px]">
                                    Your schedule is being processed. Classes will appear in your dashboard shortly.
                                </p>

                                <button
                                    onClick={handleViewClasses}
                                    className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2 shadow-lg shadow-green-200"
                                >
                                    View My Classes
                                    <ArrowRight className="w-5 h-5" />
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
