import { AlertTriangle, Check, X } from 'lucide-react';
import type { QuizReviewItem } from '../../lib/quiz/types';

interface Props {
  items: QuizReviewItem[];
  unreadable: string[];
  /** What the quiz PRINTED, not what the rows add up to. Never reconciled silently. */
  reportedScore: { correct: number | null; total: number | null };
  onChange: (id: string, patch: Partial<QuizReviewItem>) => void;
  onConfirm: () => void;
  busy: boolean;
}

/**
 * The honesty gate.
 *
 * If the parse decided the student answered "True" when they answered "False",
 * every diagnosis downstream will be fluent, well-cited and about a mistake
 * they never made — and they cannot catch it, because they came here not
 * knowing the material. So nothing is diagnosed until a human confirms this
 * table. The friction is the feature.
 */
export default function ParsedQuizTable({ items, unreadable, reportedScore, onChange, onConfirm, busy }: Props) {
  const missCount = items.filter((i) => !i.is_correct).length;
  const parsedCorrect = items.filter((i) => i.is_correct).length;

  // A results page often prints "3 / 4" while listing fewer questions in full —
  // the worked example's Q1-Q3 answers were inferred from exactly such a score.
  // Surface the disagreement instead of quietly picking a side.
  const scoreMismatch =
    reportedScore.correct !== null && reportedScore.total !== null &&
    (reportedScore.correct !== parsedCorrect || reportedScore.total !== items.length);

  return (
    <div className="bg-white rounded-2xl shadow-md p-8">
      <h2 className="text-xl font-semibold mb-2">Check this before we diagnose</h2>
      <p className="text-gray-600 mb-6">
        Make sure your answer and the correct answer are the right way round on every row. A
        diagnosis built on a misread answer explains a mistake you never made.
      </p>

      {scoreMismatch && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          The quiz reports <strong>{reportedScore.correct} / {reportedScore.total}</strong>, but these
          rows come to <strong>{parsedCorrect} / {items.length}</strong>. Some questions may be missing
          above, or one is marked the wrong way. The rows below are what gets diagnosed.
        </div>
      )}

      {unreadable.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-medium text-amber-900">
            <AlertTriangle className="w-4 h-4" /> Some of this could not be read
          </p>
          <ul className="mt-2 list-disc pl-6 text-sm text-amber-800">
            {unreadable.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className={`rounded-lg border p-4 ${item.is_correct ? 'border-gray-200' : 'border-red-200 bg-red-50/40'}`}>
            <div className="flex items-start justify-between gap-4">
              <p className="font-medium text-gray-900">
                {item.position}. {item.question_text}
              </p>
              <button type="button" disabled={busy}
                onClick={() => onChange(item.id, { is_correct: !item.is_correct })}
                className={`shrink-0 inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm font-medium ${
                  item.is_correct ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {item.is_correct ? <><Check className="w-4 h-4" /> Got it right</> : <><X className="w-4 h-4" /> Missed it</>}
              </button>
            </div>

            {item.question_type === 'multiple_choice' && item.options.length > 0 && (
              <ul className="mt-2 pl-5 text-sm text-gray-600 list-disc">
                {item.options.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="block font-medium text-gray-700 mb-1">Your answer</span>
                <input type="text" disabled={busy} value={item.student_answer ?? ''}
                  placeholder="not recorded"
                  onChange={(e) => onChange(item.id, { student_answer: e.target.value || null })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="block font-medium text-gray-700 mb-1">Correct answer</span>
                <input type="text" disabled={busy} value={item.correct_answer ?? ''}
                  placeholder="not recorded"
                  onChange={(e) => onChange(item.id, { correct_answer: e.target.value || null })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2" />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {missCount === 0
            ? 'Nothing marked as missed — mark a question above if you got it wrong.'
            : `${missCount} question${missCount === 1 ? '' : 's'} will be diagnosed.`}
        </p>
        <button type="button" onClick={onConfirm} disabled={busy || missCount === 0}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
          Diagnose {missCount} miss{missCount === 1 ? '' : 'es'}
        </button>
      </div>
    </div>
  );
}
