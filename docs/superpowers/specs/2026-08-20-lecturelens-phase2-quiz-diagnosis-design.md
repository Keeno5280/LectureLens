# LectureLens — Phase 2 Design: Quiz-Miss Diagnosis

**Date:** 2026-08-20
**Status:** Awaiting review
**Phase:** 2 of 3 — *Work → Feature → Multi-user*

---

## Context

Phase 1 made LectureLens work: two Claude-backed Edge Functions plus browser Whisper replaced a
dead n8n/Gemini pipeline that fabricated study material while reporting success. That work is
deployed and verified in a real browser.

Phase 1 generates study material **forward** — transcript in, summary and flashcards out.
Phase 2 runs **backward**: given a quiz question the student actually got wrong, explain *why*,
citing what the lecture said and naming the distinction they collapsed.

This is the differentiator. Phase 1 exists to make it possible: `lectures.claims` and
`lectures.distinctions` are already populated by every analysis and have no consumer yet.

- `claims`: `{statement, quote, emphasis, contested}` — `quote` is verbatim, so a diagnosis can cite
- `distinctions`: `{this_, not_that, why_confusable}` — a wrong answer is usually a collapsed distinction

The worked example this is designed from is `~/hcli-school/weeks/week-01/review.md`, produced by
hand under `~/hcli-school/CLAUDE.md`. That file is the quality bar; this design turns it into
software.

### What exists today, and why it isn't the answer

`quiz_questions` and `quiz_attempts` exist from the old slides system. They are a scorekeeper, not
a diagnostician:

- `quiz_questions` holds *generated* questions with a `correct_answer` and an `explanation`. It has
  no concept of a student's answer.
- `quiz_attempts` holds a score and an untyped `answers jsonb` blob.
- Neither has a "why was this wrong" column, and nothing anywhere records a confusion.

Phase 2 does not extend them. Bending a table built for app-generated slide quizzes into one that
holds an externally-taken graded quiz would tangle this feature with a subsystem it has nothing to
do with, and would leave `is_correct` inferred rather than stored.

---

## Decisions made during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Quiz source | **The student brings the real graded quiz** | Matches the worked example; diagnoses the questions that actually cost points, not ours |
| Ingest | **Pasted text OR a screenshot, same flow** | Some LMSes forbid copying; a screenshot is often the only artifact |
| Diagnosis depth | **Full `review.md` depth** | The depth *is* the product; the four-field version is a better error message, not a feature |
| Cross-quiz patterns | **Later phase — but store the data now** | `review.md` itself refuses to call a pattern at n=1. Tags are recorded from day one so the later pass needs no migration |
| Pipeline shape | **Parse → confirm → per-miss fan-out** | See below |

---

## The two constraints that drive the shape

**1. Output length, not input length, is the ceiling.**
Phase 1 measured a 90-minute lecture at 65s against a ~150s gateway limit, and established that
time scales with output. A full-depth diagnosis runs ~1,500–2,500 output tokens *per miss*. Four
misses in one call sits at the `max_tokens: 16000` ceiling, and **a truncated response still parses
into a syntactically valid object** — the exact failure that silently killed the old pipeline
(`claude.ts` checks `stop_reason` before `parsed_output` for precisely this reason).

One Claude call per miss keeps every response an order of magnitude clear of the ceiling,
regardless of quiz or lecture length.

**2. A misparse is invisible and poisons everything downstream.**
If the model reads a screenshot and concludes the student answered *True* when they answered
*False*, it will produce a fluent, correctly-cited, completely wrong diagnosis of a mistake they
never made. No amount of prompt quality prevents this, and nothing downstream can detect it.

Therefore parsing is a separate, deliberately dumb pass whose output the student confirms before
any diagnosis runs.

---

## Architecture

