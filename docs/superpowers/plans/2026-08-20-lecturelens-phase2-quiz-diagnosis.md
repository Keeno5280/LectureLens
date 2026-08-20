# LectureLens Phase 2 — Quiz-Miss Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a quiz question the student actually got wrong, explain why — citing what the lecture said, verbatim, and naming the distinction they collapsed.

**Architecture:** Three stages. `parse-quiz` turns a pasted quiz or screenshot into structured rows and stops. The student confirms the parse in an editable table. Then the browser fans out one `diagnose-miss` invocation per missed question (max 3 concurrent), each producing a full-depth diagnosis whose citations are verified in code against the lecture before they are stored.

**Tech Stack:** Deno Edge Functions, `@anthropic-ai/sdk` ^0.120.0 with `zodOutputFormat`, zod ^4.4.3, Postgres/Supabase, React 18 + Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-lecturelens-phase2-quiz-diagnosis-design.md` — read it before Task 1. The plan argues from the spec; where this plan is silent, the spec governs.

## Global Constraints

Every task's requirements implicitly include all of these. They are copied from the spec and from `HANDOVER.md`'s "Rules that WILL bite you".

- **Model is exactly `claude-opus-5`.** No date suffix. `max_tokens: 16000`. No `thinking` param, no assistant prefill — both return 400.
- **Check `stop_reason === 'max_tokens'` BEFORE reading `parsed_output`.** A truncated response still parses into a syntactically valid object.
- **supabase-js returns `{data, error}`; it does not throw.** `functions.invoke` too. Check every single one. This bug shipped seven times in this repo.
- **Never write a success message on a failed operation.** The whole Phase 1 branch exists to undo that.
- **Auth order is absolute:** identity from the caller's OWN JWT → ownership check → *then* service-role. Two IDORs came from breaking this.
- **`_shared` modules must stay free of Deno globals** (no `Deno.env`, no `Deno.serve`) so they run under vitest and `npm run typecheck:shared`. Pass environment values in as parameters, as `cors.ts` does.
- **`_shared` relative imports need explicit `.ts` extensions.** Bare specifiers must be in `supabase/functions/deno.json`. Supabase does not auto-discover it — each function needs `import_map` in `config.toml`.
- **Frontend cannot import from `supabase/functions/_shared/`.** `tsconfig.app.json` has `"include": ["src"]`. Frontend types are declared separately in `src/lib/quiz/types.ts`; this duplication is deliberate and preferable to crossing the Deno/browser boundary.
- **Never import `src/lib/transcribe/browser.ts` in a test.** Unrelated to this work, but it will wreck the test run if a new test file pulls it in transitively.
- **Gates:** `npm test` green; `npm run typecheck:shared` at 0 errors; `npm run typecheck` must not exceed its **12-error pre-existing baseline**.
- **CURL DOES NOT TEST CORS.** Anything touching an edge function is unverified until it runs in a real browser.
- **Deploy command:** `npx supabase functions deploy <name> --project-ref hkqoesqiallwqbvuqgpp --use-api`

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260820120000_quiz_diagnosis_tables.sql` | `quiz_reviews` + `quiz_review_items`, RLS, indexes |
| `supabase/functions/_shared/citations.ts` | Verify quoted citations against the real source |
| `supabase/functions/_shared/quiz.ts` | Build Claude inputs and run the parse + diagnosis calls |
| `supabase/functions/parse-quiz/index.ts` | Paste/screenshot → structured rows. No diagnosis |
| `supabase/functions/diagnose-miss/index.ts` | One missed question → one verified diagnosis |
| `src/lib/quiz/types.ts` | Frontend-side types (see Global Constraints) |
| `src/lib/quiz/diagnose.ts` | Concurrency-capped fan-out. Pure; invoker injected |
| `src/components/quiz/QuizPasteForm.tsx` | Textarea + screenshot drop |
| `src/components/quiz/ParsedQuizTable.tsx` | The confirm gate. Editable |
| `src/components/quiz/DiagnosisCard.tsx` | Renders one diagnosis |
| `src/pages/QuizReviewPage.tsx` | Orchestrates the three stages |

**Modified**

| Path | Change |
|---|---|
| `supabase/functions/_shared/schemas.ts` | Add `CONFUSION_TAGS`, `ParsedQuizSchema`, `DiagnosisSchema` |
| `supabase/functions/_shared/prompts.ts` | Add `QUIZ_PARSER_SYSTEM`, `MISS_DIAGNOSTICIAN_SYSTEM` |
| `supabase/functions/_shared/claude.ts` | Extract `runStructured`; reimplement `analyzeLecture` on it |
| `supabase/functions/_shared/auth.ts` | Add `authorizeQuizItemAccess` (item → review → lecture) |
| `supabase/config.toml` | Entries for both new functions |
| `src/App.tsx` | `'quiz-review'` page type + switch case |
| `src/pages/LectureDetailPage.tsx` | "Diagnose a quiz" entry button |

**Test files:** `citations.test.ts`, `quiz.test.ts`, `src/lib/quiz/diagnose.test.ts` created; `schemas.test.ts`, `auth.test.ts`, `claude.test.ts` extended.

---

## Task 1: Database tables

**Files:**
- Create: `supabase/migrations/20260820120000_quiz_diagnosis_tables.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `quiz_reviews` and `quiz_review_items` with the columns every later task reads and writes.

- [ ] **Step 1: Write the migration**

Reuses the existing `update_updated_at_column()` function defined in `20250101000000_create_lecturelens_schema.sql` — do not redefine it.

```sql
/*
  # Phase 2 — quiz-miss diagnosis tables

  `quiz_questions` / `quiz_attempts` (from the slides system) are a scorekeeper:
  quiz_questions has no concept of a student's answer, and quiz_attempts.answers
  is an untyped blob. Neither has anywhere to record WHY an answer was wrong.
  These tables are separate on purpose.

  `confusion_tags` and `lecture_coverage` are real columns rather than fields
  inside `diagnosis` so the deferred cross-quiz pattern pass is a GROUP BY over
  an index, with no further migration.

  RLS is enabled and owner-scoped from the start. This repo's history contains
  six separate `disable_rls_for_testing` migrations; these tables do not join them.
*/

CREATE TABLE IF NOT EXISTS quiz_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id       uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('text','image')),
  raw_input        text,
  quiz_title       text,
  score_correct    integer,
  score_total      integer,
  status           text NOT NULL DEFAULT 'awaiting_confirmation'
                     CHECK (status IN ('awaiting_confirmation','diagnosing','completed','failed')),
  processing_error text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_review_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES quiz_reviews(id) ON DELETE CASCADE,
  position         integer NOT NULL,
  question_text    text NOT NULL,
  question_type    text NOT NULL CHECK (question_type IN ('multiple_choice','true_false','short_answer')),
  options          jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_answer   text,
  correct_answer   text,
  is_correct       boolean NOT NULL,
  diagnosis        jsonb,
  confusion_tags   text[] NOT NULL DEFAULT '{}',
  lecture_coverage text CHECK (lecture_coverage IN ('covered','partial','not-in-lecture')),
  diagnosis_status text NOT NULL DEFAULT 'pending'
                     CHECK (diagnosis_status IN ('pending','diagnosing','completed','failed','not-applicable')),
  diagnosis_error  text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (review_id, position)
);

CREATE INDEX IF NOT EXISTS idx_quiz_review_items_review_id
  ON quiz_review_items(review_id);
CREATE INDEX IF NOT EXISTS idx_quiz_reviews_user_created
  ON quiz_reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_reviews_lecture_id
  ON quiz_reviews(lecture_id);
-- GIN index exists for the deferred pattern pass: "which confusions repeat?"
CREATE INDEX IF NOT EXISTS idx_quiz_review_items_confusion_tags
  ON quiz_review_items USING GIN (confusion_tags);

CREATE TRIGGER update_quiz_reviews_updated_at
  BEFORE UPDATE ON quiz_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quiz_review_items_updated_at
  BEFORE UPDATE ON quiz_review_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quiz_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_review_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quiz reviews"
  ON quiz_reviews FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Users can create own quiz reviews"
  ON quiz_reviews FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own quiz reviews"
  ON quiz_reviews FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own quiz reviews"
  ON quiz_reviews FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can view own quiz review items"
  ON quiz_review_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can create own quiz review items"
  ON quiz_review_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can update own quiz review items"
  ON quiz_review_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can delete own quiz review items"
  ON quiz_review_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quiz_reviews r
    WHERE r.id = quiz_review_items.review_id AND r.user_id = auth.uid()));
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push --project-ref hkqoesqiallwqbvuqgpp`

Expected: both tables created, no error.

- [ ] **Step 3: Verify the tables and RLS landed**

Run this against the project (SQL editor or `mcp__claude_ai_Supabase__execute_sql`):

```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('quiz_reviews','quiz_review_items');

SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('quiz_reviews','quiz_review_items') ORDER BY tablename, policyname;
```

Expected: `rowsecurity = true` for both tables, and 8 policies total (4 per table).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260820120000_quiz_diagnosis_tables.sql
git commit -m "feat(db): quiz_reviews and quiz_review_items with owner-scoped RLS"
```

---

## Task 2: Parse and diagnosis schemas

**Files:**
- Modify: `supabase/functions/_shared/schemas.ts`
- Test: `supabase/functions/_shared/schemas.test.ts`

**Interfaces:**
- Consumes: existing `ClaimSchema`, `DistinctionSchema` in the same file.
- Produces: `CONFUSION_TAGS`, `ParsedQuizSchema`, `ParsedQuiz`, `ParsedQuizItem`, `DiagnosisSchema`, `Diagnosis`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/schemas.test.ts`:

```ts
import { ParsedQuizSchema, DiagnosisSchema } from './schemas'

const validParsed = {
  quiz_title: 'Week 01 Quiz',
  score_correct: 3,
  score_total: 4,
  items: [{
    position: 4,
    question_text: 'Good systems are enough to transform people.',
    question_type: 'true_false' as const,
    options: [],
    student_answer: 'True',
    correct_answer: 'False',
    is_correct: false,
  }],
  unreadable: [],
}

