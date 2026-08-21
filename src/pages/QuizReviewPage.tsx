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
    try {
      // functions.invoke RESOLVES with { error } rather than throwing, in the
      // documented case — but the whole flow is wrapped in try/catch anyway,
      // so an unexpected throw can't strand `busy` at true with the paste
      // form's submit button dead and no explanation on screen.
      const { data, error: err } = await supabase.functions.invoke('parse-quiz', {
        body: { lectureId, ...src },
      });
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Cleared only here — after every DB round trip above, not right after
      // the invoke — so QuizPasteForm's submit button stays disabled for the
      // whole operation. A second click mid-flight would re-invoke parse-quiz
      // (a billed LLM parse), insert a duplicate quiz_reviews row, and race
      // this call's own state setters. The early-return paths (invoke error,
      // zero-item) hit this too, so the form is never left dead.
      setBusy(false);
    }
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

    const reloaded = await loadItems(reviewId);
    setBusy(false);
    // Never a bare success when something failed. And if the post-run reload
    // itself failed, say so too, composed into the same message rather than
    // clobbered by it: onProgress only ever patched `diagnosis_status`
    // locally, never the full `diagnosis` payload, so a failed reload here
    // means the cards below may not reflect what actually happened.
    if (result.failed.length) {
      const summary = `${result.succeeded.length} of ${ids.length} diagnosed · ${result.failed.length} failed. Retry them below.`;
      setError(reloaded === null
        ? `${summary} The results below could also not be refreshed — what's shown may be out of date.`
        : summary);
    }
  };

  const misses = items.filter((i) => !i.is_correct);

  // No auto-reload effect on 'results': a `select` fired the instant `stage`
  // becomes 'results' races diagnose-miss's edge-function round trip and
  // reliably reads back 'pending'/'diagnosing' rows *before* the DB reflects
  // what onProgress just patched into local state optimistically —
  // overwriting that optimistic state with rows DiagnosisCard has no branch
  // for (`if (!d) return null`), blanking the whole page for the run.
  // runDiagnosis's own `await loadItems(reviewId)` after the fan-out
  // completes is the only reload worth doing.

  // Addition 2 (every item parsed correct) only fires once, at parse time.
  // A student who starts with a miss, flips it to "Got it right" on the
  // confirm table, and leaves would otherwise strand the review at
  // 'awaiting_confirmation' forever — the exact dead end Addition 2 exists
  // to close, reached by a different route. Mirror that write whenever the
  // confirm-stage miss count reaches zero, however it got there.
  useEffect(() => {
    if (stage !== 'confirm' || !reviewId || items.length === 0 || misses.length > 0) return;
    void supabase.from('quiz_reviews').update({ status: 'completed' }).eq('id', reviewId)
      .then(({ error: revErr }) => {
        if (revErr) setError(`This quiz has nothing to diagnose, but we couldn't record that: ${revErr.message}`);
      });
  }, [stage, reviewId, items.length, misses.length]);

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
