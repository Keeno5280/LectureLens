import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useNavigate } from '../hooks/useNavigate';
import QuizPasteForm, { type QuizSource } from '../components/quiz/QuizPasteForm';
import ParsedQuizTable from '../components/quiz/ParsedQuizTable';
import DiagnosisCard from '../components/quiz/DiagnosisCard';
import { diagnoseAll } from '../lib/quiz/diagnose';
import type { QuizReviewItem } from '../lib/quiz/types';

interface Props { lectureId: string }

/**
 * supabase-js wraps any non-2xx `functions.invoke` response in a
 * FunctionsHttpError whose `.message` is the generic "Edge Function returned
 * a non-2xx status code" — every one of our edge functions replies with a
 * specific, actionable `{ error: string }` body instead (e.g. the 409 "This
 * lecture has not finished analysis yet…"), but that body only lives on
 * `.context`, which is the raw Response. Read it there, falling back to the
 * generic message when the body isn't the JSON shape we expect.
 */
async function readInvokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const body: unknown = await error.context.json();
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        return (body as { error: string }).error;
      }
    } catch {
      // Not JSON, or already consumed — fall through to the generic message.
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export default function QuizReviewPage({ lectureId }: Props) {
  const navigate = useNavigate();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [items, setItems] = useState<QuizReviewItem[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [reportedScore, setReportedScore] = useState<{ correct: number | null; total: number | null }>({ correct: null, total: null });
  const [stage, setStage] = useState<'input' | 'confirm' | 'results'>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async (id: string): Promise<QuizReviewItem[] | null> => {
    const { data, error: err } = await supabase
      .from('quiz_review_items').select('*').eq('review_id', id).order('position');
    if (err) { setError(`Could not load the quiz: ${err.message}`); return null; }
    const loaded = (data ?? []) as QuizReviewItem[];
    setItems(loaded);
    return loaded;
  }, []);

  const handleParse = async (src: QuizSource) => {
    setBusy(true); setError(null);
    // functions.invoke RESOLVES with { error }; it does not throw.
    const { data, error: err } = await supabase.functions.invoke('parse-quiz', {
      body: { lectureId, ...src },
    });
    setBusy(false);
    if (err) { setError(await readInvokeErrorMessage(err)); return; }

    // parse-quiz persists NOTHING and returns a genuine 200 with reviewId:
    // null when it found no readable questions at all. Discarding the
    // `unreadable` explanations here would throw away the entire value of
    // that path, and advancing past it would be a lie — there is no review
    // to confirm. Stay on the input stage and show exactly what could not be
    // read.
    if (!data?.reviewId) {
      const unreadableList = (data?.unreadable ?? []) as string[];
      setError(
        unreadableList.length > 0
          ? `I couldn't find any questions in that. Here's what I couldn't make out: ${unreadableList.join('; ')}`
          : "I couldn't find any questions in that.",
      );
      return;
    }

    setReviewId(data.reviewId);
    setUnreadable(data.unreadable ?? []);
    setReportedScore({ correct: data.scoreCorrect ?? null, total: data.scoreTotal ?? null });

    const loaded = await loadItems(data.reviewId);
    if (loaded === null) return; // loadItems already recorded the honest error.

    // Every item parsed as correct: there is nothing to diagnose. Close the
    // review out now rather than leaving it stuck in 'awaiting_confirmation'
    // forever — ParsedQuizTable's Diagnose button is disabled at missCount 0,
    // so nothing else would ever move it forward. The student still lands on
    // the confirm table below (not a dead end): a wrongly-marked-correct row
    // is exactly the case where they'd want to flip it and diagnose it.
    if (loaded.length > 0 && loaded.every((i) => i.is_correct)) {
      const { error: revErr } = await supabase.from('quiz_reviews')
        .update({ status: 'completed' }).eq('id', data.reviewId);
      if (revErr) setError(`This quiz has nothing to diagnose, but we couldn't record that: ${revErr.message}`);
    }

    setStage('confirm');
  };

  const patchItem = (id: string, patch: Partial<QuizReviewItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const runDiagnosis = async (ids: string[]) => {
    if (!reviewId) return;
    setBusy(true); setError(null);

    // Persist the student's corrections BEFORE diagnosing. The whole point of
    // the confirm gate is that these are what get diagnosed.
    for (const item of items) {
      const { error: upErr } = await supabase.from('quiz_review_items').update({
        student_answer: item.student_answer,
        correct_answer: item.correct_answer,
        is_correct: item.is_correct,
        diagnosis_status: item.is_correct ? 'not-applicable' : item.diagnosis_status,
      }).eq('id', item.id);
      if (upErr) { setBusy(false); setError(`Could not save your corrections: ${upErr.message}`); return; }
    }

    const { error: revErr } = await supabase.from('quiz_reviews')
      .update({ status: 'diagnosing' }).eq('id', reviewId);
    if (revErr) { setBusy(false); setError(`Could not start diagnosis: ${revErr.message}`); return; }

    setStage('results');
    const result = await diagnoseAll(
      ids,
      (itemId) => supabase.functions.invoke('diagnose-miss', { body: { itemId } })
        .then(async ({ error: e }) => ({ error: e ? { message: await readInvokeErrorMessage(e) } : null })),
      { onProgress: (itemId, state) => patchItem(itemId, { diagnosis_status: state }) },
    );

    await loadItems(reviewId);
    setBusy(false);
    // Never a bare success when something failed.
    if (result.failed.length) {
      setError(`${result.succeeded.length} of ${ids.length} diagnosed · ${result.failed.length} failed. Retry them below.`);
    }
  };

  const misses = items.filter((i) => !i.is_correct);

  useEffect(() => { if (reviewId && stage === 'results') void loadItems(reviewId); }, [reviewId, stage, loadItems]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <button type="button" onClick={() => navigate('lecture', lectureId)}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" /> Back to the lecture
      </button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {stage === 'input' && <QuizPasteForm onSubmit={handleParse} busy={busy} />}

      {stage === 'confirm' && (
        <>
          {items.length > 0 && misses.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              Nothing to diagnose — every question here parsed as correct. If we misread one, mark it
              "Missed it" below and confirm to diagnose it; otherwise you're done, no action needed.
            </div>
          )}
          <ParsedQuizTable
            items={items} unreadable={unreadable} reportedScore={reportedScore}
            onChange={patchItem} busy={busy}
            onConfirm={() => void runDiagnosis(misses.map((m) => m.id))}
          />
        </>
      )}

      {stage === 'results' && (
        <>
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h2 className="text-xl font-semibold">
              {items.filter((i) => i.diagnosis_status === 'completed').length} of {misses.length} diagnosed
              {items.some((i) => i.diagnosis_status === 'failed') &&
                ` · ${items.filter((i) => i.diagnosis_status === 'failed').length} failed`}
            </h2>
          </div>
          {misses.map((item) => (
            <DiagnosisCard key={item.id} item={item} busy={busy}
              onRetry={(id) => void runDiagnosis([id])} />
          ))}
        </>
      )}
    </div>
  );
}
