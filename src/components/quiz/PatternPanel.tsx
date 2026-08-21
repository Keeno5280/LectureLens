import { Info, TrendingUp } from 'lucide-react';
import { describePattern } from '../../lib/quiz/patterns';
import type { TagCount } from '../../lib/quiz/patterns';

interface Props {
  counts: TagCount[];
  /**
   * The number of diagnosed items (misses) `counts` was built from — NOT
   * the sum of every `TagCount.count`. One miss can carry more than one
   * confusion tag, so that sum overcounts; this is the true denominator for
   * every "X of Y" below, and the same number `describePattern` uses to
   * decide the verdict. See `TagSummary` in `lib/quiz/patterns.ts`.
   */
  diagnosedItemCount: number;
  quizCount: number;
  classScoped: boolean;
  /**
   * The class's display name (e.g. "AI Ethics") — NOT a CSS class list. Named
   * to match the data it stands for: `lectures.class_id -> classes.name`.
   */
  className: string | null;
}

/**
 * The layer `review.md` calls "worth more than any single answer": what a
 * student's misses have in common, aggregated across every diagnosed quiz in
 * THIS class (never across classes — see QuizReviewPage's query).
 *
 * Presentational only. `describePattern` — not this component — decides
 * whether the count breakdown below rises to a "pattern"; this just renders
 * whatever verdict it returns, honestly, including the refusal below 3
 * diagnosed quizzes. Do not soften that refusal here.
 */
export default function PatternPanel({ counts, diagnosedItemCount, quizCount, classScoped, className }: Props) {
  // Nothing diagnosed yet — nothing to show. A panel that renders an empty
  // shell above the diagnosis cards reads as broken, not as "not yet".
  if (counts.length === 0) return null;

  const { dominant, isPattern, note } = describePattern({ counts, diagnosedItemCount }, quizCount);

  return (
    <div className="bg-white rounded-2xl shadow-md p-8 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">What your misses have in common</h2>
        <p className="mt-1 text-sm text-gray-600">
          {classScoped
            ? `Counting every diagnosed miss across ${quizCount} quiz${quizCount === 1 ? '' : 'zes'} in ${className ?? 'this class'}.`
            : "This lecture isn't assigned to a class, so this is this quiz alone — not compared against any others."}
        </p>
      </div>

      <ul className="space-y-1.5">
        {counts.map((c) => (
          <li key={c.tag} className="flex items-center justify-between text-sm">
            <span className="text-gray-700">{c.tag}</span>
            <span className="text-gray-500">
              {c.count} of {diagnosedItemCount}
            </span>
          </li>
        ))}
      </ul>

      {dominant && (
        <p className="text-sm text-gray-700">
          Most common: <strong>{dominant.tag}</strong> ({dominant.count} of {diagnosedItemCount}).
        </p>
      )}

      <div
        className={
          isPattern
            ? 'flex items-start gap-2 rounded-lg border border-blue-300 bg-blue-50 p-4 text-sm text-blue-900'
            : 'flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700'
        }
      >
        {isPattern ? (
          <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
        ) : (
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
        )}
        <span>{note}</span>
      </div>
    </div>
  );
}