```
LectureDetailPage → "Diagnose a quiz" → QuizReviewPage(lectureId)

  ┌─ STEP 1: paste text or drop a screenshot
  │
  │   supabase.functions.invoke('parse-quiz', { lectureId, text | imageBase64 })
  │     → JWT → lecture ownership → service-role
  │     → Claude: structural extraction ONLY (~1k out)
  │     → INSERT quiz_reviews + quiz_review_items
  │     → status 'awaiting_confirmation'
  │
  ├─ STEP 2: the confirm gate                        ← the honesty step
  │
  │   Parsed quiz rendered as an editable table: every question, its options,
  │   WHICH ANSWER WAS THE STUDENT'S, which was correct, ✓/✗. Anything the
  │   parse reported as `unreadable` is highlighted. The student corrects it.
  │   Nothing is diagnosed until they press Diagnose.
  │
  └─ STEP 3: fan-out — one invoke per MISSED question (browser-side, ≤3 concurrent)

      supabase.functions.invoke('diagnose-miss', { itemId })   ×N
        → JWT → item → review → lecture ownership → service-role
        → loads that lecture's claims + distinctions + transcript
        → Claude: full review.md-depth diagnosis (~2k out)
        → verify citations against source
        → UPDATE quiz_review_items.diagnosis, confusion_tags, lecture_coverage
```

### Why two functions, not one with an `action` param

The parse and the diagnosis are separated by a human confirmation, so they are two invocations
regardless. They also take different inputs and authorize against different objects (`parse-quiz`
against a lecture; `diagnose-miss` against an item). One function per job matches the existing
convention (`analyze-lecture`, `ai-tutor`).

### Why the browser fans out, not the Edge Function

An internal `Promise.all` would be one round trip, but one point of failure and one long request
against the ~150s gateway. Browser-side fan-out gives per-question progress, per-question retry,
and per-question failure that does not touch its neighbours. Each invocation is small and
independent.

Concurrency is capped at 3 so a ten-miss quiz does not hit the Anthropic rate limit.

**Accepted cost:** closing the tab mid-fan-out leaves some items undiagnosed. This is visible as a
per-item state with a Retry, exactly as Phase 1 surfaces a failed analysis. It is never hidden.

### Screenshots are never stored

`imageBase64` goes browser → Claude and is discarded. Only the parsed result is persisted. The
handover records 382MB of orphaned storage objects against a 1GB free tier; there is no reason to
add to it for an image read once. Pasted *text* is retained on `quiz_reviews.raw_input` — it is
small, and without it a re-parse means retyping the quiz.

### Parse is deliberately dumb

The parse prompt performs structural extraction only and is explicitly forbidden from reasoning
about whether an answer is correct, or from "fixing" an answer to what the student probably meant.
Keeping it stupid is what makes the confirm gate cheap to eyeball, and prevents it from quietly
laundering a guess into a fact.

---

## Data model

Two new tables. RLS enabled and owner-scoped from the start — this repo's history contains six
separate `disable_rls_for_testing` migrations, and these tables will not join them.

```sql
CREATE TABLE quiz_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id       uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('text','image')),
  raw_input        text,                    -- the paste; NULL for screenshots
  quiz_title       text,
  score_correct    integer,
  score_total      integer,
  status           text NOT NULL DEFAULT 'awaiting_confirmation'
                     CHECK (status IN ('awaiting_confirmation','diagnosing','completed','failed')),
  processing_error text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE quiz_review_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES quiz_reviews(id) ON DELETE CASCADE,
  position         integer NOT NULL,
  question_text    text NOT NULL,
  question_type    text NOT NULL CHECK (question_type IN ('multiple_choice','true_false','short_answer')),
  options          jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_answer   text,
  correct_answer   text,
  is_correct       boolean NOT NULL,
  diagnosis        jsonb,                   -- NULL until diagnosed
  confusion_tags   text[] NOT NULL DEFAULT '{}',
  lecture_coverage text CHECK (lecture_coverage IN ('covered','partial','not-in-lecture')),
  diagnosis_status text NOT NULL DEFAULT 'pending'
                     CHECK (diagnosis_status IN ('pending','diagnosing','completed','failed','not-applicable')),
  diagnosis_error  text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (review_id, position)
);
```

