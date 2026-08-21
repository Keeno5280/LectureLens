import type { FanOutResult } from './diagnose';
import type { QuizReviewItem } from './types';

/**
 * Re-applies the fan-out's failure verdict onto the rows reloaded after a run.
 *
 * `diagnoseAll` is the authority on what failed. The database is not.
 *
 * `diagnose-miss` writes `diagnosis_status: 'failed'` from its own `fail()`
 * helper — but only on the paths that reach it. Every other way an invocation
 * can fail leaves the row exactly as it was: the pre-auth catch's 500, both
 * 400s, every 401/403/404, a gateway timeout, a CORS failure, a dropped
 * connection. In all of those the row still reads `'diagnosing'` (a spinner
 * that never resolves, with no Retry offered) or `'pending'`, while the page
 * banner says "1 failed. Retry them below." The student is told to retry
 * something that isn't on screen.
 *
 * So the reload does not get the last word. What the fan-out actually observed
 * is re-applied on top of it.
 *
 * Rows the DB already reports as `'failed'` keep their own error message:
 * that one came from the function itself and says what went wrong server-side,
 * which is more specific than "Edge Function returned a non-2xx status code".
 * It is only filled in from the fan-out when the DB has nothing to say.
 *
 * Pure, and separated from the page, because this is precisely the
 * success-versus-failure logic this codebase has historically got wrong in
 * places no test could reach.
 */
export function reconcileAfterRun(
  loaded: QuizReviewItem[],
  result: FanOutResult,
): QuizReviewItem[] {
  if (result.failed.length === 0) return loaded;

  const failures = new Map(result.failed.map((f) => [f.itemId, f.error]));

  return loaded.map((item) => {
    const fanOutError = failures.get(item.id);
    if (fanOutError === undefined) return item;

    if (item.diagnosis_status === 'failed') {
      return item.diagnosis_error ? item : { ...item, diagnosis_error: fanOutError };
    }

    return { ...item, diagnosis_status: 'failed' as const, diagnosis_error: fanOutError };
  });
}
