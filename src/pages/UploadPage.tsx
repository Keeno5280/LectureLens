import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Upload, Mic, ArrowLeft, Check, Presentation, Eye, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/AuthContext';
import Toast from '../components/Toast';
import { getTranscriber, isTranscribable } from '../lib/transcribe';

type ToastState = {
  message: string;
  type: 'success' | 'error' | 'info';
} | null;

// A retry can only re-run analysis — it cannot manufacture a transcript. If the
// lecture is audio/video and never got a transcript saved (e.g. the tab closed
// mid-transcription), retrying analyze-lecture will just fail again with "No
// transcript available." Tell the user to re-upload instead of promising a retry
// that can't succeed.
const needsReupload = (lecture: { file_type?: string; transcript?: string | null }) =>
  (lecture.file_type === 'audio' || lecture.file_type === 'video') && !lecture.transcript;

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
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [isDraggingSlides, setIsDraggingSlides] = useState(false);

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
    setUploadProgress(0);          // new upload genuinely starts here — explicit reset, not clamped

    // Progress must never visibly regress (a real observed failure mode: transformers.js
    // reports per-file download progress, so a second model artifact starting its own fetch
    // resets its raw progress to 0, which without clamping would rewind the bar).
    const bumpProgress = (next: number) => setUploadProgress((p) => Math.max(p, next));

    let lectureId: string | undefined;
    // Set when the failure is known to have already been recorded server-side
    // (see the fnError handling below) so the catch block doesn't clobber it
    // with a generic client-side message.
    let serverAlreadyRecordedError = false;

    try {
      bumpProgress(10);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `${user.id}/${fileName}`;

      bumpProgress(30);

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

      bumpProgress(60);

      const { data: { publicUrl } } = supabase.storage
        .from('lecture-uploads')
        .getPublicUrl(filePath);

      const fileType = file.type.startsWith('audio/') ? 'audio' :
                       file.type.startsWith('video/') ? 'video' : 'slides';

      bumpProgress(70);

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
      lectureId = lecture.id;

      // Transcribe in the browser for audio/video. Slides go straight to Claude.
      if (isTranscribable(file)) {
        const { error: statusError } = await supabase.from('lectures')
          .update({ processing_status: 'transcribing' }).eq('id', lecture.id);
        if (statusError) {
          // Non-fatal: this write only exists to make an interrupted run visibly
          // in-flight. Transcription can still proceed without it.
          console.error('Could not mark lecture as transcribing (continuing anyway):', statusError);
        }

        const transcriber = await getTranscriber();
        const transcript = await transcriber.transcribe(file, (pct) =>
          bumpProgress(60 + pct * 0.25));          // transcription = 60%..85%

        const { error: tErr } = await supabase.from('lectures').update({
          transcript,
          transcript_source: transcriber.name,
          processing_status: 'transcribed',
        }).eq('id', lecture.id);
        if (tErr) throw new Error(`Could not save transcript: ${tErr.message}`);
      }

      bumpProgress(90);

      const { error: fnError } = await supabase.functions.invoke('analyze-lecture', {
        body: { lectureId: lecture.id },
      });
      if (fnError) {
        // FunctionsHttpError means analyze-lecture actually ran and returned a
        // controlled non-2xx response — in this codebase that always means it
        // went through its own fail() helper, which already wrote a precise
        // processing_error to this row server-side. FunctionsFetchError (the
        // request never reached the function — network/CORS) and
        // FunctionsRelayError (rejected by the gateway before the function ran)
        // mean nothing was recorded, so the catch block below still needs to.
        serverAlreadyRecordedError = fnError instanceof FunctionsHttpError;
        throw new Error(`AI analysis failed to start: ${fnError.message}`);
      }

      bumpProgress(100);
      setUploadedLectureId(lecture.id);
      setUploadStatus('success');

      await fetchUploadedLecture();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      let recoveryFailed = false;
      // Only write a client-side error when the failure was genuinely
      // client-side (or never reached the server at all). When
      // serverAlreadyRecordedError is true, the edge function's own fail()
      // helper already wrote a precise, server-side reason to this row —
      // overwriting it here would replace that precise reason with this
      // generic "AI analysis failed to start: ..." string.
      if (lectureId && !serverAlreadyRecordedError) {
        const { error: recoveryError } = await supabase.from('lectures').update({
          processing_status: 'failed', processing_error: message.slice(0, 500),
        }).eq('id', lectureId);
        if (recoveryError) {
          // The write whose entire job is recording the failure just failed itself.
          // The lecture row is now stuck in whatever non-terminal status it had
          // (pending/transcribing/etc) from every other view — Dashboard, DebugPanel,
          // ClassNotesPage. Don't let the user believe it was cleanly marked failed.
          console.error('Could not record failure status on lecture:', lectureId, recoveryError);
          recoveryFailed = true;
        }
      }
      setUploadStatus('error');
      setToast({
        message: recoveryFailed
          ? `❌ ${message} (and the failure could not be recorded — this lecture may still show as in-progress; you can delete it from the dashboard and re-upload)`
          : `❌ ${message}`,
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

  const handleDragOver = (e: React.DragEvent, type: 'audio' | 'slides') => {
    e.preventDefault();
    e.stopPropagation();
    if (type === 'audio') {
      setIsDraggingAudio(true);
    } else {
      setIsDraggingSlides(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent, type: 'audio' | 'slides') => {
    e.preventDefault();
    e.stopPropagation();
    if (type === 'audio') {
      setIsDraggingAudio(false);
    } else {
      setIsDraggingSlides(false);
    }
  };

  const handleDrop = (e: React.DragEvent, type: 'audio' | 'slides') => {
    e.preventDefault();
    e.stopPropagation();

    if (type === 'audio') {
      setIsDraggingAudio(false);
    } else {
      setIsDraggingSlides(false);
    }

    if (!title || !classId) {
      setToast({
        message: 'Please enter a title and select a class first',
        type: 'error',
      });
      return;
    }

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];

      if (type === 'audio') {
        const isValidAudio = file.type.startsWith('audio/') || file.type.startsWith('video/');
        if (!isValidAudio) {
          setToast({
            message: 'Please drop an audio or video file',
            type: 'error',
          });
          return;
        }
      } else if (type === 'slides') {
        const isValidSlide = file.type === 'application/pdf';
        if (!isValidSlide) {
          setToast({
            message: 'Please drop a PDF file',
            type: 'error',
          });
          return;
        }
      }

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

  const retryAnalysis = async (id: string) => {
    // Invoke FIRST — see the identical, longer comment on
    // LectureDetailPage's retryAnalysis. analyze-lecture is fully
    // synchronous (~60s verified), so a failed invoke means the row is
    // exactly as it was ('failed' with its original processing_error, never
    // wiped), and a successful invoke means the edge function's own writes
    // have already carried the row to its true terminal state — nothing left
    // for this handler to reset without regressing a 'completed' row back to
    // a fabricated 'pending'.
    const { error: invokeError } = await supabase.functions.invoke('analyze-lecture', {
      body: { lectureId: id },
    });
    if (invokeError) {
      setToast({ message: `❌ Retry failed: ${invokeError.message}`, type: 'error' });
      return;
    }

    setToast({ message: 'Retry started. This page will update automatically.', type: 'info' });
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
                        : uploadedLecture.processing_status === 'failed'
                        ? 'bg-red-100 text-red-800'
                        : uploadedLecture.processing_status === 'processing' ||
                          uploadedLecture.processing_status === 'transcribing' ||
                          uploadedLecture.processing_status === 'transcribed' ||
                          uploadedLecture.processing_status === 'analyzing'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {uploadedLecture.processing_status === 'completed' && '✓'}
                    {uploadedLecture.processing_status === 'failed' && '✕'}
                    {(uploadedLecture.processing_status === 'processing' ||
                      uploadedLecture.processing_status === 'transcribing' ||
                      uploadedLecture.processing_status === 'transcribed' ||
                      uploadedLecture.processing_status === 'analyzing') && (
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

            {uploadedLecture.processing_status === 'transcribing' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <p className="text-sm text-blue-800 font-medium">
                    Transcribing in your browser…
                  </p>
                </div>
                <p className="text-xs text-blue-700">
                  This can take a few minutes for longer recordings. Keep this tab open.
                </p>
              </div>
            )}

            {(uploadedLecture.processing_status === 'transcribed' ||
              uploadedLecture.processing_status === 'analyzing') && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <p className="text-sm text-blue-800 font-medium">
                    Analyzing with AI…
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

            {uploadedLecture.processing_status === 'failed' && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 mt-4">
                <p className="font-medium text-red-800">Processing failed</p>
                <p className="mt-1 text-sm text-red-700">
                  {uploadedLecture.processing_error ?? 'No further detail was recorded.'}
                </p>
                {needsReupload(uploadedLecture) ? (
                  <p className="mt-3 text-sm text-red-700">
                    No transcript was saved for this recording, so Retry can't succeed.
                    Delete this lecture from the dashboard and re-upload it to try again.
                  </p>
                ) : (
                  <button
                    onClick={() => retryAnalysis(uploadedLecture.id)}
                    className="mt-3 rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
                  >
                    Retry
                  </button>
                )}
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
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition ${
                isDraggingAudio
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-blue-500'
              }`}
              onDragOver={(e) => handleDragOver(e, 'audio')}
              onDragLeave={(e) => handleDragLeave(e, 'audio')}
              onDrop={(e) => handleDrop(e, 'audio')}
            >
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 transition ${
                isDraggingAudio ? 'bg-blue-200' : 'bg-blue-100'
              }`}>
                <Upload className={`w-8 h-8 transition ${
                  isDraggingAudio ? 'text-blue-700' : 'text-blue-600'
                }`} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Audio/Video</h3>
              <p className="text-sm text-gray-600 mb-4">
                {isDraggingAudio ? 'Drop file here' : 'Drag & drop or click to upload'}
              </p>
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

            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition ${
                isDraggingSlides
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 hover:border-green-500'
              }`}
              onDragOver={(e) => handleDragOver(e, 'slides')}
              onDragLeave={(e) => handleDragLeave(e, 'slides')}
              onDrop={(e) => handleDrop(e, 'slides')}
            >
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 transition ${
                isDraggingSlides ? 'bg-green-200' : 'bg-green-100'
              }`}>
                <Presentation className={`w-8 h-8 transition ${
                  isDraggingSlides ? 'text-green-700' : 'text-green-600'
                }`} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Slides</h3>
              <p className="text-sm text-gray-600 mb-4">
                {isDraggingSlides ? 'Drop file here' : 'Drag & drop or click to upload'}
              </p>
              <label className="cursor-pointer inline-block">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={!title || !classId}
                  multiple
                />
                <span
                  className={`px-6 py-2 rounded-lg font-medium inline-block transition ${
                    !title || !classId
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700 cursor-pointer'
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