Indexes: `quiz_review_items(review_id)`, `quiz_reviews(user_id, created_at DESC)`, and a **GIN index
on `confusion_tags`** for the later pattern pass.

### Why these are columns and not jsonb fields

`confusion_tags` and `lecture_coverage` are lifted out of the `diagnosis` blob deliberately. The
agreed sequencing is "patterns later, store the data now" — as columns, the later pattern query is a
`GROUP BY` over an index rather than a jsonb traversal, and needs no migration.

### Why `'not-applicable'` is a distinct status

Questions the student got right are never diagnosed, and get `diagnosis_status = 'not-applicable'`.
Keeping that separate from `'pending'` means "nothing to diagnose here" and "not diagnosed yet" can
never render as the same thing.

### When `quiz_reviews.status` moves

- `'awaiting_confirmation'` on insert, after a successful parse.
- `'diagnosing'` when the student presses Diagnose.
- `'completed'` once **every** missed item is terminal (`completed` or `failed`) — including the
  case where some failed. The count of failures is surfaced in the UI (see *Failure handling* #6);
  it is not encoded as a review-level `'failed'`, because a review with four good diagnoses and one
  failure is not a failed review.
- `'failed'` only when the review as a whole could not proceed — for example the parent lecture was
  deleted mid-run.

**A quiz with no misses** parses normally, every item lands on `'not-applicable'`, and the review
goes straight to `'completed'` with nothing to diagnose. The UI says so rather than showing an
empty diagnosis list.

### `score_correct` / `score_total` are what the quiz *reported*

They are stored as parsed, and may legitimately disagree with the items — a results page often
shows "3 / 4" while listing fewer questions than that in full. The worked example relies on exactly
this: its Q1–Q3 answers were *inferred* from the reported 3/4 score. The item rows, not the reported
score, are the source of truth for what gets diagnosed; a mismatch between the two is shown at the
confirm gate rather than silently reconciled.

---

## The diagnosis schema

Added to `supabase/functions/_shared/schemas.ts`, mirroring `review.md`'s sections.

```ts
export const CONFUSION_TAGS = [
  'absolutizing-word',        // "enough" / "only" / "never" was the thing being graded
  'collapsed-distinction',    // two deliberately-separated concepts treated as one
  'answered-tone-not-claim',  // agreed with the sentiment instead of evaluating the assertion
  'wrong-category',           // right kind of answer, wrong axis (books vs. acts)
  'recall-gap',               // simply did not retain it
  'judgment-under-tension',   // had to hold two true things and spot which was tested
  'misread-question',         // missed a NOT / EXCEPT / "which is false"
  'careless',                 // no conceptual issue
] as const

export const DiagnosisSchema = z.object({
  lecture_coverage: z.enum(['covered','partial','not-in-lecture']),
  correct_answer:   z.string(),
  why_correct:      z.string(),
  citations:        z.array(z.object({ quote: z.string(), supports: z.string() })),
  where_it_went_sideways: z.array(z.object({
    confusion:   z.string(),
    explanation: z.string(),
  })).min(1),
  collapsed_distinction: z.object({ this_: z.string(), not_that: z.string() }).nullable(),
  dont_overcorrect:       z.string(),
  what_this_miss_was_not: z.string(),
  remember_this:          z.string(),
  why_it_matters:         z.string(),
  confusion_tags:         z.array(z.enum(CONFUSION_TAGS)).min(1),
})
```

And the parse schema:

```ts
export const ParsedQuizSchema = z.object({
  quiz_title:    z.string().nullable(),
  score_correct: z.number().int().nullable(),
  score_total:   z.number().int().nullable(),
  items: z.array(z.object({
    position:       z.number().int().min(1),
    question_text:  z.string(),
    question_type:  z.enum(['multiple_choice','true_false','short_answer']),
    options:        z.array(z.string()),      // [] for true_false / short_answer;
                                             // the confirm table renders True/False
                                             // from question_type, not from options
    student_answer: z.string().nullable(),
    correct_answer: z.string().nullable(),
    is_correct:     z.boolean(),
  })),
  unreadable: z.array(z.string()),            // what it could not make out
})
```

### The four load-bearing choices

**`confusion_tags` is a closed enum.** Free-text tags do not cluster, and un-clusterable tags make
the later pattern phase worthless. Every value listed is a confusion `review.md` actually names —
`absolutizing-word` is its Q1/Q3/Q4 finding; `answered-tone-not-claim` and
`judgment-under-tension` are its Q4 diagnosis.

**Citations are verified in code, not trusted.** The prompt requires quotes to come verbatim from
`claims[].quote`. The function then checks it: every returned `quote` must appear as a substring of
the lecture transcript or of a stored claim quote (compared after whitespace normalization). Quotes
that fail are dropped and the item is flagged. A fabricated quote attributed to the student's
lecturer is the worst thing this feature could produce, and it is the one failure a prompt
instruction cannot prevent on its own.

Note the asymmetry between lecture types: **`slides` lectures have no transcript** — Phase 1 sends
the PDF to Claude as a document block and `lectures.transcript` stays null. For those, the only
verification corpus is `claims[].quote`, which is narrower than for audio/video. That is a real
reduction in verification strength, not an oversight; it is why the check drops unverifiable quotes
rather than rejecting the whole diagnosis, which would make slides lectures undiagnosable.

**`lecture_coverage: 'not-in-lecture'` forces `citations: []`,** and the UI says so plainly. This is
`review.md`'s `[UNVERIFIED]` marker made structural. When the lecture did not cover the question,
the honest output is to say that, not to manufacture grounding.

**`what_this_miss_was_not` is an anti-inflation field.** `~/hcli-school/CLAUDE.md` requires: *"If he
missed a question because he didn't read carefully, say that. Don't manufacture a deep theological
reason for a careless miss."* Forcing the model to name what the miss was **not** makes over-reading
a careless slip harder. It is legitimate for this field to say the miss *was* careless.

---

## Prompts

Two new exports in `_shared/prompts.ts`.

**`QUIZ_PARSER_SYSTEM`** — structural extraction only. Must not evaluate correctness, must not
normalize or "correct" a student's answer, must report anything ambiguous in `unreadable` rather
than guessing. For screenshots: if it cannot tell which option was selected, that is `unreadable`,
not a coin flip.

**`MISS_DIAGNOSTICIAN_SYSTEM`** — carries `LECTURE_ANALYST_SYSTEM`'s posture into the backward
direction:

- Cite the lecture in its own words. Quotes are verbatim or they are omitted.
- Name the specific confusion. "Incorrect" is not a diagnosis.
- Teach the reasoning chain, not the answer key — the student has a final coming.
- Say when the lecture marked the point `contested`, and which position the course teaches.
- Do not inflate. A careless miss is a careless miss.
- If the lecture does not cover the question, set `lecture_coverage: 'not-in-lecture'`, return no
  citations, and say so.

---

## Frontend

```
src/pages/QuizReviewPage.tsx             orchestrates the three steps
src/components/quiz/QuizPasteForm.tsx    textarea + screenshot drop
src/components/quiz/ParsedQuizTable.tsx  the confirm gate, editable
src/components/quiz/DiagnosisCard.tsx    renders one diagnosis
src/lib/quiz/diagnose.ts                 fan-out: concurrency cap 3, per-item state
```

One new `Page` type, `'quiz-review'`, carrying `lectureId`. The app's router is a custom-event
system with a single id slot; the page handles listing prior reviews, starting a new one, and
viewing one through internal state rather than adding router surface.

`src/lib/quiz/diagnose.ts` is a pure module with the invoker injected. The handover records "no
jsdom → UI honesty branches lack automated coverage"; this puts the logic that decides
success-versus-failure somewhere vitest can reach without a DOM.

Entry point is a **"Diagnose a quiz"** button on `LectureDetailPage`, shown only when the lecture's
analysis is `completed`. Diagnosing against a lecture with no `claims` would produce exactly the
ungrounded output this feature exists to prevent.

---

## Failure handling

Phase 1's rules, applied:

1. **Every `{data, error}` is checked**, `functions.invoke` included. That bug shipped seven times
   in this codebase. It is not shipping an eighth.
2. **`stop_reason === 'max_tokens'` is checked before `parsed_output`** in both new Claude calls,
   matching `analyzeLecture`.
3. **Auth order is JWT → ownership → service-role** in both functions. `diagnose-miss` walks
   item → review → lecture and requires `review.user_id === callerId`. `itemId` arrives on the
   request body and is never trusted; two IDORs in this repo came from exactly that.
4. **A failed parse writes nothing** and shows the error. A half-written review is worse than none.
5. **Per-item failure** shows failed + a readable reason + Retry.
6. **Partial completion is reported honestly.** When four of five diagnose, the header reads
   *"4 of 5 diagnosed · 1 failed"*. Never a success state with a failure underneath it.
7. **Screenshots are capped client-side at 5MB** with a clear message, rather than an unexplained
   400 from the API.
8. **Both functions get `config.toml` entries** with `verify_jwt = true` and
   `import_map = "./functions/deno.json"`. Without the import map Deno cannot resolve `zod` and the
   function fails at boot — Supabase does not auto-discover it.

---

## Testing

TDD throughout. `_shared` modules stay free of Deno globals and take injected dependencies via the
existing `ClaudeLike` structural type, so they run under vitest and `npm run typecheck:shared`.

| Area | Cases |
|---|---|
| `schemas.ts` | Parse and diagnosis validation; rejection of an out-of-enum confusion tag; `min(1)` on `where_it_went_sideways` and `confusion_tags` |
| `quiz.ts` | Parse input built for text vs. image; diagnosis context assembled from claims + distinctions + transcript |
| Citation verifier | Verbatim quote passes; whitespace-variant passes; **fabricated quote is dropped and flagged** |
| `auth` | Foreign `itemId` → 403; missing/expired JWT → 401; unknown item → 404 |
| `diagnose.ts` | Concurrency cap holds; partial failure leaves neighbours intact; never reports success on failure |

**Gates:** `npm test` green. `npm run typecheck:shared` at 0 errors.
`npm run typecheck` must not exceed the 12-error pre-existing baseline.

**Manual browser verification is required, not optional.** `curl` does not test CORS — a perfect
backend can still be unreachable from the browser, which is how this was learned the first time.

### The Phase 2 honesty test

Phase 1's acceptance test was a 14-second clip containing no lecture, against which Claude returned
empty arrays. Phase 2's equivalent:

> **Paste a quiz whose questions the lecture never covered.** Every diagnosis must come back
> `lecture_coverage: 'not-in-lecture'`, with **zero citations**, and say so plainly. If it instead
> produces a confident, well-cited explanation, the feature has failed — no matter how good the
> prose is.

Second: **a screenshot in which the selected answer is genuinely ambiguous must surface in
`unreadable`** at the confirm gate rather than being guessed.

---

## Known limitation, stated rather than absorbed

This design assumes the lecture stored in LectureLens is the material the quiz was drawn from. In
the worked example it was not — the upload was a 14-second Blackboard screen-reader clip and the
real teaching never arrived, which is why `review.md` traces everything to Scripture and marks
lecture claims `[UNVERIFIED]`.

`lecture_coverage` makes that condition visible per question instead of letting it corrupt the
output, but it cannot fix it. This is the expected failure mode in the wild, not a bug. Diagnosis
quality is bounded by what was actually uploaded.

---

## Out of scope for Phase 2

- **Cross-quiz pattern detection.** Deferred by decision; `confusion_tags` and
  `lecture_coverage` are recorded from day one so the later pass needs no migration.
- **In-app quiz generation and administration.** Phase 2 diagnoses quizzes taken elsewhere.
- **Compressed treatment of correct answers.** `review.md` includes one; Phase 2 diagnoses misses.
- **The cumulative glossary / source index** from the HCLI workflow.
- Everything in the handover's *Known issues / Phase 3* table, which stays Phase 3.
