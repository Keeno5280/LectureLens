import { useState } from 'react';
import { ClipboardPaste, Image as ImageIcon, Loader2 } from 'lucide-react';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface QuizSource {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
}

interface Props {
  onSubmit: (src: QuizSource) => Promise<void>;
  busy: boolean;
}

export default function QuizPasteForm({ onSubmit, busy }: Props) {
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [image, setImage] = useState<{ base64: string; mediaType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readFile = (file: File) => {
    setError(null);
    if (!ALLOWED.includes(file.type)) {
      setError(`That file is a ${file.type || 'unknown type'}. Use a PNG, JPEG, GIF or WebP.`);
      return;
    }
    // Capped client-side so an oversized screenshot gets a sentence a person can
    // act on, instead of an unexplained 400 from the API.
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That screenshot is larger than 5MB. Crop it or lower the resolution.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read that file. Try saving it again.');
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      if (comma === -1) { setError('That file could not be decoded.'); return; }
      setImage({ base64: result.slice(comma + 1), mediaType: file.type });
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    if (mode === 'text') {
      if (!text.trim()) { setError('Paste the quiz first.'); return; }
      await onSubmit({ text });
    } else {
      if (!image) { setError('Choose a screenshot first.'); return; }
      await onSubmit({ imageBase64: image.base64, imageMediaType: image.mediaType });
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-md p-8">
      <h2 className="text-xl font-semibold mb-2">Add the quiz you took</h2>
      <p className="text-gray-600 mb-6">
        Paste it as text, or upload a screenshot of the graded results page. Include your answers
        and the correct ones — that is what makes a diagnosis possible.
      </p>

      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => setMode('text')} disabled={busy}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
            mode === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
          <ClipboardPaste className="w-4 h-4" /> Paste text
        </button>
        <button type="button" onClick={() => setMode('image')} disabled={busy}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
            mode === 'image' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
          <ImageIcon className="w-4 h-4" /> Screenshot
        </button>
      </div>

      {mode === 'text' ? (
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={12}
          placeholder={'1. A worldview primarily does which of the following?\n  A. Shapes reality, identity, purpose, and action  ← my answer ✓\n  B. Determines political opinions\n\n4. (True/False) Good systems are enough to transform people.\n  My answer: True ✗   Correct: False'}
          className="w-full border border-gray-300 rounded-lg p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      ) : (
        <div>
          <input type="file" accept={ALLOWED.join(',')} disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
            className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700" />
          {fileName && <p className="mt-3 text-sm text-gray-600">Ready: {fileName}</p>}
          <p className="mt-3 text-xs text-gray-500">
            The screenshot is read once and never stored.
          </p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button type="button" onClick={submit} disabled={busy}
        className="mt-6 inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {busy ? 'Reading the quiz…' : 'Read the quiz'}
      </button>
    </div>
  );
}