const validDiagnosis = {
  lecture_coverage: 'covered' as const,
  correct_answer: 'False',
  why_correct: 'The claim is about sufficiency, and systems are necessary but not sufficient.',
  citations: [{ quote: 'the law, weakened by the flesh, could not do', supports: 'Systems cannot transform' }],
  where_it_went_sideways: [{
    confusion: 'Agreed with the sentiment instead of evaluating the claim',
    explanation: 'The sentence reads as a compliment to good systems, so it got a nod.',
  }],
  collapsed_distinction: { this_: 'transformation', not_that: 'behavior change' },
  dont_overcorrect: 'False does not mean systems are worthless.',
  what_this_miss_was_not: 'Not careless — this question required judgment.',
  remember_this: 'Systems shape behavior; only the Spirit changes hearts.',
  why_it_matters: 'It is the difference between managing souls and shepherding them.',
  confusion_tags: ['absolutizing-word' as const, 'collapsed-distinction' as const],
}

describe('ParsedQuizSchema', () => {
  it('accepts a well-formed parsed quiz', () => {
    expect(ParsedQuizSchema.parse(validParsed)).toEqual(validParsed)
  })

  it('allows a null student_answer — an unreadable screenshot must not be guessed', () => {
    const p = { ...validParsed, items: [{ ...validParsed.items[0], student_answer: null }] }
    expect(() => ParsedQuizSchema.parse(p)).not.toThrow()
  })

  it('allows a null score — not every results page reports one', () => {
    const p = { ...validParsed, score_correct: null, score_total: null }
    expect(() => ParsedQuizSchema.parse(p)).not.toThrow()
  })

  it('rejects a position below 1', () => {
    const p = { ...validParsed, items: [{ ...validParsed.items[0], position: 0 }] }
    expect(() => ParsedQuizSchema.parse(p)).toThrow()
  })

  it('rejects an unknown question_type', () => {
    const p = { ...validParsed, items: [{ ...validParsed.items[0], question_type: 'essay' }] }
    expect(() => ParsedQuizSchema.parse(p)).toThrow()
  })
})

