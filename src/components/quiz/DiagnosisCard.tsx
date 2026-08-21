import { AlertTriangle, Clock, Quote, RefreshCw, Loader2 } from 'lucide-react';
import type { QuizReviewItem } from '../../lib/quiz/types';

interface Props {
  item: QuizReviewItem;
  onRetry: (itemId: string) => void;
  busy: boolean;
}

/** Whitespace and case do not make two answer strings disagree. Different words do. */
const sameAnswer = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

export default function DiagnosisCard({ item, onRetry, busy }: Props) {
  // Queued, not broken. The fan-out runs three at a time, so on a five-miss
  // quiz two items sit here from the moment the results view opens. Without
  // this branch they rendered as literally nothing — an empty gap under a
  // header that says "0 of 5 diagnosed", which reads as work that was lost.
  if (item.diagnosis_status === 'pending') {
    return (
      <div className="bg-white rounded-2xl shadow-md p-8">
        <p className="flex items-center gap-2 text-gray-600">
          <Clock className="w-4 h-4" />
          Question {item.position} is queued — three are diagnosed at a time.
        </p>
      </div>
    );
  }

  if (item.diagnosis_status === 'diagnosing') {
    return (
      <div className="bg-white rounded-2xl shadow-md p-8">
        <p className="flex items-center gap-2 text-gray-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Working out why question {item.position} was wrong…
        </p>
      </div>
    );
  }

  if (item.diagnosis_status === 'failed') {
    return (
      <div className="bg-white rounded-2xl shadow-md p-8 border border-red-200">
        <h3 className="font-semibold text-gray-900">Question {item.position} — diagnosis failed</h3>
        <p className="mt-2 text-sm text-red-700">{item.diagnosis_error ?? 'Unknown error.'}</p>
        <button type="button" onClick={() => onRetry(item.id)} disabled={busy}
          className="mt-4 inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
          <RefreshCw className="w-4 h-4" /> Retry this one
        </button>
      </div>
    );
  }

  // The student marked this one correct at the confirm gate. Nothing to
  // diagnose, and nothing to show.
  if (item.diagnosis_status === 'not-applicable') return null;

  const d = item.diagnosis;

  // 'completed' with no payload yet. onProgress patches the status locally the
  // instant the invocation returns, but the diagnosis itself only lands with
  // the reload after the whole fan-out finishes — so every card passes through
  // this state. Returning null blanked a card that had just been spinning,
  // which looks exactly like the work being thrown away.
  if (!d) {
    return (
      <div className="bg-white rounded-2xl shadow-md p-8">
        <p className="flex items-center gap-2 text-gray-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Question {item.position} is diagnosed — fetching it…
        </p>
      </div>
    );
  }

  // What the quiz PRINTED and the student confirmed at the gate, not what the
  // diagnostician decided the answer key should have said. QUIZ_PARSER_SYSTEM
  // is explicitly forbidden from overruling the answer key; showing the
  // model's version here would quietly do it anyway, in green.
  const confirmedAnswer = item.correct_answer?.trim() ? item.correct_answer : null;
  const answerDisagreement =
    confirmedAnswer !== null && !sameAnswer(confirmedAnswer, d.correct_answer);

  return (
    <div className="bg-white rounded-2xl shadow-md p-8 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900">
          Q{item.position}. {item.question_text}
        </h3>
        <p className="mt-2 text-sm">
          <span className="text-red-700 font-medium">You answered: {item.student_answer ?? '—'}</span>
          <span className="mx-2 text-gray-400">·</span>
          <span className="text-green-700 font-medium">Correct: {confirmedAnswer ?? d.correct_answer}</span>
        </p>
        {confirmedAnswer === null && (
          <p className="mt-1 text-xs text-gray-500">
            Your quiz didn't record a correct answer for this one, so that's the diagnosis's own
            reading of it. Check it against your answer key.
          </p>
        )}
      </div>

      {answerDisagreement && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-medium text-amber-900">
            <AlertTriangle className="w-4 h-4" /> This disagrees with your answer key
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Your quiz recorded <strong>{confirmedAnswer}</strong> as correct — that's what's shown
            above. The explanation below was written believing the answer was{' '}
            <strong>{d.correct_answer}</strong>. Your quiz wins; read the rest with that in mind.
          </p>
        </div>
      )}

      {d.lecture_coverage === 'not-in-lecture' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-medium text-amber-900">
            <AlertTriangle className="w-4 h-4" /> Your lecture did not cover this
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Nothing below is quoted from your lecture, because there was nothing to quote. Check it
            against your course material before you rely on it.
          </p>
        </div>
      )}

      <section>
        <h4 className="font-semibold text-gray-900 mb-2">Why that's the answer</h4>
        <p className="text-gray-700 whitespace-pre-line leading-relaxed">{d.why_correct}</p>
      </section>

      {/*
        The only signal anyone ever gets that the model made quotes up. A
        'covered' diagnosis whose every citation was fabricated and verified
        away renders exactly like one the model simply chose not to cite —
        confident prose, no quotes, nothing amiss. Say it out loud.
      */}
      {item.dropped_citations > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-medium text-amber-900">
            <AlertTriangle className="w-4 h-4" />
            {item.dropped_citations === 1
              ? '1 quote was removed'
              : `${item.dropped_citations} quotes were removed`}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {item.dropped_citations === 1 ? 'It' : 'They'} couldn't be matched to anything in your
            lecture, so {item.dropped_citations === 1 ? "it isn't" : "they aren't"} shown. Weigh the
            explanation below accordingly — check it against your course material before relying on it.
          </p>
        </div>
      )}

      {d.citations.length > 0 && (
        <section>
          <h4 className="font-semibold text-gray-900 mb-2">What the lecture actually said</h4>
          <div className="space-y-3">
            {d.citations.map((c, i) => (
              <blockquote key={i} className="border-l-4 border-blue-300 bg-blue-50/50 pl-4 py-2">
                <p className="flex gap-2 text-gray-800 italic">
                  <Quote className="w-4 h-4 shrink-0 mt-1 text-blue-400" />
                  <span>{c.quote}</span>
                </p>
                <p className="mt-1 text-sm text-gray-600">{c.supports}</p>
              </blockquote>
            ))}
          </div>
        </section>
      )}

      <section>
        <h4 className="font-semibold text-gray-900 mb-2">Where it went sideways</h4>
        <ol className="space-y-3 list-decimal pl-5">
          {d.where_it_went_sideways.map((w, i) => (
            <li key={i}>
              <p className="font-medium text-gray-900">{w.confusion}</p>
              <p className="text-gray-700">{w.explanation}</p>
            </li>
          ))}
        </ol>
      </section>

      {d.collapsed_distinction && (
        <section className="rounded-lg bg-gray-50 p-4">
          <h4 className="font-semibold text-gray-900 mb-1">The distinction that got collapsed</h4>
          <p className="text-gray-700">
            <strong>{d.collapsed_distinction.this_}</strong> is not{' '}
            <strong>{d.collapsed_distinction.not_that}</strong>.
          </p>
        </section>
      )}

      <section>
        <h4 className="font-semibold text-gray-900 mb-2">Don't overcorrect</h4>
        <p className="text-gray-700">{d.dont_overcorrect}</p>
      </section>

      <section>
        <h4 className="font-semibold text-gray-900 mb-2">What this miss was not</h4>
        <p className="text-gray-700">{d.what_this_miss_was_not}</p>
      </section>

      <section className="rounded-lg border-l-4 border-green-400 bg-green-50 p-4">
        <h4 className="font-semibold text-gray-900 mb-1">Remember this</h4>
        <p className="text-gray-800">{d.remember_this}</p>
      </section>

      <section>
        <h4 className="font-semibold text-gray-900 mb-2">Why this matters past the quiz</h4>
        <p className="text-gray-700 whitespace-pre-line">{d.why_it_matters}</p>
      </section>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
        {d.confusion_tags.map((t) => (
          <span key={t} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">{t}</span>
        ))}
      </div>
    </div>
  );
}
