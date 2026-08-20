import { useEffect } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

type ToastProps = {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
  duration?: number;
};

export default function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${
          type === 'success'
            ? 'bg-green-50 border border-green-200'
            : type === 'error'
            ? 'bg-red-50 border border-red-200'
            : 'bg-slate-50 border border-slate-200'
        }`}
      >
        {type === 'success' ? (
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
        ) : type === 'error' ? (
          <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
        ) : (
          <Info className="w-5 h-5 text-slate-500 flex-shrink-0" />
        )}
        <span
          className={`text-sm font-medium ${
            type === 'success'
              ? 'text-green-800'
              : type === 'error'
              ? 'text-red-800'
              : 'text-slate-700'
          }`}
        >
          {message}
        </span>
        <button
          onClick={onClose}
          className={`ml-2 ${
            type === 'success'
              ? 'text-green-600 hover:text-green-800'
              : type === 'error'
              ? 'text-red-600 hover:text-red-800'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