describe('DiagnosisSchema', () => {
  it('accepts a well-formed diagnosis', () => {
    expect(DiagnosisSchema.parse(validDiagnosis)).toEqual(validDiagnosis)
  })

  it('accepts a null collapsed_distinction — not every miss is a collapsed distinction', () => {
    expect(() => DiagnosisSchema.parse({ ...validDiagnosis, collapsed_distinction: null })).not.toThrow()
  })

  it('accepts zero citations when the lecture did not cover the question', () => {
    const d = { ...validDiagnosis, lecture_coverage: 'not-in-lecture' as const, citations: [] }
    expect(() => DiagnosisSchema.parse(d)).not.toThrow()
  })

  it('rejects an out-of-enum confusion tag — free text would not cluster', () => {
    const d = { ...validDiagnosis, confusion_tags: ['did-not-study'] }
    expect(() => DiagnosisSchema.parse(d)).toThrow()
  })

  it('rejects an empty confusion_tags array — an untagged miss is invisible to the pattern pass', () => {
    expect(() => DiagnosisSchema.parse({ ...validDiagnosis, confusion_tags: [] })).toThrow()
  })

  it('rejects an empty where_it_went_sideways — "incorrect" is not a diagnosis', () => {
    expect(() => DiagnosisSchema.parse({ ...validDiagnosis, where_it_went_sideways: [] })).toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/schemas.test.ts`
Expected: FAIL — `ParsedQuizSchema` and `DiagnosisSchema` are not exported.

- [ ] **Step 3: Add the schemas**

Append to `supabase/functions/_shared/schemas.ts`:

```ts
/**
 * A closed vocabulary. Free-text tags do not cluster, and un-clusterable
 * tags make the deferred cross-quiz pattern pass worthless. Every value here
 * is a confusion the worked example (~/hcli-school/weeks/week-01/review.md)
 * actually names.
 */
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

export const ParsedQuizItemSchema = z.object({
  position: z.number().int().min(1).describe('The question number as it appears on the quiz.'),
  question_text: z.string(),
  question_type: z.enum(['multiple_choice', 'true_false', 'short_answer']),
  options: z.array(z.string())
    .describe('Empty for true_false and short_answer. The confirm table renders True/False from question_type.'),
  student_answer: z.string().nullable()
    .describe('Null if you cannot tell what the student chose. Never guess.'),
  correct_answer: z.string().nullable()
    .describe('Null if the quiz does not show it.'),
  is_correct: z.boolean(),
})

export const ParsedQuizSchema = z.object({
  quiz_title: z.string().nullable(),
  score_correct: z.number().int().nullable().describe('As REPORTED by the quiz, not recomputed.'),
  score_total: z.number().int().nullable().describe('As REPORTED by the quiz, not recomputed.'),
  items: z.array(ParsedQuizItemSchema),
  unreadable: z.array(z.string())
    .describe('Anything you could not make out. Report it here rather than guessing.'),
})

export const DiagnosisSchema = z.object({
  lecture_coverage: z.enum(['covered', 'partial', 'not-in-lecture'])
    .describe("'not-in-lecture' REQUIRES an empty citations array."),
  correct_answer: z.string(),
  why_correct: z.string().describe('The reasoning chain, not the answer key.'),
  citations: z.array(z.object({
    quote: z.string().describe("The lecturer's own words. VERBATIM — this is checked in code."),
    supports: z.string().describe('What this quote establishes.'),
  })),
  where_it_went_sideways: z.array(z.object({
    confusion: z.string().describe('Name the specific confusion. "Incorrect" is not a diagnosis.'),
    explanation: z.string(),
  })).min(1),
  collapsed_distinction: z.object({
    this_: z.string(),
    not_that: z.string(),
  }).nullable().describe('Null if the miss was not a collapsed distinction.'),
  dont_overcorrect: z.string().describe('What being wrong here does NOT mean.'),
  what_this_miss_was_not: z.string()
    .describe('Do not inflate. If it was careless, say it was careless.'),
  remember_this: z.string().describe('One sentence.'),
  why_it_matters: z.string().describe('Why this matters past the quiz.'),
  confusion_tags: z.array(z.enum(CONFUSION_TAGS)).min(1),
})

export type ConfusionTag = (typeof CONFUSION_TAGS)[number]
export type ParsedQuiz = z.infer<typeof ParsedQuizSchema>
export type ParsedQuizItem = z.infer<typeof ParsedQuizItemSchema>
export type Diagnosis = z.infer<typeof DiagnosisSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/schemas.test.ts`
Expected: PASS, including the four pre-existing `LectureAnalysisSchema` tests.

- [ ] **Step 5: Verify shared typecheck is still clean**

Run: `npm run typecheck:shared`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/schemas.ts supabase/functions/_shared/schemas.test.ts
git commit -m "feat(schemas): parsed quiz and diagnosis schemas with a closed confusion-tag enum"
```

---

## Task 3: Citation verifier

The single most important guarantee in Phase 2. A fabricated quote attributed to the student's own lecturer is the worst output this feature could produce, and it is the one failure a prompt instruction cannot prevent.

**Files:**
- Create: `supabase/functions/_shared/citations.ts`
- Test: `supabase/functions/_shared/citations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `verifyCitations(citations, sources) => { verified, rejected }`, and `normalizeForMatch(s) => string`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/citations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { verifyCitations, normalizeForMatch, MIN_VERIFIABLE_QUOTE_LENGTH } from './citations'

const TRANSCRIPT = 'The law, weakened by the flesh, could not do what God has now done.'
const CLAIM_QUOTES = ['nobody has ever made a seed grow']

const cite = (quote: string) => ({ quote, supports: 'x' })

describe('normalizeForMatch', () => {
  it('collapses runs of whitespace', () => {
    expect(normalizeForMatch('a   b\n\nc')).toBe('a b c')
  })

  it('normalizes curly quotes and apostrophes to straight ones', () => {
    expect(normalizeForMatch('“the lecturer’s words”')).toBe('"the lecturer\'s words"')
  })

  it('is case-insensitive — case does not change attribution', () => {
    expect(normalizeForMatch('The Law')).toBe(normalizeForMatch('the law'))
  })
})

describe('verifyCitations', () => {
  it('accepts a quote found verbatim in the transcript', () => {
    const r = verifyCitations([cite('weakened by the flesh, could not do')],
      { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.verified).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
  })

  it('accepts a quote that differs only in whitespace', () => {
    const r = verifyCitations([cite('weakened   by the\nflesh, could not do')],
      { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.verified).toHaveLength(1)
  })

  it('accepts a quote found in a stored claim quote when there is no transcript', () => {
    const r = verifyCitations([cite('nobody has ever made a seed grow')],
      { transcript: null, claimQuotes: CLAIM_QUOTES })
    expect(r.verified).toHaveLength(1)
  })

  it('REJECTS a fabricated quote that appears nowhere in the source', () => {
    const r = verifyCitations([cite('systems are the engine of transformation')],
      { transcript: TRANSCRIPT, claimQuotes: CLAIM_QUOTES })
    expect(r.verified).toHaveLength(0)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].quote).toBe('systems are the engine of transformation')
  })

  it('rejects a quote too short to verify meaningfully', () => {
    expect('the law'.length).toBeLessThan(MIN_VERIFIABLE_QUOTE_LENGTH)
    const r = verifyCitations([cite('the law')], { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.rejected).toHaveLength(1)
  })

  it('separates the good from the bad rather than failing the whole set', () => {
    const r = verifyCitations(
      [cite('weakened by the flesh, could not do'), cite('a quote nobody ever said out loud')],
      { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r.verified).toHaveLength(1)
    expect(r.rejected).toHaveLength(1)
  })

  it('rejects everything when there is no source at all', () => {
    const r = verifyCitations([cite('weakened by the flesh, could not do')],
      { transcript: null, claimQuotes: [] })
    expect(r.verified).toHaveLength(0)
    expect(r.rejected).toHaveLength(1)
  })

  it('returns empty sets for no citations', () => {
    const r = verifyCitations([], { transcript: TRANSCRIPT, claimQuotes: [] })
    expect(r).toEqual({ verified: [], rejected: [] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/citations.test.ts`
Expected: FAIL — cannot resolve `./citations`.

- [ ] **Step 3: Implement the verifier**

Create `supabase/functions/_shared/citations.ts`:

```ts
/**
 * Citations are VERIFIED, not trusted.
 *
 * The diagnosis prompt requires quotes to be verbatim from the lecture. A prompt
 * instruction is not a guarantee, and a fabricated quote attributed to a student's
 * own lecturer is the single worst thing this feature could produce — it is both
 * confidently wrong and impossible for the student to catch, because they came here
 * precisely because they don't know the material.
 *
 * So every returned quote is checked against the actual source before it is stored.
 */

export interface Citation {
  quote: string
  supports: string
}

export interface CitationSources {
  /** Null for `slides` lectures — Phase 1 sends the PDF as a document block and never stores a transcript. */
  transcript: string | null
  /** `lectures.claims[].quote` — the only corpus available for slides lectures. */
  claimQuotes: string[]
}

export interface CitationVerification {
  verified: Citation[]
  rejected: Citation[]
}

/**
 * Below this length a "quote" matches too much to mean anything — "the law"
 * would verify against almost any lecture. Short fragments are unverifiable,
 * and unverifiable is treated the same as unverified.
 */
export const MIN_VERIFIABLE_QUOTE_LENGTH = 12

/**
 * Verbatim is checked semantically, not byte-for-byte. A model reproducing a
 * transcript will legitimately vary whitespace and quote characters; neither
 * changes who said what. Case is folded for the same reason. Anything beyond
 * that — different words — is a different quote.
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function verifyCitations(
  citations: Citation[],
  sources: CitationSources,
): CitationVerification {
  const haystacks = [
    ...(sources.transcript ? [sources.transcript] : []),
    ...sources.claimQuotes,
  ].map(normalizeForMatch)

  const verified: Citation[] = []
  const rejected: Citation[] = []

  for (const c of citations) {
    const needle = normalizeForMatch(c.quote)
    const longEnough = needle.length >= MIN_VERIFIABLE_QUOTE_LENGTH
    if (longEnough && haystacks.some((h) => h.includes(needle))) {
      verified.push(c)
    } else {
      rejected.push(c)
    }
  }

  return { verified, rejected }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/citations.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/citations.ts supabase/functions/_shared/citations.test.ts
git commit -m "feat(citations): verify quoted citations against transcript and stored claims"
```

---

## Task 4: Prompts

**Files:**
- Modify: `supabase/functions/_shared/prompts.ts`
- Test: `supabase/functions/_shared/prompts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `QUIZ_PARSER_SYSTEM`, `MISS_DIAGNOSTICIAN_SYSTEM` (both `string`).

- [ ] **Step 1: Write the failing tests**

The existing `prompts.test.ts` asserts on prompt *content* — that specific commitments are present. Follow that pattern; append:

```ts
import { QUIZ_PARSER_SYSTEM, MISS_DIAGNOSTICIAN_SYSTEM } from './prompts'

describe('QUIZ_PARSER_SYSTEM', () => {
  it('forbids judging correctness — that is the diagnostician\'s job', () => {
    expect(QUIZ_PARSER_SYSTEM).toMatch(/do not (decide|judge|evaluate)/i)
  })

  it('forbids guessing an unreadable answer', () => {
    expect(QUIZ_PARSER_SYSTEM).toMatch(/unreadable/i)
    expect(QUIZ_PARSER_SYSTEM).toMatch(/never guess|do not guess/i)
  })

  it('forbids correcting the student\'s answer to what they probably meant', () => {
    expect(QUIZ_PARSER_SYSTEM).toMatch(/probably meant|as it appears|exactly as/i)
  })
})

describe('MISS_DIAGNOSTICIAN_SYSTEM', () => {
  it('requires verbatim quotes', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/verbatim/i)
  })

  it('warns that citations are checked in code', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/checked in code|verified in code/i)
  })

  it('requires naming the specific confusion', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/not a diagnosis/i)
  })

  it('requires the not-in-lecture escape hatch', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/not-in-lecture/)
  })

  it('forbids inflating a careless miss', () => {
    expect(MISS_DIAGNOSTICIAN_SYSTEM).toMatch(/careless/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/prompts.test.ts`
Expected: FAIL — neither constant is exported.

- [ ] **Step 3: Write the prompts**

Append to `supabase/functions/_shared/prompts.ts`:

```ts
export const QUIZ_PARSER_SYSTEM = `You are transcribing a quiz a student has already taken and been graded on. You are doing STRUCTURAL EXTRACTION ONLY.

Your entire job is to record what is on the page. A separate step, later, does the thinking.

DO NOT DECIDE WHETHER AN ANSWER IS CORRECT.
Record what the quiz says is correct. If the quiz does not say, set correct_answer to null. Never work it out yourself, and never overrule the answer key even when you believe it is wrong. Deciding correctness is not your job here.

RECORD THE STUDENT'S ANSWER EXACTLY AS IT APPEARS.
Never normalize it, never tidy it, and never change it to what they probably meant. If they wrote "T", record "T", not "True". The whole point of this step is that a human is about to check your work against the page — so your output must reflect the page, not your reading of it.

NEVER GUESS. USE 'unreadable'.
If you cannot tell which option was selected, which answer was marked correct, or what a question says, set that field to null and describe what you could not make out in the 'unreadable' array. A guess here is invisible: it produces a confident, well-argued diagnosis of a mistake the student never made. An honest "I could not read question 3" costs one click to fix.

REPORT THE SCORE AS PRINTED.
score_correct and score_total are what the quiz claims. Do not recompute them from the questions, even if they disagree. The disagreement is itself informative and is shown to the student.

is_correct IS WHAT THE GRADING SHOWS.
Ticks, crosses, colour, "your answer"/"correct answer" mismatch — whatever the page uses. If the page does not indicate it and you cannot infer it from a stated correct answer, set is_correct to true so the question is NOT diagnosed, and note the uncertainty in 'unreadable'. Diagnosing a question the student actually got right wastes their time and insults them; missing one is one click to fix.`

export const MISS_DIAGNOSTICIAN_SYSTEM = `You are explaining to a student why a specific quiz answer they gave was wrong.

They have already been graded. They do not need to be told they were wrong — they need to understand WHY, well enough to answer this material on a final and to use it afterwards. Knowing why an answer is wrong transfers; knowing that it is wrong does not.

CITE THE LECTURE IN ITS OWN WORDS.
Every quote you give must be VERBATIM from the lecture material provided. Do not paraphrase inside quotation marks. Do not reconstruct what the lecturer probably said. Quotes are checked in code against the actual transcript and stored claims, and anything that does not match is discarded — so a fabricated quote costs you the citation and helps nobody.

IF THE LECTURE DOES NOT COVER IT, SAY SO.
Set lecture_coverage to 'not-in-lecture' and return NO citations. Explain the answer from the material's own logic and be explicit that the lecture did not address it. Set 'partial' when the lecture touches the topic but does not settle the question. A student who is told "your lecture didn't cover this" can go find out; a student handed a confident fabricated citation cannot.

NAME THE SPECIFIC CONFUSION.
"You were incorrect" is not a diagnosis. Say what actually happened: which two things were collapsed, which word carried the weight, which side of a tension was being tested. If the lecture separated two things the student merged, name both sides.

DO NOT INFLATE.
If the miss was careless — misread the question, missed a NOT, rushed — say that plainly in what_this_miss_was_not and tag it 'careless'. Do not manufacture a deep conceptual reason for a careless slip. Equally, if the question genuinely required judgment rather than recall, say that too: missing a hard question is different from missing an easy one, and the student should know which happened.

GUARD AGAINST OVERCORRECTION.
In dont_overcorrect, say what the right answer does NOT mean. A student who learns "systems don't transform people" and concludes "systems don't matter" has traded one error for a worse one.

SAY WHEN THE POINT IS CONTESTED.
If the lecture material marks a claim as contested, say which position this course teaches and that others hold it differently. The student is being graded by this course; they should still know the difference.

TEACH, DO NOT JUST CORRECT.
Give the reasoning chain. Be concrete and concise — short paragraphs, no padding. The student is reading this under time pressure.`
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/prompts.test.ts`
Expected: PASS, including the pre-existing prompt tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/prompts.ts supabase/functions/_shared/prompts.test.ts
git commit -m "feat(prompts): quiz parser and miss diagnostician system prompts"
```

---

## Task 5: Extract `runStructured`, then build the parse call

The truncation check would otherwise be copy-pasted three times, and one copy would drift. `analyzeLecture`'s existing tests are the safety net that proves the extraction changed no behaviour.

**Files:**
- Modify: `supabase/functions/_shared/claude.ts`
- Create: `supabase/functions/_shared/quiz.ts`
- Test: `supabase/functions/_shared/quiz.test.ts`, existing `claude.test.ts` (unchanged, must still pass)

**Interfaces:**
- Consumes: `ClaudeLike`, `ContentBlock`, `MODEL`, `MAX_TOKENS` from `claude.ts`; `ParsedQuizSchema` from `schemas.ts`; `QUIZ_PARSER_SYSTEM` from `prompts.ts`.
- Produces:
  - `runStructured<T>(client: ClaudeLike, args: { system: string; input: ContentBlock[]; schema: z.ZodType<T> }): Promise<T>` in `claude.ts`
  - `buildParseInput(src: { text?: string; imageBase64?: string; imageMediaType?: ImageMediaType }): ContentBlock[]` in `quiz.ts`
  - `parseQuiz(client: ClaudeLike, input: ContentBlock[]): Promise<ParsedQuiz>` in `quiz.ts`
  - `ImageMediaType` union type, exported from `claude.ts`

- [ ] **Step 1: Extract `runStructured` in `claude.ts`**

Add the image block to `ContentBlock`, add the generic runner, and reimplement `analyzeLecture` on top of it. Replace the existing `ContentBlock` type and `analyzeLecture` function with:

```ts
import { z } from 'zod'

/** The media types the Messages API accepts for image blocks. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }

/**
 * One structured Claude call, with the truncation check every caller needs.
 *
 * Extracted so the `stop_reason === 'max_tokens'` check below lives in exactly
 * one place. Three callers copy-pasting it is three chances for one copy to
 * drift, and the failure mode of a missing check is silent: a response cut off
 * mid-generation still parses into a syntactically valid object.
 */
export async function runStructured<T>(
  client: ClaudeLike,
  args: { system: string; input: ContentBlock[]; schema: z.ZodType<T> },
): Promise<T> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: args.system,
    messages: [{ role: 'user', content: args.input }],
    output_config: { format: zodOutputFormat(args.schema) },
  })

  // Checked BEFORE the null check: `parsed_output` being non-null does not
  // mean the response is complete.
  if (res.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude's response was truncated at the ${MAX_TOKENS}-token output limit before it ` +
      'finished. Retrying will hit the same wall every time, because the input never changes.'
    )
  }

  if (!res.parsed_output) {
    throw new Error('Claude returned no structured output (parsed_output was null).')
  }
  return args.schema.parse(res.parsed_output)
}

