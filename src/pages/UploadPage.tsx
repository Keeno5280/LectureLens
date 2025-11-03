import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, Mic, ArrowLeft, Check, Presentation, Eye, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';
import Toast from '../components/Toast';

type ToastState = {
  message: string;
  type: 'success' | 'error';
} | null;

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export default function UploadPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedLectureId, setUploadedLectureId] = useState<string | null>(null);
  const [uploadedLecture, setUploadedLecture] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [classId, setClassId] = useState('');
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (user) {
      loadClasses();
    }
  }, [user]);

  useEffect(() => {
    if (uploadedLectureId) {
      fetchUploadedLecture();

      const channel = supabase
        .channel(`lecture-upload-${uploadedLectureId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'lectures',
            filter: `id=eq.${uploadedLectureId}`,
          },
          (payload) => {
            console.log('Lecture updated in real-time:', payload);
            setUploadedLecture(payload.new);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [uploadedLectureId]);

  const loadClasses = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('classes')
      .select('id, name')
      .eq('user_id', user.id)
      .order('name');

    if (data) setClasses(data);
  };

  const fetchUploadedLecture = async () => {
    if (!uploadedLectureId || !user) return;

    try {
      const { data, error } = await supabase
        .from('lectures')
        .select('*')
        .eq('id', uploadedLectureId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setUploadedLecture(data);
      }
    } catch (error) {
      console.error('Error fetching uploaded lecture:', error);
    }
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
      setToast({
        message: 'Could not access microphone. Please check permissions.',
        type: 'error',
      });
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

    setUploadStatus('uploading');
    setUploadProgress(10);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `${user.id}/${fileName}`;

      setUploadProgress(30);

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

      setUploadProgress(60);

      const { data: { publicUrl } } = supabase.storage
        .from('lecture-uploads')
        .getPublicUrl(filePath);

      const fileType = file.type.startsWith('audio/') ? 'audio' :
                       file.type.startsWith('video/') ? 'video' : 'slides';

      setUploadProgress(70);

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

      setUploadProgress(85);

      const webhookUrl = 'https://n8n-e2ph.onrender.com/webhook/5f34c729-47b8-4f87-9323-f7462f7cfd7c';

      fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(lecture),
      }).catch((err) => {
        console.warn('Webhook notification failed:', err);
      });

      setUploadProgress(100);
      setUploadedLectureId(lecture.id);
      setUploadStatus('success');

      setToast({
        message: '✅ Lecture uploaded successfully! AI processing will begin shortly.',
        type: 'success',
      });

      await fetchUploadedLecture();
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus('error');
      setToast({
        message: 'Error uploading lecture. Please try again.',
        type: 'error',
      });
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

  const handleRetry = () => {
    setUploadStatus('idle');
    setUploadProgress(0);
    setUploadedLectureId(null);
    setUploadedLecture(null);
    setRetryAttempt(retryAttempt + 1);
  };

  const handleViewLecture = () => {
    if (uploadedLectureId) {
      navigate('lecture', uploadedLectureId);
    }
  };

  const handleBackToDashboard = () => {
    navigate('dashboard');
  };

  if (uploadStatus === 'uploading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-12 text-center max-w-md w-full">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
            <div
              className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"
              style={{
                clipPath: `polygon(0 0, ${uploadProgress}% 0, ${uploadProgress}% 100%, 0 100%)`,
              }}
            ></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold text-blue-600">{uploadProgress}%</span>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Uploading Lecture</h2>
          <p className="text-gray-600 mb-4">Please wait while we upload your file...</p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            ></div>
          </div>
        </div>
      </div>
    );
  }

  if (uploadStatus === 'success' && uploadedLecture) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 md:p-12 text-center max-w-2xl w-full">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Upload Successful!</h2>
          <p className="text-gray-600 mb-8">
            Your lecture has been uploaded and is ready for AI processing.
          </p>

          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 mb-6 text-left border border-blue-100">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2">{uploadedLecture.title}</h3>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full ${
                      uploadedLecture.processing_status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : uploadedLecture.processing_status === 'processing'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {uploadedLecture.processing_status === 'completed' && '✓'}
                    {uploadedLecture.processing_status === 'processing' && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {uploadedLecture.processing_status === 'pending' && '⏳'}
                    {uploadedLecture.processing_status}
                  </span>
                </div>
              </div>
            </div>

            {uploadedLecture.processing_status === 'pending' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
                <p className="text-sm text-yellow-800 font-medium">
                  ⏳ Waiting for AI processing to begin...
                </p>
                <p className="text-xs text-yellow-700 mt-1">
                  This usually takes a few moments. The page will update automatically.
                </p>
              </div>
            )}

            {uploadedLecture.processing_status === 'processing' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <p className="text-sm text-blue-800 font-medium">
                    AI is analyzing your lecture...
                  </p>
                </div>
                <p className="text-xs text-blue-700">
                  Generating summary, key points, and study materials.
                </p>
              </div>
            )}

            {uploadedLecture.processing_status === 'completed' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
                <p className="text-sm text-green-800 font-medium">
                  ✓ AI analysis complete! Your lecture notes are ready.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleViewLecture}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition shadow-md"
            >
              <Eye className="w-5 h-5" />
              View Lecture Details
            </button>
            <button
              onClick={handleBackToDashboard}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Dashboard
            </button>
          </div>

          <button
            onClick={() => {
              setUploadStatus('idle');
              setUploadedLectureId(null);
              setUploadedLecture(null);
              setTitle('');
            }}
            className="mt-6 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Upload Another Lecture
          </button>
        </div>
      </div>
    );
  }

  if (uploadStatus === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-12 text-center max-w-md">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">✕</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Upload Failed</h2>
          <p className="text-gray-600 mb-8">
            There was an error uploading your lecture. Please try again.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleRetry}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              <RefreshCw className="w-5 h-5" />
              Try Again
            </button>
            <button
              onClick={handleBackToDashboard}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition"
            >
              Back to Dashboard
            </button>
          </div>
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
              Lecture Title <span className="text-red-500">*</span>
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
              Select Class <span className="text-red-500">*</span>
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
                <span
                  className={`px-6 py-2 rounded-lg font-medium inline-block transition ${
                    !title || !classId
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                  }`}
                >
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
                <span
                  className={`px-6 py-2 rounded-lg font-medium inline-block transition ${
                    !title || !classId
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-purple-600 text-white hover:bg-purple-700 cursor-pointer'
                  }`}
                >
                  Choose Slides
                </span>
              </label>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-red-500 transition">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mic className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Record Audio</h3>
              <p className="text-sm text-gray-600 mb-4">Record from microphone</p>
              {!isRecording && recordedChunks.length === 0 && (
                <button
                  onClick={startRecording}
                  disabled={!title || !classId}
                  className={`px-6 py-2 rounded-lg font-medium transition ${
                    !title || !classId
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
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
                  <p className="text-sm text-green-600 font-medium">✓ Recording complete</p>
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
