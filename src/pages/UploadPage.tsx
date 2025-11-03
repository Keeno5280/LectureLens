import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, Mic, ArrowLeft, Check, Presentation } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';
import Toast from '../components/Toast';

type ToastState = {
  message: string;
  type: 'success' | 'error';
} | null;

export default function UploadPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [title, setTitle] = useState('');
  const [classId, setClassId] = useState('');
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (user) {
      loadClasses();
    }
  }, [user]);

  const loadClasses = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('classes')
      .select('id, name')
      .eq('user_id', user.id)
      .order('name');

    if (data) setClasses(data);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        setRecordedChunks(chunks);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (error) {
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!title || !classId) {
      setToast({
        message: 'Please enter a title and select a class',
        type: 'error',
      });
      return;
    }

    if (!user) {
      setToast({
        message: 'You must be logged in to upload lectures',
        type: 'error',
      });
      return;
    }

    setProcessing(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('lecture-uploads')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error('Failed to upload file to storage');
      }

      const { data: { publicUrl } } = supabase.storage
        .from('lecture-uploads')
        .getPublicUrl(filePath);

      const fileType = file.type.startsWith('audio/') ? 'audio' :
                       file.type.startsWith('video/') ? 'video' : 'slides';

      const { data: lecture, error: insertError } = await supabase
        .from('lectures')
        .insert({
          user_id: user.id,
          class_id: classId,
          title,
          file_url: publicUrl,
          file_type: fileType,
          processing_status: 'pending',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const webhookUrl = 'https://n8n-e2ph.onrender.com/webhook/5f34c729-47b8-4f87-9323-f7462f7cfd7c';

      fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(lecture),
      }).catch((err) => {
        console.error('Webhook error:', err);
      });

      setSuccess(true);
      setToast({
        message: '✅ Lecture uploaded! Processing will begin shortly.',
        type: 'success',
      });

      setTimeout(() => {
        navigate('dashboard');
      }, 2000);
    } catch (error) {
      console.error('Upload error:', error);
      setToast({
        message: 'Error uploading lecture. Please try again.',
        type: 'error',
      });
      setProcessing(false);
    }
  };

  const handleRecordedUpload = async () => {
    if (recordedChunks.length === 0) return;

    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
    await handleFileUpload(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  if (processing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-12 text-center max-w-md">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing...</h2>
          <p className="text-gray-600">Your lecture is being uploaded and processed</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-12 text-center max-w-md">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Summary Ready!</h2>
          <p className="text-gray-600">Redirecting to dashboard...</p>
        </div>
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Upload or Record Lecture</h1>

        <div className="bg-white rounded-2xl shadow-md p-8 mb-8">
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
              Lecture Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Introduction to Biology"
            />
          </div>

          <div className="mb-8">
            <label htmlFor="class" className="block text-sm font-medium text-gray-700 mb-2">
              Select Class
            </label>
            <select
              id="class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Choose a class...</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            {classes.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">
                No classes found.{' '}
                <button
                  onClick={() => navigate('classes')}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Create one first
                </button>
              </p>
            )}
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-500 transition">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Audio/Video</h3>
              <p className="text-sm text-gray-600 mb-4">Upload audio or video file</p>
              <label className="cursor-pointer inline-block">
                <input
                  type="file"
                  accept="audio/*,video/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={!title || !classId}
                />
                <span className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition inline-block">
                  Choose File
                </span>
              </label>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-purple-500 transition">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Presentation className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Slides</h3>
              <p className="text-sm text-gray-600 mb-4">PowerPoint, PDF, or images</p>
              <label className="cursor-pointer inline-block">
                <input
                  type="file"
                  accept=".ppt,.pptx,.pdf,image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={!title || !classId}
                  multiple
                />
                <span className="bg-purple-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-purple-700 transition inline-block">
                  Choose Slides
                </span>
              </label>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-500 transition">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mic className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Record Audio</h3>
              <p className="text-sm text-gray-600 mb-4">Record from microphone</p>
              {!isRecording && recordedChunks.length === 0 && (
                <button
                  onClick={startRecording}
                  disabled={!title || !classId}
                  className="bg-red-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Recording
                </button>
              )}
              {isRecording && (
                <button
                  onClick={stopRecording}
                  className="bg-gray-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-700 transition"
                >
                  Stop Recording
                </button>
              )}
              {!isRecording && recordedChunks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-green-600 font-medium">Recording complete</p>
                  <button
                    onClick={handleRecordedUpload}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition"
                  >
                    Upload Recording
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
