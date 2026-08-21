import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, Loader2, Plus } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useNavigate } from '../hooks/useNavigate';
import QuizPasteForm, { type QuizSource } from '../components/quiz/QuizPasteForm';
import ParsedQuizTable from '../components/quiz/ParsedQuizTable';
import DiagnosisCard from '../components/quiz/DiagnosisCard';
import { diagnoseAll } from '../lib/quiz/diagnose';
import { reconcileAfterRun } from '../lib/quiz/reconcile';
import type { QuizReviewItem } from '../lib/quiz/types';

interface Props { lectureId: string }

/**
 * One earlier quiz review, summarised from ITS ITEMS.
 *
 * Deliberately no `status`. `quiz_reviews.status` has two known consistency
 * gaps that are parked precisely because nothing reads it; reading it here
 * would make both user-visible. The items are the source of truth in this
 * feature, and every number below is derived from them.
 */
interface ReviewSummary {
  id: string;
  quiz_title: string | null;
  created_at: string;
  score_correct: number | null;
  score_total: number | null;
  questionCount: number;
  diagnosedCount: number;
  failedCount: number;
  outstandingCount: number;
}

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
  const [stage, setStage] = useState<'list' | 'input' | 'confirm' | 'results'>('list');
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Fetch only — the caller decides what to do with the rows. */
  const fetchItems = useCallback(async (id: string): Promise<QuizReviewItem[] | null> => {
    const { data, error: err } = await supabase
      .from('quiz_review_items').select('*').eq('review_id', id).order('position');
    if (err) { setError(`Could not load the quiz: ${err.message}`); return null; }
    return (data ?? []) as QuizReviewItem[];
  }, []);

  /**
   * Without this the feature was write-only. The page always mounted on the
   * paste form and nothing ever SELECTed `quiz_reviews`, so navigating away
   * put every parsed quiz and every finished diagnosis permanently out of
   * reach — including the per-item Retry that the design names as the whole
   * mitigation for browser-side fan-out ("closing the tab mid-fan-out leaves
   * some items undiagnosed — visible as a per-item state with a Retry").
   * You could not get back to the Retry.
   *
   * `status` is never selected; see ReviewSummary.
   */
  const loadReviews = useCallback(async () => {
    setListLoading(true);
    const { data, error: err } = await supabase
      .from('quiz_reviews')
      .select('id, quiz_title, created_at, score_correct, score_total')
      .eq('lecture_id', lectureId)
      .order('created_at', { ascending: false });
    if (err) {
      setError(`Could not load your earlier quiz reviews: ${err.message}`);
      setListLoading(false);
      return;
    }

    const rows = (data ?? []) as Omit<ReviewSummary, 'questionCount' | 'diagnosedCount' | 'failedCount' | 'outstandingCount'>[];
    if (rows.length === 0) {
      setReviews([]);
      setListLoading(false);
      // Nothing to choose between — go straight to the paste form rather than
      // showing an empty list. Only ever from the list itself.
      setStage((s) => (s === 'list' ? 'input' : s));
      return;
    }

    const { data: itemRows, error: itemErr } = await supabase
      .from('quiz_review_items')
      .select('review_id, is_correct, diagnosis_status')
      .in('review_id', rows.map((r) => r.id));
    if (itemErr) {
      // The reviews exist but their counts don't. Showing them with silently
      // zeroed counts would misreport finished work as undiagnosed.
      setError(`Could not read the state of your earlier quiz reviews: ${itemErr.message}`);
      setListLoading(false);
      return;
    }

    const counted = (itemRows ?? []) as { review_id: string; is_correct: boolean; diagnosis_status: string }[];
    setReviews(rows.map((r) => {
      const mine = counted.filter((i) => i.review_id === r.id);
      return {
        ...r,
        questionCount: mine.length,
        diagnosedCount: mine.filter((i) => i.diagnosis_status === 'completed').length,
        failedCount: mine.filter((i) => i.diagnosis_status === 'failed').length,
        // Misses that never got a verdict — the interrupted-fan-out case this
        // listing exists to make reachable again.
        outstandingCount: mine.filter(
          (i) => !i.is_correct && (i.diagnosis_status === 'pending' || i.diagnosis_status === 'diagnosing'),
        ).length,
      };
    }));
    setListLoading(false);
  }, [lectureId]);

  useEffect(() => { void loadReviews(); }, [loadReviews]);

  const openReview = async (r: ReviewSummary) => {
    setBusy(true); setError(null);
    try {
      const loaded = await fetchItems(r.id);
      if (loaded === null) return; // fetchItems already recorded the honest error.
      if (loaded.length === 0) {
        setError('That quiz review has no questions in it. Start a new one below.');
        return;
      }
      setReviewId(r.id);
      setItems(loaded);
      // `unreadable` is never persisted — it described one parse, not the review.
      setUnreadable([]);
      setReportedScore({ correct: r.score_correct, total: r.score_total });
      // Items decide, not the review's status column: anything already
      // diagnosed means there are results worth showing.
      setStage(loaded.some((i) => i.diagnosis !== null) ? 'results' : 'confirm');
    } finally {
      setBusy(false);
    }
  };

  const backToList = () => {
    setError(null);
    setReviewId(null);
    setItems([]);
    setUnreadable([]);
    setReportedScore({ correct: null, total: null });
    setStage('list');
    void loadReviews();
  };

  const startNew = () => {
    setError(null);
    setReviewId(null);
    setItems([]);
    setUnreadable([]);
    setReportedScore({ correct: null, total: null });
    setStage('input');
  };

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

      const loaded = await fetchItems(data.reviewId);
      if (loaded === null) return; // fetchItems already recorded the honest error.

      // parse-quiz rolls its own review back rather than leaving a
      // question-less one behind, so an empty read here means the rows exist
      // and we could not see them. An empty confirm table with a disabled
      // button would present that as "your quiz had nothing in it", which is
      // the opposite of what happened.
      if (loaded.length === 0) {
        setError(
          'Your quiz was parsed, but its questions could not be read back. Nothing has been lost — ' +
          'reload this page and open the review from the list.',
        );
        return;
      }

      setReviewId(data.reviewId);
      setItems(loaded);
      setUnreadable(data.unreadable ?? []);
      setReportedScore({ correct: data.scoreCorrect ?? null, total: data.scoreTotal ?? null });

      // Every item parsed as correct: there is nothing to diagnose. Close the
      // review out now rather than leaving it stuck in 'awaiting_confirmation'
      // forever — ParsedQuizTable's Diagnose button is disabled at missCount 0,
      // so nothing else would ever move it forward. The student still lands on
      // the confirm table below (not a dead end): a wrongly-marked-correct row
      // is exactly the case where they'd want to flip it and diagnose it.
      if (loaded.every((i) => i.is_correct)) {
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

    const reloaded = await fetchItems(reviewId);
    // The fan-out is the authority on what failed, not the reload.
    // diagnose-miss only writes 'failed' on the paths that reach its own
    // fail(); every 4xx, the pre-auth 500, a timeout, a CORS failure or a
    // dropped connection leaves the row at 'diagnosing' or 'pending'. Taking
    // the DB at its word there put a permanent spinner (or nothing at all)
    // under a banner telling the student to retry it.
    if (reloaded !== null) setItems(reconcileAfterRun(reloaded, result));
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
  // what onProgress just patched into local state optimistically.
  // runDiagnosis's own reload after the fan-out completes is the only one
  // worth doing.

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

  const summaryLine = (r: ReviewSummary) => {
    const parts = [`${r.questionCount} question${r.questionCount === 1 ? '' : 's'}`];
    parts.push(`${r.diagnosedCount} diagnosed`);
    if (r.failedCount > 0) parts.push(`${r.failedCount} failed`);
    if (r.outstandingCount > 0) parts.push(`${r.outstandingCount} not diagnosed yet`);
    return parts.join(' · ');
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => navigate('lecture', lectureId)}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Back to the lecture
        </button>
        {stage !== 'list' && (
          <button type="button" onClick={backToList} disabled={busy}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 disabled:opacity-50">
            <ClipboardList className="w-4 h-4" /> Your quiz reviews
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {stage === 'list' && (
        <div className="bg-white rounded-2xl shadow-md p-8">
          <h2 className="text-xl font-semibold mb-2">Quiz reviews for this lecture</h2>
          <p className="text-gray-600 mb-6">
            Open one to read its diagnoses, or to retry anything that didn't finish.
          </p>

          {listLoading ? (
            <p className="flex items-center gap-2 text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your quiz reviews…
            </p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => void openReview(r)} disabled={busy}
                    className="w-full text-left rounded-xl border border-gray-200 p-4 hover:border-gray-400 disabled:opacity-50">
                    <p className="font-medium text-gray-900">{r.quiz_title ?? 'Untitled quiz'}</p>
                    <p className="mt-1 text-sm text-gray-600">{summaryLine(r)}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button type="button" onClick={startNew} disabled={busy}
            className="mt-6 inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            <Plus className="w-4 h-4" /> Diagnose another quiz
          </button>
        </div>
      )}

      {stage === 'input' && <QuizPasteForm onSubmit={handleParse} busy={busy} />}

      {stage === 'confirm' && (
        <>
          {/*
            Gated on !error. "You're done, no action needed" printed directly
            above a red failure box is the success-above-failure pattern this
            whole branch exists to eliminate.
          */}
          {!error && items.length > 0 && misses.length === 0 && (
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