export async function analyzeLecture(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<LectureAnalysis> {
  return await runStructured(client, {
    system: LECTURE_ANALYST_SYSTEM,
    input,
    schema: LectureAnalysisSchema,
  })
}
```

- [ ] **Step 2: Run the existing claude tests to prove the extraction is behaviour-preserving**

Run: `npx vitest run supabase/functions/_shared/claude.test.ts`
Expected: PASS, all pre-existing tests, **unmodified**. If any test needed changing, the refactor changed behaviour — revert and redo.

- [ ] **Step 3: Write the failing tests for the parse call**

Create `supabase/functions/_shared/quiz.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildParseInput, parseQuiz } from './quiz'

const PARSED = {
  quiz_title: null, score_correct: null, score_total: null,
  items: [], unreadable: [],
}

describe('buildParseInput', () => {
  it('sends pasted text as a text block', () => {
    expect(buildParseInput({ text: 'Q1. What is a worldview?' }))
      .toEqual([{ type: 'text', text: 'Q1. What is a worldview?' }])
  })

  it('sends a screenshot as an image block with its media type', () => {
    expect(buildParseInput({ imageBase64: 'iVBOR', imageMediaType: 'image/png' }))
      .toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }])
  })

  it('throws on empty text rather than sending an empty prompt', () => {
    expect(() => buildParseInput({ text: '   ' })).toThrow(/empty/i)
  })

  it('throws when given neither text nor an image', () => {
    expect(() => buildParseInput({})).toThrow(/text or an image/i)
  })

  it('throws when an image is supplied without a media type', () => {
    expect(() => buildParseInput({ imageBase64: 'iVBOR' })).toThrow(/media type/i)
  })
})

