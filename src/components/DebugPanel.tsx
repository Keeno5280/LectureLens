import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Bug, X, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';

export default function DebugPanel() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [lectures, setLectures] = useState<any[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      loadLectures();
      setupRealtimeMonitoring();
    }
  }, [isOpen, user]);

  const loadLectures = async () => {
    if (!user) return;

    setIsRefreshing(true);
    const { data } = await supabase
      .from('lectures')
      .select('id, title, processing_status, created_at, updated_at, processed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (data) {
      setLectures(data);
    }
    setIsRefreshing(false);
  };

  const setupRealtimeMonitoring = () => {
    if (!user) return;

    const channel = supabase
      .channel('debug-monitor')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lectures',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const event = {
            timestamp: new Date().toISOString(),
            type: payload.eventType,
            old: payload.old,
            new: payload.new,
          };
          setRealtimeEvents((prev) => [event, ...prev].slice(0, 20));
          loadLectures();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-50';
      case 'processing':
        return 'text-blue-600 bg-blue-50';
      case 'pending':
        return 'text-yellow-600 bg-yellow-50';
      case 'failed':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4" />;
      case 'processing':
        return <RefreshCw className="w-4 h-4 animate-spin" />;
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'failed':
        return <XCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 bg-purple-600 text-white p-3 rounded-full shadow-lg hover:bg-purple-700 transition"
        title="Debug Panel"
      >
        <Bug className="w-6 h-6" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <Bug className="w-5 h-5 text-purple-600" />
                <h2 className="text-lg font-bold text-gray-900">Debug Panel</h2>
                <span className="text-xs text-gray-500">(Development Only)</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Recent Lectures</h3>
                  <button
                    onClick={loadLectures}
                    disabled={isRefreshing}
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                <div className="space-y-2">
                  {lectures.map((lecture) => (
                    <div
                      key={lecture.id}
                      className="bg-gray-50 p-3 rounded-lg text-sm"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 mb-1">
                            {lecture.title}
                          </div>
                          <div className="text-xs text-gray-500 font-mono">
                            ID: {lecture.id}
                          </div>
                        </div>
                        <div
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${getStatusColor(
                            lecture.processing_status
                          )}`}
                        >
                          {getStatusIcon(lecture.processing_status)}
                          {lecture.processing_status}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                        <div>
                          <span className="font-medium">Created:</span>{' '}
                          {new Date(lecture.created_at).toLocaleString()}
                        </div>
                        <div>
                          <span className="font-medium">Updated:</span>{' '}
                          {new Date(lecture.updated_at).toLocaleString()}
                        </div>
                      </div>
                      {lecture.processed_at && (
                        <div className="text-xs text-gray-600 mt-1">
                          <span className="font-medium">Processed:</span>{' '}
                          {new Date(lecture.processed_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                  {lectures.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      No lectures found
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900 mb-3">
                  Real-time Events ({realtimeEvents.length})
                </h3>
                <div className="space-y-2">
                  {realtimeEvents.map((event, index) => (
                    <div
                      key={index}
                      className="bg-green-50 border border-green-200 p-3 rounded-lg text-sm"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-green-900">
                          {event.type}
                        </span>
                        <span className="text-xs text-green-700">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {event.new && (
                        <div className="text-xs space-y-1">
                          <div className="flex gap-2">
                            <span className="text-gray-600">Status:</span>
                            <span className="font-medium">
                              {event.old?.processing_status} →{' '}
                              {event.new.processing_status}
                            </span>
                          </div>
                          <div className="text-gray-600 font-mono">
                            ID: {event.new.id}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {realtimeEvents.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      No real-time events captured yet
                      <div className="text-xs mt-2">
                        Events will appear here when lectures are updated
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t p-4 bg-gray-50">
              <h4 className="font-semibold text-sm text-gray-900 mb-2">
                Troubleshooting Tips
              </h4>
              <ul className="text-xs text-gray-700 space-y-1">
                <li>
                  • Check browser console for "📡 Realtime subscription status"
                  logs
                </li>
                <li>
                  • Verify n8n workflow is sending PATCH request to correct
                  Supabase URL
                </li>
                <li>
                  • Ensure processing_status is being updated to "completed" not
                  "complete"
                </li>
                <li>
                  • Check that n8n is using SUPABASE_SERVICE_ROLE_KEY for auth
                </li>
                <li>
                  • Verify Realtime is enabled: ALTER PUBLICATION
                  supabase_realtime ADD TABLE lectures
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