describe('parseQuiz', () => {
  it('calls Claude with the parser prompt, pinned model and ceiling', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: PARSED, stop_reason: 'end_turn' })
    await parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }])

    const args = parse.mock.calls[0][0] as Record<string, unknown>
    expect(args.model).toBe('claude-opus-5')
    expect(args.max_tokens).toBe(16000)
    expect(args.system).toMatch(/STRUCTURAL EXTRACTION ONLY/)
    expect(args).not.toHaveProperty('thinking')
  })

  it('returns the validated parsed quiz', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: PARSED, stop_reason: 'end_turn' })
    expect(await parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }])).toEqual(PARSED)
  })

  it('throws on a truncated response instead of storing a half-read quiz', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: PARSED, stop_reason: 'max_tokens' })
    await expect(parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/truncated/i)
  })

  it('throws when parsed_output is null', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: null, stop_reason: 'end_turn' })
    await expect(parseQuiz({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/no structured output/i)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/quiz.test.ts`
Expected: FAIL — cannot resolve `./quiz`.

- [ ] **Step 5: Implement the parse half of `quiz.ts`**

Create `supabase/functions/_shared/quiz.ts`:

```ts
import { runStructured, type ClaudeLike, type ContentBlock, type ImageMediaType } from './claude.ts'
import { ParsedQuizSchema, type ParsedQuiz } from './schemas.ts'
import { QUIZ_PARSER_SYSTEM } from './prompts.ts'

export interface ParseSource {
  text?: string
  imageBase64?: string
  imageMediaType?: ImageMediaType
}

/**
 * Screenshots are read and discarded — the base64 never reaches storage.
 * The handover records 382MB of orphaned objects against a 1GB free tier;
 * there is no reason to add an image we read exactly once.
 */
export function buildParseInput(src: ParseSource): ContentBlock[] {
  if (src.text !== undefined) {
    if (!src.text.trim()) throw new Error('Pasted quiz text is empty.')
    return [{ type: 'text', text: src.text }]
  }

  if (src.imageBase64) {
    if (!src.imageMediaType) throw new Error('An image requires a media type.')
    return [{
      type: 'image',
      source: { type: 'base64', media_type: src.imageMediaType, data: src.imageBase64 },
    }]
  }

  throw new Error('Provide either quiz text or an image.')
}

export async function parseQuiz(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<ParsedQuiz> {
  return await runStructured(client, {
    system: QUIZ_PARSER_SYSTEM,
    input,
    schema: ParsedQuizSchema,
  })
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/`
Expected: PASS — the whole shared suite, including Phase 1's.

- [ ] **Step 7: Verify shared typecheck**

Run: `npm run typecheck:shared`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/claude.ts supabase/functions/_shared/quiz.ts supabase/functions/_shared/quiz.test.ts
git commit -m "refactor(claude): extract runStructured; feat(quiz): parse pasted text or a screenshot"
```

---

## Task 6: The diagnosis call

**Files:**
- Modify: `supabase/functions/_shared/quiz.ts`
- Test: `supabase/functions/_shared/quiz.test.ts`

**Interfaces:**
- Consumes: `runStructured`, `DiagnosisSchema`, `MISS_DIAGNOSTICIAN_SYSTEM`, `Claim`, `Distinction`.
- Produces:
  - `buildDiagnosisInput(input: DiagnosisRequest): ContentBlock[]`
  - `diagnoseMiss(client: ClaudeLike, input: ContentBlock[]): Promise<Diagnosis>`
  - `DiagnosisRequest` interface (exact shape in Step 3)

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/quiz.test.ts`:

```ts
import { buildDiagnosisInput, diagnoseMiss } from './quiz'

const REQ = {
  question: {
    question_text: 'Good systems are enough to transform people.',
    question_type: 'true_false',
    options: [] as string[],
    student_answer: 'True',
    correct_answer: 'False',
  },
  lecture: {
    title: 'Week 1 — Worldview',
    transcript: 'Systems restrain behaviour. They cannot produce a new heart.',
    claims: [{
      statement: 'Systems cannot transform',
      quote: 'They cannot produce a new heart',
      emphasis: 'flagged' as const,
      contested: false,
    }],
    distinctions: [{
      this_: 'transformation',
      not_that: 'behaviour change',
      why_confusable: 'both show up as different conduct',
    }],
  },
}

const DIAGNOSIS = {
  lecture_coverage: 'covered' as const,
  correct_answer: 'False',
  why_correct: 'It is a claim about sufficiency.',
  citations: [{ quote: 'They cannot produce a new heart', supports: 'Systems are insufficient' }],
  where_it_went_sideways: [{ confusion: 'Read tone, not claim', explanation: 'It sounds like a compliment.' }],
  collapsed_distinction: { this_: 'transformation', not_that: 'behaviour change' },
  dont_overcorrect: 'Systems still matter.',
  what_this_miss_was_not: 'Not careless.',
  remember_this: 'Systems shape behaviour; they do not change hearts.',
  why_it_matters: 'It decides how you respond to sin in a team.',
  confusion_tags: ['absolutizing-word' as const],
}

describe('buildDiagnosisInput', () => {
  it('includes the question, the student answer and the correct answer', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toContain('Good systems are enough to transform people.')
    expect(text).toContain('True')
    expect(text).toContain('False')
  })

  it('labels the student answer unambiguously so the model cannot swap them', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toMatch(/THE STUDENT ANSWERED:\s*True/)
    expect(text).toMatch(/THE CORRECT ANSWER (IS|WAS):\s*False/)
  })

  it('includes claim quotes verbatim so citations have something to match', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toContain('They cannot produce a new heart')
  })

  it('includes distinctions — a wrong answer is usually a collapsed one', () => {
    const text = (buildDiagnosisInput(REQ)[0] as { text: string }).text
    expect(text).toContain('transformation')
    expect(text).toContain('behaviour change')
  })

  it('says plainly when there is no transcript rather than sending an empty section', () => {
    const text = (buildDiagnosisInput({
      ...REQ, lecture: { ...REQ.lecture, transcript: null },
    })[0] as { text: string }).text
    expect(text).toMatch(/no transcript/i)
  })

  it('renders multiple-choice options so the model can see the distractors', () => {
    const text = (buildDiagnosisInput({
      ...REQ,
      question: { ...REQ.question, question_type: 'multiple_choice', options: ['Alpha', 'Beta'] },
    })[0] as { text: string }).text
    expect(text).toContain('Alpha')
    expect(text).toContain('Beta')
  })

  it('handles a null student answer without printing "null" at the student', () => {
    const text = (buildDiagnosisInput({
      ...REQ, question: { ...REQ.question, student_answer: null },
    })[0] as { text: string }).text
    expect(text).not.toMatch(/THE STUDENT ANSWERED:\s*null/)
  })
})

describe('diagnoseMiss', () => {
  it('calls Claude with the diagnostician prompt and the pinned model', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: DIAGNOSIS, stop_reason: 'end_turn' })
    await diagnoseMiss({ messages: { parse } }, [{ type: 'text', text: 'x' }])

    const args = parse.mock.calls[0][0] as Record<string, unknown>
    expect(args.model).toBe('claude-opus-5')
    expect(args.max_tokens).toBe(16000)
    expect(args.system).toMatch(/VERBATIM/)
  })

  it('returns the validated diagnosis', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: DIAGNOSIS, stop_reason: 'end_turn' })
    expect(await diagnoseMiss({ messages: { parse } }, [{ type: 'text', text: 'x' }])).toEqual(DIAGNOSIS)
  })

  it('throws on a truncated diagnosis rather than storing half an explanation', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: DIAGNOSIS, stop_reason: 'max_tokens' })
    await expect(diagnoseMiss({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/truncated/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/quiz.test.ts`
Expected: FAIL — `buildDiagnosisInput` and `diagnoseMiss` are not exported.

- [ ] **Step 3: Implement the diagnosis half of `quiz.ts`**

Append to `supabase/functions/_shared/quiz.ts` (and extend the imports at the top of the file to include `DiagnosisSchema`, `type Diagnosis`, `type Claim`, `type Distinction` from `./schemas.ts` and `MISS_DIAGNOSTICIAN_SYSTEM` from `./prompts.ts`):

```ts
export interface DiagnosisRequest {
  question: {
    question_text: string
    question_type: string
    options: string[]
    student_answer: string | null
    correct_answer: string | null
  }
  lecture: {
    title?: string
    /** Null for `slides` lectures — Phase 1 never stores a transcript for them. */
    transcript: string | null
    claims: Claim[]
    distinctions: Distinction[]
  }
}

/**
 * Assembles the whole diagnosis prompt as one text block.
 *
 * Claim quotes are included VERBATIM and unabridged: they are the corpus the
 * citation verifier later checks the model's quotes against, so paraphrasing
 * them here would guarantee every citation is rejected.
 *
 * The student's answer and the correct answer are labelled in caps and on
 * their own lines. Prose like "the student said True but the answer is False"
 * is exactly the kind of sentence a model can read backwards, and a diagnosis
 * built on a swapped pair is fluent, confident and about the wrong mistake.
 */
export function buildDiagnosisInput(req: DiagnosisRequest): ContentBlock[] {
  const { question: q, lecture: l } = req
  const parts: string[] = []

  parts.push('# THE QUESTION THE STUDENT MISSED\n')
  parts.push(q.question_text)
  if (q.options.length) {
    parts.push('\nOptions:')
    for (const o of q.options) parts.push(`- ${o}`)
  }
  parts.push('')
  parts.push(`THE STUDENT ANSWERED: ${q.student_answer ?? '(not recorded)'}`)
  parts.push(`THE CORRECT ANSWER IS: ${q.correct_answer ?? '(not recorded)'}`)

  parts.push('\n# THE LECTURE')
  if (l.title) parts.push(`Title: ${l.title}`)

  parts.push('\n## Claims the lecturer made')
  if (l.claims.length) {
    for (const c of l.claims) {
      parts.push(`- ${c.statement}`)
      parts.push(`  Verbatim: "${c.quote}"`)
      parts.push(`  Emphasis: ${c.emphasis}${c.contested ? ' — CONTESTED across traditions' : ''}`)
    }
  } else {
    parts.push('(none recorded)')
  }

  parts.push('\n## Distinctions the lecturer drew')
  if (l.distinctions.length) {
    for (const d of l.distinctions) {
      parts.push(`- "${d.this_}" is NOT "${d.not_that}" — confusable because ${d.why_confusable}`)
    }
  } else {
    parts.push('(none recorded)')
  }

  parts.push('\n## Transcript')
  parts.push(
    l.transcript?.trim()
      ? l.transcript
      : '(No transcript is available for this lecture — it was uploaded as slides. ' +
        'The claims above are the only record of what was said.)'
  )

  return [{ type: 'text', text: parts.join('\n') }]
}

export async function diagnoseMiss(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<Diagnosis> {
  return await runStructured(client, {
    system: MISS_DIAGNOSTICIAN_SYSTEM,
    input,
    schema: DiagnosisSchema,
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/quiz.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify shared typecheck**

Run: `npm run typecheck:shared`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/quiz.ts supabase/functions/_shared/quiz.test.ts
git commit -m "feat(quiz): assemble diagnosis context from claims, distinctions and transcript"
```

---

## Task 7: Quiz-item authorization

`itemId` arrives on the request body and is never trusted. Two IDORs in this repo came from exactly that.

**Files:**
- Modify: `supabase/functions/_shared/auth.ts`
- Test: `supabase/functions/_shared/auth.test.ts`

**Interfaces:**
- Consumes: nothing (mirrors `authorizeLectureAccess`'s injected-deps shape in the same file).
- Produces: `authorizeQuizItemAccess(deps, authHeader, itemId) => QuizAuthResult`, plus `QuizItemRow`, `QuizReviewRow`, `QuizAuthDeps`, `QuizAuthResult`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/auth.test.ts`:

```ts
import { authorizeQuizItemAccess, type QuizAuthDeps } from './auth'

const ITEM = {
  id: 'item-1', review_id: 'rev-1', is_correct: false,
  question_text: 'q', question_type: 'true_false', options: [],
  student_answer: 'True', correct_answer: 'False',
}
const REVIEW = { id: 'rev-1', user_id: 'user-A', lecture_id: 'lec-1' }

const qDeps = (over: Partial<QuizAuthDeps> = {}): QuizAuthDeps => ({
  getUserFromToken: async (t) => (t === 'good-token' ? { id: 'user-A' } : null),
  getItem: async (id) => (id === 'item-1' ? ITEM : null),
  getReview: async (id) => (id === 'rev-1' ? REVIEW : null),
  ...over,
})

describe('authorizeQuizItemAccess', () => {
  it('401s with no Authorization header', async () => {
    expect(await authorizeQuizItemAccess(qDeps(), null, 'item-1'))
      .toMatchObject({ ok: false, status: 401 })
  })

  it('401s on an invalid token', async () => {
    expect(await authorizeQuizItemAccess(qDeps(), 'Bearer bad-token', 'item-1'))
      .toMatchObject({ ok: false, status: 401 })
  })

  it('404s when the item does not exist', async () => {
    expect(await authorizeQuizItemAccess(qDeps(), 'Bearer good-token', 'nope'))
      .toMatchObject({ ok: false, status: 404 })
  })

  it('404s when the parent review is missing', async () => {
    const r = await authorizeQuizItemAccess(
      qDeps({ getReview: async () => null }), 'Bearer good-token', 'item-1')
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it("403s when the review belongs to someone else — the IDOR case", async () => {
    const r = await authorizeQuizItemAccess(
      qDeps({ getUserFromToken: async () => ({ id: 'user-B' }) }), 'Bearer good-token', 'item-1')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('403s when the review has no owner', async () => {
    const r = await authorizeQuizItemAccess(
      qDeps({ getReview: async () => ({ ...REVIEW, user_id: '' }) }), 'Bearer good-token', 'item-1')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('succeeds for the owner and returns the item and review', async () => {
    const r = await authorizeQuizItemAccess(qDeps(), 'Bearer good-token', 'item-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.userId).toBe('user-A')
      expect(r.item.id).toBe('item-1')
      expect(r.review.lecture_id).toBe('lec-1')
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/auth.test.ts`
Expected: FAIL — `authorizeQuizItemAccess` is not exported.

- [ ] **Step 3: Implement the authorizer**

Append to `supabase/functions/_shared/auth.ts`:

```ts
export interface QuizItemRow {
  id: string
  review_id: string
  is_correct: boolean
  question_text: string
  question_type: string
  options: unknown
  student_answer: string | null
  correct_answer: string | null
}

export interface QuizReviewRow {
  id: string
  user_id: string
  lecture_id: string
}

export interface QuizAuthDeps {
  /** Resolve a user from the caller's OWN JWT. MUST NOT use the service-role key. */
  getUserFromToken(token: string): Promise<{ id: string } | null>
  /** May use service-role — ownership is checked after. */
  getItem(id: string): Promise<QuizItemRow | null>
  getReview(id: string): Promise<QuizReviewRow | null>
}

export type QuizAuthResult =
  | { ok: true; userId: string; item: QuizItemRow; review: QuizReviewRow }
  | { ok: false; status: 401 | 403 | 404; error: string }

/**
 * Identity → ownership → privileged work, walking item → review → owner.
 *
 * `itemId` comes straight off the request body. Nothing has checked it belongs
 * to the caller, so this must resolve the parent review and compare its owner
 * against the caller's own JWT before any service-role work happens. Skipping
 * that walk is how both of this repo's IDORs happened.
 */
export async function authorizeQuizItemAccess(
  deps: QuizAuthDeps,
  authHeader: string | null,
  itemId: string,
): Promise<QuizAuthResult> {
  if (!authHeader) return { ok: false, status: 401, error: 'missing authorization header' }

  const token = authHeader.trim().replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'malformed authorization header' }

  const user = await deps.getUserFromToken(token)
  if (!user) return { ok: false, status: 401, error: 'invalid or expired token' }
  if (!user.id) return { ok: false, status: 401, error: 'caller identity missing' }

  const item = await deps.getItem(itemId)
  if (!item) return { ok: false, status: 404, error: 'quiz item not found' }

  const review = await deps.getReview(item.review_id)
  if (!review) return { ok: false, status: 404, error: 'quiz review not found' }

  // Both ids must be real, non-empty strings before the comparison is trusted —
  // `'' !== ''` is false, so a defective deps implementation returning empty
  // strings on both sides would otherwise fall straight through.
  if (!review.user_id) return { ok: false, status: 403, error: 'quiz review has no owner' }
  if (review.user_id !== user.id) return { ok: false, status: 403, error: 'forbidden' }

  return { ok: true, userId: user.id, item, review }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/auth.test.ts`
Expected: PASS, including the pre-existing `authorizeLectureAccess` tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts
git commit -m "feat(auth): authorize quiz items by walking item to review to owner"
```

---

## Task 8: `parse-quiz` edge function

**Files:**
- Create: `supabase/functions/parse-quiz/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `authorizeLectureAccess` (Task 7's file), `buildParseInput`/`parseQuiz` (Task 5), `buildCorsHeaders`.
- Produces: HTTP endpoint `parse-quiz`. Request `{ lectureId, text? , imageBase64?, imageMediaType? }`. Response `200 { reviewId, itemCount, missCount, unreadable }`.

- [ ] **Step 1: Add the config entry**

Append to `supabase/config.toml`:

```toml
[functions.parse-quiz]
verify_jwt = true
import_map = "./functions/deno.json"

[functions.diagnose-miss]
verify_jwt = true
import_map = "./functions/deno.json"
```

Both entries are added now so the second function cannot be deployed later without one. **Without `import_map`, Deno cannot resolve `zod` and the function fails at boot** — Supabase does not auto-discover `deno.json`.

- [ ] **Step 2: Write the function**

Create `supabase/functions/parse-quiz/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@^0.120.0'
import { authorizeLectureAccess, type AuthResult } from '../_shared/auth.ts'
import { buildParseInput, parseQuiz } from '../_shared/quiz.ts'
import { buildCorsHeaders } from '../_shared/cors.ts'
import type { ImageMediaType } from '../_shared/claude.ts'

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
const cors = buildCorsHeaders(APP_ORIGIN)
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** ~5MB of image, expressed as base64 (which inflates by ~4/3). */
const MAX_IMAGE_BASE64_LENGTH = 7_000_000

const ALLOWED_MEDIA_TYPES: ImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

interface ParseRequest {
  lectureId?: string
  text?: string
  imageBase64?: string
  imageMediaType?: ImageMediaType
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let body: ParseRequest
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }

  const { lectureId, text, imageBase64, imageMediaType } = body
  if (!lectureId) return json(400, { error: 'lectureId is required' })
  if (!text && !imageBase64) return json(400, { error: 'Provide either quiz text or an image.' })
  if (text && imageBase64) return json(400, { error: 'Provide text or an image, not both.' })

  if (imageBase64) {
    if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return json(413, { error: 'That screenshot is larger than 5MB. Crop it or lower the resolution.' })
    }
    if (!imageMediaType || !ALLOWED_MEDIA_TYPES.includes(imageMediaType)) {
      return json(400, { error: `imageMediaType must be one of: ${ALLOWED_MEDIA_TYPES.join(', ')}` })
    }
  }

  // Identity → ownership → privileged work. Never reorder.
  let auth: AuthResult
  try {
    auth = await authorizeLectureAccess(
      {
        getUserFromToken: async (token) => {
          const scoped = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
          const { data } = await scoped.auth.getUser()
          return data.user ? { id: data.user.id } : null
        },
        getLecture: async (id) => {
          const { data } = await admin.from('lectures').select('*').eq('id', id).maybeSingle()
          return data ?? null
        },
      },
      req.headers.get('Authorization'),
      lectureId,
    )
  } catch (e) {
    // Nothing is in flight and no row has been written, so this returns a
    // proper CORS'd JSON 500 rather than letting Deno emit a bare, header-less
    // response the browser would report as an opaque CORS error.
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
  if (!auth.ok) return json(auth.status, { error: auth.error })

  // A lecture with no completed analysis has no claims and no distinctions, so
  // every diagnosis built from it would be ungrounded — the exact output this
  // feature exists to prevent. The UI hides the entry point in this case; this
  // is the server-side half of that guarantee.
  const { data: statusRow, error: statusErr } = await admin
    .from('lectures').select('processing_status').eq('id', lectureId).maybeSingle()
  if (statusErr) return json(500, { error: `Could not read lecture status: ${statusErr.message}` })
  if (statusRow?.processing_status !== 'completed') {
    return json(409, { error: 'This lecture has not finished analysis yet, so there is nothing to diagnose against.' })
  }

  // Parse FIRST, write second. A failed parse must leave no row behind —
  // a half-written review is worse than no review.
  let parsed
  try {
    const input = buildParseInput({ text, imageBase64, imageMediaType })
    parsed = await parseQuiz(new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! }), input)
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }

  const { data: review, error: reviewErr } = await admin.from('quiz_reviews').insert({
    lecture_id: lectureId,
    user_id: auth.userId,
    source: imageBase64 ? 'image' : 'text',
    // The screenshot itself is never stored — only pasted text is kept, so a
    // re-parse doesn't mean retyping the quiz.
    raw_input: text ?? null,
    quiz_title: parsed.quiz_title,
    score_correct: parsed.score_correct,
    score_total: parsed.score_total,
    status: 'awaiting_confirmation',
  }).select('id').single()
  if (reviewErr || !review) {
    return json(500, { error: `Could not save the quiz: ${reviewErr?.message ?? 'no row returned'}` })
  }

  if (parsed.items.length) {
    const { error: itemsErr } = await admin.from('quiz_review_items').insert(
      parsed.items.map((it) => ({
        review_id: review.id,
        position: it.position,
        question_text: it.question_text,
        question_type: it.question_type,
        options: it.options,
        student_answer: it.student_answer,
        correct_answer: it.correct_answer,
        is_correct: it.is_correct,
        // 'not-applicable' is distinct from 'pending' on purpose: "nothing to
        // diagnose here" and "not diagnosed yet" must never render alike.
        diagnosis_status: it.is_correct ? 'not-applicable' : 'pending',
      }))
    )
    if (itemsErr) {
      // Roll the parent back rather than leaving a review with no questions in it.
      await admin.from('quiz_reviews').delete().eq('id', review.id)
      return json(500, { error: `Could not save the quiz questions: ${itemsErr.message}` })
    }
  }

  return json(200, {
    reviewId: review.id,
    itemCount: parsed.items.length,
    missCount: parsed.items.filter((i) => !i.is_correct).length,
    unreadable: parsed.unreadable,
    // Returned so the confirm gate can show a reported-vs-parsed mismatch.
    // Never reconciled server-side: the disagreement is itself informative.
    scoreCorrect: parsed.score_correct,
    scoreTotal: parsed.score_total,
  })
})
```

- [ ] **Step 3: Deploy**

Run: `npx supabase functions deploy parse-quiz --project-ref hkqoesqiallwqbvuqgpp --use-api`
Expected: deployed, no boot error.

- [ ] **Step 4: Verify it rejects an anonymous caller**

Run:
```bash
curl -i -X POST https://hkqoesqiallwqbvuqgpp.supabase.co/functions/v1/parse-quiz \
  -H 'Content-Type: application/json' -d '{"lectureId":"00000000-0000-0000-0000-000000000000"}'
```
Expected: `401`.

**This proves auth only.** It proves nothing about CORS — that is verified in the browser in Task 13.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/parse-quiz/index.ts supabase/config.toml
git commit -m "feat(parse-quiz): structure a pasted or screenshotted quiz without diagnosing it"
```

---

## Task 9: `diagnose-miss` edge function

**Files:**
- Create: `supabase/functions/diagnose-miss/index.ts`

**Interfaces:**
- Consumes: `authorizeQuizItemAccess` (Task 7), `buildDiagnosisInput`/`diagnoseMiss` (Task 6), `verifyCitations` (Task 3).
- Produces: HTTP endpoint `diagnose-miss`. Request `{ itemId }`. Response `200 { status: 'completed', droppedCitations: number }`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/diagnose-miss/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@^0.120.0'
import { authorizeQuizItemAccess, type QuizAuthResult } from '../_shared/auth.ts'
import { buildDiagnosisInput, diagnoseMiss } from '../_shared/quiz.ts'
import { verifyCitations } from '../_shared/citations.ts'
import { buildCorsHeaders } from '../_shared/cors.ts'
import type { Claim, Distinction } from '../_shared/schemas.ts'

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
const cors = buildCorsHeaders(APP_ORIGIN)
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let itemId: string | undefined
  try {
    ;({ itemId } = await req.json())
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  if (!itemId) return json(400, { error: 'itemId is required' })

  // Identity → ownership → privileged work. `itemId` is client-supplied and
  // nothing has checked it belongs to the caller.
  let auth: QuizAuthResult
  try {
    auth = await authorizeQuizItemAccess(
      {
        getUserFromToken: async (token) => {
          const scoped = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
          const { data } = await scoped.auth.getUser()
          return data.user ? { id: data.user.id } : null
        },
        getItem: async (id) => {
          const { data } = await admin.from('quiz_review_items')
            .select('id, review_id, is_correct, question_text, question_type, options, student_answer, correct_answer')
            .eq('id', id).maybeSingle()
          return data ?? null
        },
        getReview: async (id) => {
          const { data } = await admin.from('quiz_reviews')
            .select('id, user_id, lecture_id').eq('id', id).maybeSingle()
          return data ?? null
        },
      },
      req.headers.get('Authorization'),
      itemId,
    )
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
  if (!auth.ok) return json(auth.status, { error: auth.error })

  // Diagnosing a question the student got right wastes their time and reads as
  // an accusation. This is a 400, not a silent no-op.
  if (auth.item.is_correct) {
    return json(400, { error: 'This question was answered correctly; there is nothing to diagnose.' })
  }

  const fail = async (message: string) => {
    await admin.from('quiz_review_items').update({
      diagnosis_status: 'failed',
      diagnosis_error: message.slice(0, 500),
    }).eq('id', itemId)
    return json(500, { error: message })
  }

  try {
    const { data: lecture, error: lecErr } = await admin.from('lectures')
      .select('title, transcript, claims, distinctions')
      .eq('id', auth.review.lecture_id).maybeSingle()
    if (lecErr) return await fail(`Could not load the lecture: ${lecErr.message}`)
    if (!lecture) {
      // The review as a whole cannot proceed — every remaining item would fail
      // the same way. This is the one case that marks the REVIEW failed rather
      // than just the item, so the UI stops offering a Retry that cannot work.
      await admin.from('quiz_reviews').update({
        status: 'failed',
        processing_error: 'The lecture this quiz belongs to has been deleted.',
      }).eq('id', auth.review.id)
      return await fail('The lecture this quiz belongs to no longer exists.')
    }

    const claims: Claim[] = Array.isArray(lecture.claims) ? lecture.claims : []
    const distinctions: Distinction[] = Array.isArray(lecture.distinctions) ? lecture.distinctions : []

    const { error: markErr } = await admin.from('quiz_review_items')
      .update({ diagnosis_status: 'diagnosing', diagnosis_error: null }).eq('id', itemId)
    if (markErr) return await fail(`Could not mark the question as diagnosing: ${markErr.message}`)

    const input = buildDiagnosisInput({
      question: {
        question_text: auth.item.question_text,
        question_type: auth.item.question_type,
        options: Array.isArray(auth.item.options) ? (auth.item.options as string[]) : [],
        student_answer: auth.item.student_answer,
        correct_answer: auth.item.correct_answer,
      },
      lecture: {
        title: lecture.title ?? undefined,
        transcript: lecture.transcript,
        claims,
        distinctions,
      },
    })

    const diagnosis = await diagnoseMiss(
      new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! }),
      input,
    )

    // Citations are VERIFIED, not trusted. Anything the model quoted that does
    // not actually appear in the transcript or in a stored claim is dropped
    // before it can be shown to a student who came here precisely because they
    // do not know the material well enough to catch it.
    const { verified, rejected } = verifyCitations(diagnosis.citations, {
      transcript: lecture.transcript,
      claimQuotes: claims.map((c) => c.quote),
    })

    // 'not-in-lecture' means there was nothing to cite. Enforced here rather
    // than trusted from the model: the schema allows an empty array, and this
    // makes the combination impossible instead of merely discouraged.
    const citations = diagnosis.lecture_coverage === 'not-in-lecture' ? [] : verified

    if (rejected.length) {
      console.warn(`diagnose-miss: dropped ${rejected.length} unverifiable citation(s) for item ${itemId}`)
    }

    const { error: saveErr } = await admin.from('quiz_review_items').update({
      diagnosis: { ...diagnosis, citations },
      confusion_tags: diagnosis.confusion_tags,
      lecture_coverage: diagnosis.lecture_coverage,
      diagnosis_status: 'completed',
      diagnosis_error: null,
    }).eq('id', itemId)
    if (saveErr) return await fail(`Could not save the diagnosis: ${saveErr.message}`)

    // Roll the parent review up. Done here rather than in the browser so that
    // closing the tab cannot strand a review in 'diagnosing' forever — the last
    // invocation to finish is the one that closes it out.
    const { data: outstanding, error: outErr } = await admin.from('quiz_review_items')
      .select('id').eq('review_id', auth.review.id).in('diagnosis_status', ['pending', 'diagnosing'])
    if (outErr) {
      // The diagnosis itself is saved; only the roll-up failed. Report it
      // rather than pretending, but do not mark the item failed.
      console.error('diagnose-miss: review roll-up failed', outErr)
    } else if (!outstanding?.length) {
      const { error: revErr } = await admin.from('quiz_reviews')
        .update({ status: 'completed' }).eq('id', auth.review.id)
      if (revErr) console.error('diagnose-miss: could not complete review', revErr)
    }

    return json(200, { status: 'completed', droppedCitations: rejected.length })
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e))
  }
})
```

- [ ] **Step 2: Deploy**

Run: `npx supabase functions deploy diagnose-miss --project-ref hkqoesqiallwqbvuqgpp --use-api`
Expected: deployed, no boot error.

- [ ] **Step 3: Verify it rejects an anonymous caller**

Run:
```bash
curl -i -X POST https://hkqoesqiallwqbvuqgpp.supabase.co/functions/v1/diagnose-miss \
  -H 'Content-Type: application/json' -d '{"itemId":"00000000-0000-0000-0000-000000000000"}'
```
Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/diagnose-miss/index.ts
git commit -m "feat(diagnose-miss): diagnose one missed question with code-verified citations"
```

---

## Task 10: Frontend types and the fan-out module

**Files:**
- Create: `src/lib/quiz/types.ts`, `src/lib/quiz/diagnose.ts`
- Test: `src/lib/quiz/diagnose.test.ts`

**Interfaces:**
- Consumes: nothing (deliberately no import from `_shared` — see Global Constraints).
- Produces: `diagnoseAll(itemIds, invoke, opts) => Promise<FanOutResult>`, `DEFAULT_CONCURRENCY`, and the `Diagnosis` / `QuizReview` / `QuizReviewItem` types the components use.

- [ ] **Step 1: Write the types**

Create `src/lib/quiz/types.ts`:

```ts
// These mirror supabase/functions/_shared/schemas.ts. They are duplicated
// rather than imported because tsconfig.app.json has "include": ["src"] and
// the _shared modules are Deno-flavoured (explicit .ts import extensions).
// If the schema changes, change this file with it.

export type ConfusionTag =
  | 'absolutizing-word'
  | 'collapsed-distinction'
  | 'answered-tone-not-claim'
  | 'wrong-category'
  | 'recall-gap'
  | 'judgment-under-tension'
  | 'misread-question'
  | 'careless'

export type LectureCoverage = 'covered' | 'partial' | 'not-in-lecture'

export interface Diagnosis {
  lecture_coverage: LectureCoverage
  correct_answer: string
  why_correct: string
  citations: { quote: string; supports: string }[]
  where_it_went_sideways: { confusion: string; explanation: string }[]
  collapsed_distinction: { this_: string; not_that: string } | null
  dont_overcorrect: string
  what_this_miss_was_not: string
  remember_this: string
  why_it_matters: string
  confusion_tags: ConfusionTag[]
}

export type DiagnosisStatus =
  | 'pending' | 'diagnosing' | 'completed' | 'failed' | 'not-applicable'

export interface QuizReviewItem {
  id: string
  review_id: string
  position: number
  question_text: string
  question_type: 'multiple_choice' | 'true_false' | 'short_answer'
  options: string[]
  student_answer: string | null
  correct_answer: string | null
  is_correct: boolean
  diagnosis: Diagnosis | null
  confusion_tags: ConfusionTag[]
  lecture_coverage: LectureCoverage | null
  diagnosis_status: DiagnosisStatus
  diagnosis_error: string | null
}

export interface QuizReview {
  id: string
  lecture_id: string
  user_id: string
  source: 'text' | 'image'
  raw_input: string | null
  quiz_title: string | null
  score_correct: number | null
  score_total: number | null
  status: 'awaiting_confirmation' | 'diagnosing' | 'completed' | 'failed'
  processing_error: string | null
  created_at: string
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/quiz/diagnose.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { diagnoseAll, DEFAULT_CONCURRENCY } from './diagnose'

const ok = async () => ({ error: null })

describe('diagnoseAll', () => {
  it('invokes once per item', async () => {
    const invoke = vi.fn(ok)
    const r = await diagnoseAll(['a', 'b', 'c'], invoke)
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(r.succeeded).toEqual(['a', 'b', 'c'])
    expect(r.failed).toEqual([])
  })

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0
    let peak = 0
    const invoke = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { error: null }
    })
    await diagnoseAll(['a', 'b', 'c', 'd', 'e', 'f', 'g'], invoke, { concurrency: 3 })
    expect(peak).toBeLessThanOrEqual(3)
    expect(invoke).toHaveBeenCalledTimes(7)
  })

  it('defaults to a cap of 3', () => {
    expect(DEFAULT_CONCURRENCY).toBe(3)
  })

  it('records a returned error WITHOUT counting it as a success', async () => {
    const invoke = vi.fn(async (id: string) =>
      id === 'b' ? { error: { message: 'Claude timed out' } } : { error: null })
    const r = await diagnoseAll(['a', 'b', 'c'], invoke)
    expect(r.succeeded).toEqual(['a', 'c'])
    expect(r.failed).toEqual([{ itemId: 'b', error: 'Claude timed out' }])
  })

  it('treats a thrown exception as a failure rather than losing it', async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('network down')
      return { error: null }
    })
    const r = await diagnoseAll(['a', 'b'], invoke)
    expect(r.succeeded).toEqual(['a'])
    expect(r.failed[0]).toEqual({ itemId: 'b', error: 'network down' })
  })

  it("does not let one item's failure stop its neighbours", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('boom')
      return { error: null }
    })
    const r = await diagnoseAll(['a', 'b', 'c'], invoke)
    expect(r.succeeded).toEqual(['b', 'c'])
    expect(r.failed).toHaveLength(1)
  })

  it('reports progress transitions for each item', async () => {
    const seen: [string, string][] = []
    await diagnoseAll(['a'], ok, { onProgress: (id, s) => seen.push([id, s]) })
    expect(seen).toEqual([['a', 'diagnosing'], ['a', 'completed']])
  })

  it('reports a failed transition on error', async () => {
    const seen: [string, string][] = []
    await diagnoseAll(['a'], async () => ({ error: { message: 'no' } }),
      { onProgress: (id, s) => seen.push([id, s]) })
    expect(seen).toEqual([['a', 'diagnosing'], ['a', 'failed']])
  })

  it('handles an empty list without invoking anything', async () => {
    const invoke = vi.fn(ok)
    expect(await diagnoseAll([], invoke)).toEqual({ succeeded: [], failed: [] })
    expect(invoke).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quiz/diagnose.test.ts`
Expected: FAIL — cannot resolve `./diagnose`.

- [ ] **Step 4: Implement the fan-out**

Create `src/lib/quiz/diagnose.ts`:

```ts
/**
 * Fans out one `diagnose-miss` invocation per missed question.
 *
 * The browser fans out rather than the edge function so each invocation stays
 * small and independent: per-question progress, per-question retry, and a
 * failure on one question that does not touch its neighbours. An internal
 * Promise.all in the function would be one round trip but one point of failure,
 * against a ~150s gateway limit.
 *
 * The invoker is injected so this module is testable without a DOM, a network,
 * or a Supabase client — the honesty branches below are exactly the ones this
 * codebase has historically got wrong.
 */

export type DiagnoseState = 'diagnosing' | 'completed' | 'failed'

/** Mirrors supabase-js's `functions.invoke` result: it RESOLVES with an error, it does not throw. */
export type DiagnoseInvoker = (itemId: string) => Promise<{ error: { message: string } | null }>

export interface FanOutResult {
  succeeded: string[]
  failed: { itemId: string; error: string }[]
}

export interface FanOutOptions {
  concurrency?: number
  onProgress?: (itemId: string, state: DiagnoseState) => void
}

/** Three at a time: enough to keep wall-clock near the slowest single miss, low enough not to trip the Anthropic rate limit. */
export const DEFAULT_CONCURRENCY = 3

export async function diagnoseAll(
  itemIds: string[],
  invoke: DiagnoseInvoker,
  opts: FanOutOptions = {},
): Promise<FanOutResult> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)
  const result: FanOutResult = { succeeded: [], failed: [] }

  let next = 0
  const worker = async (): Promise<void> => {
    while (next < itemIds.length) {
      const itemId = itemIds[next++]
      opts.onProgress?.(itemId, 'diagnosing')
      try {
        // supabase-js RESOLVES with { error }; it does not throw. Both paths
        // are handled — checking only one is the bug that shipped seven times.
        const { error } = await invoke(itemId)
        if (error) {
          result.failed.push({ itemId, error: error.message })
          opts.onProgress?.(itemId, 'failed')
        } else {
          result.succeeded.push(itemId)
          opts.onProgress?.(itemId, 'completed')
        }
      } catch (e) {
        result.failed.push({ itemId, error: e instanceof Error ? e.message : String(e) })
        opts.onProgress?.(itemId, 'failed')
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, itemIds.length) }, () => worker()),
  )

  return result
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quiz/diagnose.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck:shared`
Expected: all green; 0 shared errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/quiz/
git commit -m "feat(quiz): concurrency-capped diagnosis fan-out with per-item failure tracking"
```

---

## Task 11: The paste form and the confirm gate

The confirm gate is the honesty step. Everything downstream is built on the student having verified which answer was theirs.

**Files:**
- Create: `src/components/quiz/QuizPasteForm.tsx`, `src/components/quiz/ParsedQuizTable.tsx`

**Interfaces:**
- Consumes: `QuizReviewItem` from `src/lib/quiz/types.ts`.
- Produces:
  - `<QuizPasteForm onSubmit={(src: {text?: string; imageBase64?: string; imageMediaType?: string}) => Promise<void>} busy={boolean} />`
  - `<ParsedQuizTable items={QuizReviewItem[]} unreadable={string[]} onChange={(id, patch) => void} onConfirm={() => void} busy={boolean} />`

- [ ] **Step 1: Write the paste form**

Create `src/components/quiz/QuizPasteForm.tsx`:

```tsx
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
```

- [ ] **Step 2: Write the confirm gate**

Create `src/components/quiz/ParsedQuizTable.tsx`:

```tsx
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
```

- [ ] **Step 3: Verify the app typechecks**

Run: `npm run typecheck`
Expected: **12 errors, the pre-existing baseline.** None of them in `src/components/quiz/`. If the count is higher, fix the new errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/components/quiz/
git commit -m "feat(quiz-ui): paste form and the pre-diagnosis confirm gate"
```

---

## Task 12: The diagnosis card, the page, and wiring

**Files:**
- Create: `src/components/quiz/DiagnosisCard.tsx`, `src/pages/QuizReviewPage.tsx`
- Modify: `src/App.tsx`, `src/hooks/useNavigate.ts`, `src/pages/LectureDetailPage.tsx`

**Interfaces:**
- Consumes: `diagnoseAll` (Task 10), `QuizPasteForm`/`ParsedQuizTable` (Task 11), `parse-quiz`/`diagnose-miss` endpoints (Tasks 8–9).
- Produces: the `'quiz-review'` route, reachable from a lecture.

- [ ] **Step 1: Write the diagnosis card**

Create `src/components/quiz/DiagnosisCard.tsx`:

```tsx
import { AlertTriangle, Quote, RefreshCw, Loader2 } from 'lucide-react';
import type { QuizReviewItem } from '../../lib/quiz/types';

interface Props {
  item: QuizReviewItem;
  onRetry: (itemId: string) => void;
  busy: boolean;
}

export default function DiagnosisCard({ item, onRetry, busy }: Props) {
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

  const d = item.diagnosis;
  if (!d) return null;

  return (
    <div className="bg-white rounded-2xl shadow-md p-8 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900">
          Q{item.position}. {item.question_text}
        </h3>
        <p className="mt-2 text-sm">
          <span className="text-red-700 font-medium">You answered: {item.student_answer ?? '—'}</span>
          <span className="mx-2 text-gray-400">·</span>
          <span className="text-green-700 font-medium">Correct: {d.correct_answer}</span>
        </p>
      </div>

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
```

- [ ] **Step 2: Write the page**

Create `src/pages/QuizReviewPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNavigate } from '../hooks/useNavigate';
import QuizPasteForm, { type QuizSource } from '../components/quiz/QuizPasteForm';
import ParsedQuizTable from '../components/quiz/ParsedQuizTable';
import DiagnosisCard from '../components/quiz/DiagnosisCard';
import { diagnoseAll } from '../lib/quiz/diagnose';
import type { QuizReviewItem } from '../lib/quiz/types';

interface Props { lectureId: string }

export default function QuizReviewPage({ lectureId }: Props) {
  const navigate = useNavigate();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [items, setItems] = useState<QuizReviewItem[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [reportedScore, setReportedScore] = useState<{ correct: number | null; total: number | null }>({ correct: null, total: null });
  const [stage, setStage] = useState<'input' | 'confirm' | 'results'>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async (id: string) => {
    const { data, error: err } = await supabase
      .from('quiz_review_items').select('*').eq('review_id', id).order('position');
    if (err) { setError(`Could not load the quiz: ${err.message}`); return; }
    setItems((data ?? []) as QuizReviewItem[]);
  }, []);

  const handleParse = async (src: QuizSource) => {
    setBusy(true); setError(null);
    // functions.invoke RESOLVES with { error }; it does not throw.
    const { data, error: err } = await supabase.functions.invoke('parse-quiz', {
      body: { lectureId, ...src },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (!data?.reviewId) { setError('The quiz could not be read.'); return; }
    setReviewId(data.reviewId);
    setUnreadable(data.unreadable ?? []);
    setReportedScore({ correct: data.scoreCorrect ?? null, total: data.scoreTotal ?? null });
    await loadItems(data.reviewId);
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
        .then(({ error: e }) => ({ error: e ? { message: e.message } : null })),
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
        <ParsedQuizTable
          items={items} unreadable={unreadable} reportedScore={reportedScore}
          onChange={patchItem} busy={busy}
          onConfirm={() => void runDiagnosis(misses.map((m) => m.id))}
        />
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
```

- [ ] **Step 3: Wire the route**

In `src/hooks/useNavigate.ts`, add `'quiz-review'` to the `Page` union:

```ts
type Page = 'login' | 'dashboard' | 'upload' | 'classes' | 'class-notes' | 'lecture' | 'slide-viewer' | 'tutor' | 'update-password' | 'quiz-review';
```

In `src/App.tsx`, add it to the `Page` type (this union is duplicated in the two files — both must change), import the page, and add the case:

```tsx
import QuizReviewPage from './pages/QuizReviewPage';
```

```tsx
      case 'quiz-review':
        return pageId ? <QuizReviewPage lectureId={pageId} /> : <Dashboard />;
```

- [ ] **Step 4: Add the entry button**

In `src/pages/LectureDetailPage.tsx`, inside the `lecture.processing_status === 'completed'` branch — immediately after the opening `<>` of that branch, before the summary block — add:

```tsx
              <div className="bg-white rounded-2xl shadow-md p-6 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Got a question wrong?</h2>
                  <p className="text-sm text-gray-600">
                    Paste the quiz you took and find out why — quoted from this lecture.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('quiz-review', lectureId)}
                  className="shrink-0 bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-blue-700"
                >
                  Diagnose a quiz
                </button>
              </div>
```

It sits inside the `completed` branch on purpose: a lecture without a finished analysis has no `claims` to cite, and `parse-quiz` will 409 anyway.

- [ ] **Step 5: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: **12 typecheck errors, the pre-existing baseline** (none in new files); all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/quiz/DiagnosisCard.tsx src/pages/QuizReviewPage.tsx src/App.tsx src/hooks/useNavigate.ts src/pages/LectureDetailPage.tsx
git commit -m "feat(quiz-ui): diagnosis card, quiz review page, and routing"
```

---

## Task 13: Browser verification and the honesty test

Nothing above is verified. `curl` does not test CORS, and a perfect backend can still be unreachable from a browser. This task is where Phase 2 is either true or not.

**Files:** none — this is verification.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

After any dependency change the first boot takes ~60s while Vite re-optimizes, and `/` hangs until it finishes. That is expected, not the old deadlock.

- [ ] **Step 2: Verify the happy path end to end**

In a real browser, signed in as a real user:
1. Open a lecture whose analysis is `completed`.
2. Click **Diagnose a quiz**.
3. Paste the four questions from `~/hcli-school/weeks/week-01/quiz.md`, including the answers.
4. Confirm the parse table shows **your** answer and the **correct** answer the right way round.
5. Press Diagnose.

Expected: no CORS error in the console; each miss shows a diagnosis with a `remember_this` line; `where_it_went_sideways` names a specific confusion rather than restating the answer.

- [ ] **Step 3: Verify citations are real**

Pick a quote shown under "What the lecture actually said". Search for it in the lecture transcript (`lectures.transcript`) or in `lectures.claims`.

Expected: **it is there, verbatim.** If a quote appears that is not in the source, the verifier is broken — stop and fix Task 3 before going further.

- [ ] **Step 4: THE HONESTY TEST**

Take a lecture on one subject, and paste a quiz from a completely different subject.

Expected:
- every diagnosis has `lecture_coverage: 'not-in-lecture'`
- **zero citations** are shown
- the amber "Your lecture did not cover this" banner appears

**If it instead produces a confident, well-cited explanation, Phase 2 has failed** — however good the prose is. That is the same failure as the old pipeline generating 17 flashcards from a 14-second clip, and it is the only result here that matters.

- [ ] **Step 5: Verify the confirm gate catches a misparse**

Upload a screenshot where the selected answer is genuinely ambiguous (e.g. crop the tick marks out).

Expected: the affected fields come back null or are listed under "Some of this could not be read" — **not** guessed.

- [ ] **Step 6: Verify failure is honest**

Temporarily break the diagnosis path (e.g. set an invalid `ANTHROPIC_API_KEY` in the Supabase function secrets), then diagnose a quiz with 2+ misses.

Expected: per-item "diagnosis failed" cards with a readable reason and a working Retry; the header reads *"0 of N diagnosed · N failed"*; **no success message anywhere**. Restore the key afterwards and confirm Retry then succeeds.

- [ ] **Step 7: Verify the IDOR is closed**

From the browser console, signed in as user A, invoke `diagnose-miss` with an `itemId` belonging to user B:

```js
await window.supabase?.functions.invoke('diagnose-miss', { body: { itemId: '<user B item id>' } })
```

(If `supabase` is not on `window`, add a temporary import in the page during testing and remove it after.)

Expected: **403**. Anonymous/anon-key calls to both new functions: **401**.

- [ ] **Step 8: Update the handover**

Add Phase 2 to `HANDOVER.md`: the two new functions, the two new tables, the confirm gate, the citation verifier, and the honesty test — in the same voice as the Phase 1 sections.

- [ ] **Step 9: Final gates**

Run: `npm test && npm run typecheck:shared && npm run typecheck`
Expected: tests green, 0 shared errors, **12 app errors (baseline, unchanged)**.

- [ ] **Step 10: Commit**

```bash
git add HANDOVER.md
git commit -m "docs: record Phase 2 quiz-miss diagnosis in the handover"
```

---

## Notes for the executor

**Do not skip Task 13.** Every prior task's gate is a unit test or a typecheck. None of them prove the feature reaches a browser, that citations are real, or that the model says "I don't know" when it should. Those are the actual product guarantees.

**If a diagnosis reads well but cites nothing**, check `lecture_coverage` before assuming the verifier is broken — `'not-in-lecture'` producing zero citations is correct behaviour, not a bug.

**If every citation is being dropped**, the likely cause is `buildDiagnosisInput` paraphrasing claim quotes instead of passing them through verbatim. The verifier can only match what was actually in the prompt.
