# LectureLens Phase 1 — Claude Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead n8n/Gemini pipeline with two authenticated Supabase Edge Functions running on the Claude API, plus browser-side transcription, so that uploading a lecture actually produces real study material.

**Architecture:** Pure logic lives in `supabase/functions/_shared/*.ts` as plain TypeScript modules unit-tested by Vitest under Node. Each Edge Function `index.ts` is a thin Deno handler that wires those modules together — this keeps the testable surface off Deno entirely, since Deno is not installed. On the client, transcription sits behind a `Transcriber` interface with a lazily-imported browser-Whisper implementation. Lecture state is a status machine on the `lectures` row; the UI reads it over Supabase realtime.

**Tech Stack:** Vite 5 · React 18 · TypeScript 5.5 · Tailwind 3 · Supabase (Postgres + Edge Functions/Deno) · `@anthropic-ai/sdk` · `zod` · `@huggingface/transformers` (Whisper WASM/WebGPU) · Vitest 3

**Spec:** `docs/superpowers/specs/2026-08-19-lecturelens-claude-port-design.md`

**Recovered prior prompts:** `docs/superpowers/specs/recovered/n8n-prompts.md`

## Global Constraints

- **Model ID is exactly `claude-opus-5`.** Never append a date suffix. Never substitute a cheaper model.
- **`max_tokens: 16000`** on non-streaming calls. Never 300 — that default is what truncated the old pipeline.
- **Structured output uses `output_config: { format: zodOutputFormat(Schema) }`** on `client.messages.parse()`. Never the deprecated `output_format`. Never manual JSON parsing or code-fence stripping.
- **No assistant prefill.** Returns 400 on `claude-opus-5`.
- **No `thinking.budget_tokens`.** Returns 400 on `claude-opus-5`.
- **Auth order is absolute:** resolve the caller with their own JWT → check row ownership → only then use the service-role client. Never service-role first.
- **`ANTHROPIC_API_KEY` lives only in Supabase Edge Function secrets.** Never in `.env`, never `VITE_`-prefixed, never in the client bundle.
- **Schema changes are additive only.** No drops, no renames.
- **Never write a success message on a failed operation.** Every failure path writes `processing_status='failed'` plus `processing_error`, and the UI shows it.
- **Migrations in this repo do not describe production.** Verify against the live DB (project `hkqoesqiallwqbvuqgpp`) before assuming any column exists.
- **Node 24.13.0, npm 11.6.2.** Supabase CLI via `npx supabase` (not installed globally). Deno is NOT installed — no task may require it.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `vitest.config.ts` | Vitest setup, node environment, `src` + `supabase` roots |
| `supabase/config.toml` | Project link + per-function `verify_jwt` settings |
| `supabase/functions/_shared/schemas.ts` | Zod schemas for every Claude structured output |
| `supabase/functions/_shared/prompts.ts` | System prompts as exported string constants |
| `supabase/functions/_shared/claude.ts` | Claude client factory + `analyzeLecture()` |
| `supabase/functions/_shared/auth.ts` | `authorizeLectureAccess()` — JWT → ownership check |
| `supabase/functions/_shared/context.ts` | Tutor context assembly from lectures + history |
| `supabase/functions/_shared/*.test.ts` | Vitest unit tests for the above |
| `supabase/functions/analyze-lecture/index.ts` | Deno handler: dispatch by `file_type`, status machine |
| `src/lib/transcribe/index.ts` | `Transcriber` interface + factory |
| `src/lib/transcribe/browser.ts` | transformers.js Whisper implementation (lazy-loaded) |
| `src/lib/transcribe/*.test.ts` | Vitest tests for the interface/factory |
| `supabase/migrations/20260819210000_phase1_lecture_analysis_columns.sql` | The 7 new columns + status CHECK |

**Modified:**

| Path | Change |
|---|---|
| `package.json` | Add `test` script; add `@anthropic-ai/sdk`, `zod`, `@huggingface/transformers`, `vitest` |
| `vite.config.ts` | `manualChunks` so the Whisper loader splits out of the 906 KB bundle |
| `supabase/functions/ai-tutor/index.ts` | Delete all template generators; rewrite on Claude |
| `src/pages/UploadPage.tsx:134-243` | Transcribe → invoke `analyze-lecture` → honest failure states |
| `src/pages/TutorPage.tsx:281-306` | `functions.invoke('ai-tutor')`; remove the DOM-scrape at :288 |
| `src/components/GlobalChatWidget.tsx:81-93` | `functions.invoke('ai-tutor')` |
| `src/components/ScheduleUpload.tsx:89-104` | Disable trigger + confetti until Phase 3 |
| `src/pages/LectureDetailPage.tsx:260` | Un-stub `keyPoints`; render `failed` state |
| `src/lib/supabase.ts` | Extend the `Lecture` type with the new columns |

---

## Task 1: Test infrastructure

Nothing else in this plan can be verified without this. There are currently zero tests and no test runner.

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/__smoke__.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` (single run) and `npm run test:watch`. Every later task depends on these.

- [ ] **Step 1: Install the runner**

```bash
npm install -D vitest@^3
```

- [ ] **Step 2: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
    globals: false,
  },
})
```

- [ ] **Step 3: Add scripts to `package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing smoke test**

Create `src/lib/__smoke__.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS, 1 test. If the runner itself errors, fix that before continuing — every subsequent task assumes `npm test` works.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/__smoke__.test.ts
git commit -m "test: add vitest harness"
```

---

## Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20260819210000_phase1_lecture_analysis_columns.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `lectures.{key_points, important_terms, exam_questions, claims, distinctions, processing_error, transcript_source}` and an extended `processing_status` CHECK accepting `transcribing`, `transcribed`, `analyzing`.

> **Do NOT add `transcript`, `processed_at`, `ai_summary`, or `summary_overview`.** They already exist on the live table. Adding them will fail.

- [ ] **Step 1: Verify the current state before changing anything**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='lectures' ORDER BY ordinal_position;
```

Expected to be ABSENT: `key_points`, `important_terms`, `exam_questions`, `claims`, `distinctions`, `processing_error`, `transcript_source`.
Expected to be PRESENT: `transcript`, `processed_at`, `ai_summary`, `summary_overview`.

If that doesn't match, stop and reconcile — the spec's schema section is the reference.

- [ ] **Step 2: Write the migration**

```sql
/*
  # Phase 1 — lecture analysis columns

  Additive only. The old n8n pipeline PATCHed key_points / important_terms /
  exam_questions / flashcards onto `lectures`; none of those columns existed, so
  PostgREST returned 400 and n8n never checked the response. That — not the dead
  webhook — is why audio processing never completed.

  `claims` and `distinctions` exist for Phase 2 (quiz-miss diagnosis): a diagnosis
  must cite the lecture verbatim and name the distinction the student collapsed.
*/

ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS key_points        jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS important_terms   jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exam_questions    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS claims            jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS distinctions      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_error  text,
  ADD COLUMN IF NOT EXISTS transcript_source text;

ALTER TABLE lectures DROP CONSTRAINT IF EXISTS lectures_processing_status_check;
ALTER TABLE lectures ADD CONSTRAINT lectures_processing_status_check
  CHECK (processing_status IN
    ('pending','processing','transcribing','transcribed','analyzing','completed','failed'));

CREATE INDEX IF NOT EXISTS idx_lectures_status_updated
  ON lectures (processing_status, updated_at)
  WHERE processing_status IN ('transcribing','analyzing');
```

The partial index exists for the reaper in Task 11 — it only ever scans in-flight rows.

- [ ] **Step 3: Apply it**

Applying to the live database requires the user's explicit approval. Ask first, then apply via the Supabase MCP `apply_migration` tool or `npx supabase db push` if the project is linked.

- [ ] **Step 4: Verify it took**

```sql
SELECT count(*) AS new_cols FROM information_schema.columns
WHERE table_schema='public' AND table_name='lectures'
  AND column_name IN ('key_points','important_terms','exam_questions',
                      'claims','distinctions','processing_error','transcript_source');
```

Expected: `new_cols = 7`.

```sql
UPDATE lectures SET processing_status='analyzing' WHERE false;
```

Expected: `UPDATE 0` with no constraint error — proves the new CHECK accepts the new values.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260819210000_phase1_lecture_analysis_columns.sql
git commit -m "feat(db): add lecture analysis columns and extend status machine"
```

---

## Task 3: Output schemas

**Files:**
- Create: `supabase/functions/_shared/schemas.ts`
- Test: `supabase/functions/_shared/schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `LectureAnalysisSchema` (zod object), and the inferred type `LectureAnalysis`. Task 4 and Task 6 import both.

- [ ] **Step 1: Install zod**

```bash
npm install zod
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/_shared/schemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { LectureAnalysisSchema } from './schemas'

const valid = {
  summary_overview: 'A lecture about worldview.',
  key_points: ['Worldview shapes action'],
  important_terms: [{ term: 'Worldview', definition: 'The lens you interpret everything through' }],
  exam_questions: ['What four things does a worldview shape?'],
  flashcards: [{ front: 'What is a worldview?', back: 'The interpretive lens' }],
  claims: [{
    statement: 'Systems cannot transform people',
    quote: 'the law, weakened by the flesh, could not do',
    emphasis: 'flagged' as const,
    contested: false,
  }],
  distinctions: [{
    this_: 'transformation',
    not_that: 'behavior change',
    why_confusable: 'both produce visible differences in conduct',
  }],
}

describe('LectureAnalysisSchema', () => {
  it('accepts a well-formed analysis', () => {
    expect(LectureAnalysisSchema.parse(valid)).toEqual(valid)
  })

  it('accepts empty arrays — an unaddressed topic must not be invented', () => {
    const empty = { ...valid, claims: [], distinctions: [], flashcards: [], key_points: [], exam_questions: [], important_terms: [] }
    expect(() => LectureAnalysisSchema.parse(empty)).not.toThrow()
  })

  it('rejects an unknown emphasis value', () => {
    const bad = { ...valid, claims: [{ ...valid.claims[0], emphasis: 'very-important' }] }
    expect(() => LectureAnalysisSchema.parse(bad)).toThrow()
  })

  it('rejects a claim missing its quote', () => {
    const bad = { ...valid, claims: [{ statement: 'x', emphasis: 'passing', contested: false }] }
    expect(() => LectureAnalysisSchema.parse(bad)).toThrow()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- schemas`
Expected: FAIL — `Failed to resolve import "./schemas"`.

- [ ] **Step 4: Write the schema**

Create `supabase/functions/_shared/schemas.ts`:

```typescript
import { z } from 'zod'

/** One assertion the lecturer made, with the words they used. */
export const ClaimSchema = z.object({
  statement: z.string().describe('The claim, stated plainly.'),
  quote: z.string().describe("The lecturer's own words supporting it. Verbatim."),
  emphasis: z.enum(['stated-definition', 'repeated', 'flagged', 'passing'])
    .describe("'flagged' means the lecturer signalled it would be tested."),
  contested: z.boolean()
    .describe('True if other traditions, schools, or authorities hold this differently.'),
})

/** Two things the lecturer deliberately separated. Quiz traps live here. */
export const DistinctionSchema = z.object({
  this_: z.string().describe('The thing being asserted.'),
  not_that: z.string().describe('The thing it is being distinguished FROM.'),
  why_confusable: z.string().describe('Why a student would collapse the two.'),
})

export const LectureAnalysisSchema = z.object({
  summary_overview: z.string(),
  key_points: z.array(z.string()),
  important_terms: z.array(z.object({
    term: z.string(),
    definition: z.string().describe('As the LECTURE defined it, not a dictionary definition.'),
  })),
  exam_questions: z.array(z.string()),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  claims: z.array(ClaimSchema),
  distinctions: z.array(DistinctionSchema),
})

export type LectureAnalysis = z.infer<typeof LectureAnalysisSchema>
export type Claim = z.infer<typeof ClaimSchema>
export type Distinction = z.infer<typeof DistinctionSchema>
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- schemas`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/schemas.ts supabase/functions/_shared/schemas.test.ts package.json package-lock.json
git commit -m "feat(shared): add lecture analysis output schema"
```

---

## Task 4: System prompts

**Files:**
- Create: `supabase/functions/_shared/prompts.ts`
- Test: `supabase/functions/_shared/prompts.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `LECTURE_ANALYST_SYSTEM: string` and `TUTOR_SYSTEM: string`. Tasks 6 and 9 import them.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { LECTURE_ANALYST_SYSTEM, TUTOR_SYSTEM } from './prompts'

describe('LECTURE_ANALYST_SYSTEM', () => {
  it('forbids invention — the single most important instruction', () => {
    expect(LECTURE_ANALYST_SYSTEM.toLowerCase()).toContain('do not invent')
  })
  it('requires verbatim quotes', () => {
    expect(LECTURE_ANALYST_SYSTEM.toLowerCase()).toContain('verbatim')
  })
  it('asks for distinctions', () => {
    expect(LECTURE_ANALYST_SYSTEM.toLowerCase()).toContain('distinction')
  })
  it('has no unreplaced template markers', () => {
    expect(LECTURE_ANALYST_SYSTEM).not.toMatch(/\{\{|\$\{|undefined/)
  })
})

describe('TUTOR_SYSTEM', () => {
  it('has no unreplaced template markers (the old prompt shipped "provided in undefined")', () => {
    expect(TUTOR_SYSTEM).not.toMatch(/\{\{|\$\{|undefined/)
  })
  it('forbids answering beyond the provided context', () => {
    expect(TUTOR_SYSTEM.toLowerCase()).toContain('do not invent')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- prompts`
Expected: FAIL — cannot resolve `./prompts`.

- [ ] **Step 3: Write the prompts**

Create `supabase/functions/_shared/prompts.ts`:

```typescript
export const LECTURE_ANALYST_SYSTEM = `You are analyzing a lecture to build study material a student will be quizzed on.

Your output is not a summary for its own sake. It is the evidence base a tutor will later use to explain to a specific student why a specific quiz answer was wrong. That purpose changes what matters.

PRESERVE THE LECTURER'S OWN WORDS.
Every claim carries a verbatim quote. A later explanation must be able to cite what was actually said, not your paraphrase of it. If you cannot quote it, it is not a claim.

CAPTURE EMPHASIS.
What was repeated, stated as a definition, or flagged as important ("this will be on the test", "the key thing here") is disproportionately likely to be tested. Mark each claim:
- "stated-definition" — the lecturer defined a term
- "repeated" — said more than once
- "flagged" — explicitly signalled as important or testable
- "passing" — mentioned once, in passing

CAPTURE DISTINCTIONS.
Wherever the lecturer separates two things that are easily confused — "X is not Y", "the difference between A and B", "people think this means X, but" — record both sides and why they get confused. Quiz questions are built on exactly these seams, and a student's wrong answer usually means a distinction collapsed. This is the highest-value thing you produce.

MARK WHAT IS CONTESTED.
If the lecturer presents a position that other traditions, schools, or authorities hold differently, set contested=true. A student needs to know when they are learning THIS COURSE'S position rather than a settled fact.

DEFINE TERMS AS THE LECTURE DEFINED THEM.
Not as a dictionary would. If the lecture uses a word in a narrower or idiosyncratic sense, that sense is the definition.

DO NOT INVENT.
If the lecture does not address something, return an empty array for that field. Absent study material is recoverable; fabricated study material gets studied and believed. Never pad a list to reach a count. Never write a flashcard whose answer is not in the source. Never write an exam question about material the lecture did not cover.`

export const TUTOR_SYSTEM = `You are a tutor helping a student understand their own course material.

Answer only from the lecture context provided in this conversation. Do not invent facts. If the context does not contain the answer, say so plainly and say what it does cover instead — a student misled by a confident wrong answer is worse off than one told "that wasn't in this lecture".

Cite what the lecture actually said when you can, using its words.

When the student's question reveals a confusion between two things, name the confusion directly rather than only supplying the correct answer. Knowing WHY an answer is wrong transfers; knowing THAT it is wrong does not.

If the material is one position among several held by different traditions or schools, say so, and say which one this course teaches.

Be concise and concrete. Use short paragraphs or lists. Do not pad.`
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- prompts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/prompts.ts supabase/functions/_shared/prompts.test.ts
git commit -m "feat(shared): add lecture analyst and tutor system prompts"
```

---

## Task 5: Authorization helper

This is the fix for the audit's CRITICAL finding — both existing Edge Functions use the service-role key and never identify the caller.

**Files:**
- Create: `supabase/functions/_shared/auth.ts`
- Test: `supabase/functions/_shared/auth.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type AuthResult = { ok: true; userId: string; lecture: LectureRow } | { ok: false; status: 401 | 403 | 404; error: string }`
  - `authorizeLectureAccess(deps: AuthDeps, authHeader: string | null, lectureId: string): Promise<AuthResult>`
  - `AuthDeps = { getUserFromToken(token: string): Promise<{ id: string } | null>; getLecture(id: string): Promise<LectureRow | null> }`

Dependencies are injected so this is testable under Node without Supabase or Deno.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { authorizeLectureAccess, type AuthDeps } from './auth'

const LECTURE = { id: 'lec-1', user_id: 'user-A', file_type: 'audio', transcript: 'x', file_url: '' }

const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
  getUserFromToken: async (t) => (t === 'good-token' ? { id: 'user-A' } : null),
  getLecture: async (id) => (id === 'lec-1' ? (LECTURE as never) : null),
  ...over,
})

describe('authorizeLectureAccess', () => {
  it('401s with no Authorization header', async () => {
    const r = await authorizeLectureAccess(deps(), null, 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('401s on an invalid token', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer bad-token', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('404s when the lecture does not exist', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer good-token', 'nope')
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it("403s when the lecture belongs to someone else", async () => {
    const r = await authorizeLectureAccess(
      deps({ getUserFromToken: async () => ({ id: 'user-B' }) }),
      'Bearer good-token', 'lec-1')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('succeeds for the owner and returns the row', async () => {
    const r = await authorizeLectureAccess(deps(), 'Bearer good-token', 'lec-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.userId).toBe('user-A')
      expect(r.lecture.id).toBe('lec-1')
    }
  })

  it('accepts a bare token without the Bearer prefix', async () => {
    const r = await authorizeLectureAccess(deps(), 'good-token', 'lec-1')
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- auth`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Write the helper**

Create `supabase/functions/_shared/auth.ts`:

```typescript
export interface LectureRow {
  id: string
  user_id: string
  file_type: string | null
  transcript: string | null
  file_url: string | null
  title?: string
}

export interface AuthDeps {
  /** Resolve a user from the caller's own JWT. MUST NOT use the service-role key. */
  getUserFromToken(token: string): Promise<{ id: string } | null>
  /** Load the lecture. May use service-role — ownership is checked after. */
  getLecture(id: string): Promise<LectureRow | null>
}

export type AuthResult =
  | { ok: true; userId: string; lecture: LectureRow }
  | { ok: false; status: 401 | 403 | 404; error: string }

/**
 * Identity first, ownership second, privileged work third.
 * The previous implementation went straight to service-role and never asked who
 * was calling, which let anyone pass another user's lectureId.
 */
export async function authorizeLectureAccess(
  deps: AuthDeps,
  authHeader: string | null,
  lectureId: string,
): Promise<AuthResult> {
  if (!authHeader) return { ok: false, status: 401, error: 'missing authorization header' }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'malformed authorization header' }

  const user = await deps.getUserFromToken(token)
  if (!user) return { ok: false, status: 401, error: 'invalid or expired token' }

  const lecture = await deps.getLecture(lectureId)
  if (!lecture) return { ok: false, status: 404, error: 'lecture not found' }

  if (lecture.user_id !== user.id) return { ok: false, status: 403, error: 'forbidden' }

  return { ok: true, userId: user.id, lecture }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- auth`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts
git commit -m "feat(shared): add JWT + ownership authorization helper"
```

---

## Task 6: Claude analysis module

**Files:**
- Create: `supabase/functions/_shared/claude.ts`
- Test: `supabase/functions/_shared/claude.test.ts`

**Interfaces:**
- Consumes: `LectureAnalysisSchema` (Task 3), `LECTURE_ANALYST_SYSTEM` (Task 4)
- Produces:
  - `buildAnalysisInput(lecture: {file_type, transcript, pdfBase64?}): ContentBlock[]`
  - `analyzeLecture(client: ClaudeLike, input: ContentBlock[]): Promise<LectureAnalysis>`
  - `type ClaudeLike = { messages: { parse(args: unknown): Promise<{ parsed_output: unknown }> } }`

`ClaudeLike` is a structural type so tests can pass a fake without network access or an API key.

- [ ] **Step 1: Install the SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/_shared/claude.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildAnalysisInput, analyzeLecture, MODEL, MAX_TOKENS } from './claude'

const ANALYSIS = {
  summary_overview: 's', key_points: [], important_terms: [],
  exam_questions: [], flashcards: [], claims: [], distinctions: [],
}

describe('buildAnalysisInput', () => {
  it('sends a transcript as a text block for audio', () => {
    const blocks = buildAnalysisInput({ file_type: 'audio', transcript: 'hello lecture' })
    expect(blocks).toEqual([{ type: 'text', text: 'hello lecture' }])
  })

  it('treats video the same as audio — it fell off the old n8n switch entirely', () => {
    const blocks = buildAnalysisInput({ file_type: 'video', transcript: 'hello lecture' })
    expect(blocks).toEqual([{ type: 'text', text: 'hello lecture' }])
  })

  it('sends slides as a PDF document block, not extracted text', () => {
    const blocks = buildAnalysisInput({ file_type: 'slides', transcript: null, pdfBase64: 'JVBER' })
    expect(blocks[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' },
    })
  })

  it('throws when audio has no transcript rather than sending an empty prompt', () => {
    expect(() => buildAnalysisInput({ file_type: 'audio', transcript: '' }))
      .toThrow(/transcript/i)
  })

  it('throws on an unknown file_type instead of silently producing nothing', () => {
    expect(() => buildAnalysisInput({ file_type: 'zip', transcript: 'x' }))
      .toThrow(/file_type/i)
  })
})

describe('analyzeLecture', () => {
  it('calls Claude with the pinned model and token ceiling', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: ANALYSIS })
    await analyzeLecture({ messages: { parse } }, [{ type: 'text', text: 'x' }])

    const args = parse.mock.calls[0][0] as Record<string, unknown>
    expect(args.model).toBe('claude-opus-5')
    expect(args.max_tokens).toBe(16000)
    expect(args).toHaveProperty('output_config')
    expect(args).not.toHaveProperty('output_format')   // deprecated
    expect(args).not.toHaveProperty('thinking')        // budget_tokens 400s on opus-5
  })

  it('returns the validated parsed_output', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: ANALYSIS })
    const out = await analyzeLecture({ messages: { parse } }, [{ type: 'text', text: 'x' }])
    expect(out).toEqual(ANALYSIS)
  })

  it('throws when parsed_output is null instead of writing garbage to the DB', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: null })
    await expect(analyzeLecture({ messages: { parse } }, [{ type: 'text', text: 'x' }]))
      .rejects.toThrow(/structured output/i)
  })

  it('exports the pinned constants', () => {
    expect(MODEL).toBe('claude-opus-5')
    expect(MAX_TOKENS).toBe(16000)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- claude`
Expected: FAIL — cannot resolve `./claude`.

- [ ] **Step 4: Write the module**

Create `supabase/functions/_shared/claude.ts`:

```typescript
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { LectureAnalysisSchema, type LectureAnalysis } from './schemas'
import { LECTURE_ANALYST_SYSTEM } from './prompts'

export const MODEL = 'claude-opus-5'
export const MAX_TOKENS = 16000

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

/** Structural type so tests can inject a fake with no API key and no network. */
export interface ClaudeLike {
  messages: { parse(args: unknown): Promise<{ parsed_output: unknown }> }
}

export function buildAnalysisInput(lecture: {
  file_type: string | null
  transcript: string | null
  pdfBase64?: string
}): ContentBlock[] {
  const kind = (lecture.file_type ?? 'audio').toLowerCase().trim()

  if (kind === 'audio' || kind === 'video') {
    if (!lecture.transcript?.trim()) {
      throw new Error('No transcript available for this lecture; cannot analyze audio/video.')
    }
    return [{ type: 'text', text: lecture.transcript }]
  }

  if (kind === 'slides') {
    if (!lecture.pdfBase64) throw new Error('No PDF data available for slides lecture.')
    return [{
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: lecture.pdfBase64 },
    }]
  }

  throw new Error(`Unsupported file_type: ${kind}`)
}

export async function analyzeLecture(
  client: ClaudeLike,
  input: ContentBlock[],
): Promise<LectureAnalysis> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: LECTURE_ANALYST_SYSTEM,
    messages: [{ role: 'user', content: input }],
    output_config: { format: zodOutputFormat(LectureAnalysisSchema) },
  })

  if (!res.parsed_output) {
    throw new Error('Claude returned no structured output (parsed_output was null).')
  }
  return LectureAnalysisSchema.parse(res.parsed_output)
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- claude`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/claude.ts supabase/functions/_shared/claude.test.ts package.json package-lock.json
git commit -m "feat(shared): add Claude lecture analysis module"
```

---

## Task 7: `analyze-lecture` Edge Function

Thin Deno handler. All logic under test already; this wires it.

**Files:**
- Create: `supabase/functions/analyze-lecture/index.ts`
- Create: `supabase/config.toml`

**Interfaces:**
- Consumes: `authorizeLectureAccess` (5), `buildAnalysisInput`/`analyzeLecture` (6)
- Produces: `POST /functions/v1/analyze-lecture` with body `{ lectureId: string }`, returning `200 {status:'completed'}` or `{4xx,5xx} {error}`

- [ ] **Step 1: Write `supabase/config.toml`**

```toml
project_id = "hkqoesqiallwqbvuqgpp"

[functions.analyze-lecture]
verify_jwt = true

[functions.ai-tutor]
verify_jwt = true

[functions.process-slides]
verify_jwt = true
```

`process-slides` is currently `verify_jwt = false` — a public service-role write endpoint. This closes it.

- [ ] **Step 2: Write the handler**

Create `supabase/functions/analyze-lecture/index.ts`:

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { authorizeLectureAccess } from '../_shared/auth.ts'
import { buildAnalysisInput, analyzeLecture } from '../_shared/claude.ts'

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
const cors = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let lectureId: string | undefined
  try {
    ;({ lectureId } = await req.json())
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  if (!lectureId) return json(400, { error: 'lectureId is required' })

  // Identity → ownership → privileged work. Never reorder.
  const auth = await authorizeLectureAccess(
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
  if (!auth.ok) return json(auth.status, { error: auth.error })

  const fail = async (message: string) => {
    await admin.from('lectures').update({
      processing_status: 'failed',
      processing_error: message.slice(0, 500),
    }).eq('id', lectureId)
    return json(500, { error: message })
  }

  try {
    await admin.from('lectures')
      .update({ processing_status: 'analyzing', processing_error: null })
      .eq('id', lectureId)

    let pdfBase64: string | undefined
    if ((auth.lecture.file_type ?? '').toLowerCase() === 'slides') {
      const path = new URL(auth.lecture.file_url!).pathname
        .split('/lecture-uploads/')[1]
      const { data: blob, error } = await admin.storage.from('lecture-uploads').download(path)
      if (error || !blob) return await fail(`Could not download slides: ${error?.message ?? 'not found'}`)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      pdfBase64 = btoa(bin)
    }

    const input = buildAnalysisInput({ ...auth.lecture, pdfBase64 })
    const analysis = await analyzeLecture(
      new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! }),
      input,
    )

    // Write to `lectures` — it is the ONLY table in the realtime publication.
    const { error: upErr } = await admin.from('lectures').update({
      summary_overview: analysis.summary_overview,
      key_points: analysis.key_points,
      important_terms: analysis.important_terms,
      exam_questions: analysis.exam_questions,
      claims: analysis.claims,
      distinctions: analysis.distinctions,
      processing_status: 'completed',
      processing_error: null,
      processed_at: new Date().toISOString(),
    }).eq('id', lectureId)
    if (upErr) return await fail(`Could not save analysis: ${upErr.message}`)

    if (analysis.flashcards.length) {
      await admin.from('flashcards').insert(analysis.flashcards.map((f) => ({
        lecture_id: lectureId, user_id: auth.userId,
        question: f.front, answer: f.back,
        difficulty: 'medium', is_auto_generated: true,
      })))
    }
    if (analysis.important_terms.length) {
      await admin.from('key_terms').insert(analysis.important_terms.map((t) => ({
        lecture_id: lectureId, term: t.term, definition: t.definition,
      })))
    }

    return json(200, { status: 'completed' })
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e))
  }
})
```

- [ ] **Step 3: Set the secret**

```bash
npx supabase secrets set ANTHROPIC_API_KEY=<key> --project-ref hkqoesqiallwqbvuqgpp
npx supabase secrets set APP_ORIGIN=<deployed app origin> --project-ref hkqoesqiallwqbvuqgpp
```

Never put this key in `.env` — anything `VITE_`-prefixed ships in the browser bundle.

- [ ] **Step 4: Verify the shared modules still typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS. `typecheck` will still report the 10 pre-existing unused-variable errors and the 2 `Dashboard.tsx` errors — those are fixed in Task 10. **No NEW errors may appear in `supabase/functions/_shared/`.**

- [ ] **Step 5: Deploy — requires user approval**

```bash
npx supabase functions deploy analyze-lecture --project-ref hkqoesqiallwqbvuqgpp
```

- [ ] **Step 6: Verify authorization actually rejects**

With the anon key rather than a user JWT:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://hkqoesqiallwqbvuqgpp.supabase.co/functions/v1/analyze-lecture" \
  -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"lectureId":"00000000-0000-0000-0000-000000000000"}'
```

Expected: `401`. **If this returns 200 or 500, stop — the auth ordering is wrong.**

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/analyze-lecture/index.ts supabase/config.toml
git commit -m "feat(functions): add authenticated analyze-lecture on Claude"
```

---

## Task 8: Browser transcription

**Files:**
- Create: `src/lib/transcribe/index.ts`
- Create: `src/lib/transcribe/browser.ts`
- Test: `src/lib/transcribe/index.test.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface Transcriber { name: string; transcribe(file: File, onProgress: (p: number) => void): Promise<string> }`
  - `getTranscriber(): Promise<Transcriber>` — dynamically imports the browser impl
  - `isTranscribable(file: File): boolean`

- [ ] **Step 1: Install**

```bash
npm install @huggingface/transformers
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/transcribe/index.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { isTranscribable, getTranscriber, __setTranscriberLoader } from './index'

const file = (type: string, name = 'x') => ({ type, name }) as File

describe('isTranscribable', () => {
  it('accepts audio', () => expect(isTranscribable(file('audio/mpeg'))).toBe(true))
  it('accepts video', () => expect(isTranscribable(file('video/mp4'))).toBe(true))
  it('rejects PDFs — slides go straight to Claude', () =>
    expect(isTranscribable(file('application/pdf'))).toBe(false))
})

describe('getTranscriber', () => {
  it('lazily loads the implementation so Whisper stays out of the main bundle', async () => {
    const loader = vi.fn().mockResolvedValue({
      name: 'fake', transcribe: async () => 'text',
    })
    __setTranscriberLoader(loader)
    expect(loader).not.toHaveBeenCalled()   // not loaded at import time
    const t = await getTranscriber()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(t.name).toBe('fake')
  })

  it('caches the loaded transcriber across calls', async () => {
    const loader = vi.fn().mockResolvedValue({ name: 'fake', transcribe: async () => '' })
    __setTranscriberLoader(loader)
    await getTranscriber(); await getTranscriber()
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- transcribe`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 4: Write the interface**

Create `src/lib/transcribe/index.ts`:

```typescript
export interface Transcriber {
  /** Stored in lectures.transcript_source so a later provider swap can re-run selectively. */
  name: string
  transcribe(file: File, onProgress: (pct: number) => void): Promise<string>
}

export function isTranscribable(file: File): boolean {
  return file.type.startsWith('audio/') || file.type.startsWith('video/')
}

type Loader = () => Promise<Transcriber>

let loader: Loader = async () => (await import('./browser')).createBrowserTranscriber()
let cached: Transcriber | null = null

/** Test seam. Not for production use. */
export function __setTranscriberLoader(l: Loader) { loader = l; cached = null }

export async function getTranscriber(): Promise<Transcriber> {
  if (!cached) cached = await loader()
  return cached
}
```

- [ ] **Step 5: Write the browser implementation**

Create `src/lib/transcribe/browser.ts`:

```typescript
import type { Transcriber } from './index'

/**
 * Whisper via transformers.js. Prefers WebGPU (near real-time); falls back to
 * WASM CPU, which is markedly slower on long files. Model weights (~40-150MB)
 * are fetched once at runtime and cached by the browser — never bundled.
 */
export function createBrowserTranscriber(): Transcriber {
  return {
    name: 'browser-whisper',
    async transcribe(file, onProgress) {
      const { pipeline } = await import('@huggingface/transformers')

      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
      onProgress(5)

      const asr = await pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-base.en',
        {
          device: hasWebGPU ? 'webgpu' : 'wasm',
          progress_callback: (p: { status: string; progress?: number }) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
              onProgress(5 + p.progress * 0.35)   // model download = 5%..40%
            }
          },
        },
      )
      onProgress(40)

      const audioCtx = new AudioContext({ sampleRate: 16000 })
      const decoded = await audioCtx.decodeAudioData(await file.arrayBuffer())
      const samples = decoded.getChannelData(0)
      onProgress(50)

      const out = await asr(samples, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      })
      onProgress(100)

      const text = Array.isArray(out)
        ? out.map((o) => (o as { text: string }).text).join(' ')
        : (out as { text: string }).text

      if (!text?.trim()) throw new Error('Transcription produced no text.')
      return text.trim()
    },
  }
}
```

- [ ] **Step 6: Split the bundle**

Modify `vite.config.ts` — add to `build.rollupOptions.output`:

```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        transformers: ['@huggingface/transformers'],
      },
    },
  },
},
```

The current build emits one 906 KB chunk; without this the Whisper loader is unconditionally downloaded by every visitor.

- [ ] **Step 7: Run the tests and build**

Run: `npm test -- transcribe`
Expected: PASS, 5 tests.

Run: `npm run build`
Expected: SUCCESS, and a **separate `transformers` chunk** in the output listing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/transcribe vite.config.ts package.json package-lock.json
git commit -m "feat(transcribe): add pluggable browser Whisper transcription"
```

---

## Task 9: Rewire UploadPage

**Files:**
- Modify: `src/pages/UploadPage.tsx:134-243`
- Modify: `src/lib/supabase.ts` (Lecture type)

**Interfaces:**
- Consumes: `getTranscriber`, `isTranscribable` (8); `analyze-lecture` (7)
- Produces: no exports; user-visible honest status

- [ ] **Step 1: Extend the Lecture type**

In `src/lib/supabase.ts`, add to the `Lecture` interface:

```typescript
  transcript?: string | null
  transcript_source?: string | null
  key_points?: string[]
  important_terms?: { term: string; definition: string }[]
  exam_questions?: string[]
  claims?: { statement: string; quote: string; emphasis: string; contested: boolean }[]
  distinctions?: { this_: string; not_that: string; why_confusable: string }[]
  processing_error?: string | null
  processed_at?: string | null
```

- [ ] **Step 2: Replace the n8n block**

In `src/pages/UploadPage.tsx`, delete lines 201-223 (the `fetch` to `n8n-e2ph.onrender.com` and its swallowing `try/catch`) and replace with:

```typescript
      // Transcribe in the browser for audio/video. Slides go straight to Claude.
      if (isTranscribable(file)) {
        await supabase.from('lectures')
          .update({ processing_status: 'transcribing' }).eq('id', lecture.id)

        const transcriber = await getTranscriber()
        const transcript = await transcriber.transcribe(file, (pct) =>
          setUploadProgress(60 + pct * 0.25))          // transcription = 60%..85%

        const { error: tErr } = await supabase.from('lectures').update({
          transcript,
          transcript_source: transcriber.name,
          processing_status: 'transcribed',
        }).eq('id', lecture.id)
        if (tErr) throw new Error(`Could not save transcript: ${tErr.message}`)
      }

      setUploadProgress(90)

      const { error: fnError } = await supabase.functions.invoke('analyze-lecture', {
        body: { lectureId: lecture.id },
      })
      if (fnError) throw new Error(`AI analysis failed to start: ${fnError.message}`)
```

- [ ] **Step 3: Make the failure path honest**

The existing `catch` must stop reporting success. Ensure it reads:

```typescript
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      if (uploadedLectureId) {
        await supabase.from('lectures').update({
          processing_status: 'failed', processing_error: message.slice(0, 500),
        }).eq('id', uploadedLectureId)
      }
      setUploadStatus('error')
      setToast({ message: `❌ ${message}`, type: 'error' })
    }
```

Delete the unconditional success toast. It currently fires even when the trigger throws — the single most dishonest surface in the app.

- [ ] **Step 4: Add the imports**

```typescript
import { getTranscriber, isTranscribable } from '../lib/transcribe'
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run build`
Expected: tests PASS, build SUCCEEDS.

Run: `grep -rn 'n8n-e2ph' src/pages/UploadPage.tsx`
Expected: **no matches.**

- [ ] **Step 6: Commit**

```bash
git add src/pages/UploadPage.tsx src/lib/supabase.ts
git commit -m "feat(upload): transcribe in browser, invoke analyze-lecture, report failures honestly"
```

---

## Task 10: Rewrite `ai-tutor`

**Files:**
- Modify: `supabase/functions/ai-tutor/index.ts` (replace lines 168-255 entirely)
- Create: `supabase/functions/_shared/context.ts`
- Test: `supabase/functions/_shared/context.test.ts`
- Modify: `src/pages/TutorPage.tsx:281-306`, `src/components/GlobalChatWidget.tsx:81-93`

**Interfaces:**
- Consumes: `TUTOR_SYSTEM` (4)
- Produces: `buildTutorContext(input): string`; `POST /functions/v1/ai-tutor` returning `{ answer: string }` (shape preserved — callers unchanged)

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildTutorContext } from './context'

const lecture = {
  title: 'Worldview', summary_overview: 'A lecture.',
  transcript: 'Systems cannot transform people.',
}

describe('buildTutorContext', () => {
  it('includes lecture title and summary', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: null })
    expect(c).toContain('Worldview')
    expect(c).toContain('A lecture.')
  })

  it('includes the transcript — the old pipeline never stored one', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: null })
    expect(c).toContain('Systems cannot transform people.')
  })

  it('says so plainly when there is no lecture content', () => {
    const c = buildTutorContext({ lectures: [], assignmentPrompt: null })
    expect(c).toMatch(/no lecture content/i)
  })

  it('includes the assignment rubric when present', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: 'Write 500 words.' })
    expect(c).toContain('Write 500 words.')
  })

  it('omits the assignment section entirely when absent', () => {
    const c = buildTutorContext({ lectures: [lecture], assignmentPrompt: null })
    expect(c).not.toContain('ASSIGNMENT')
  })

  it('never emits the literal "undefined" (the deployed prompt shipped that bug)', () => {
    const c = buildTutorContext({
      lectures: [{ title: 'T', summary_overview: null, transcript: null }],
      assignmentPrompt: null,
    })
    expect(c).not.toContain('undefined')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- context`
Expected: FAIL — cannot resolve `./context`.

- [ ] **Step 3: Write the module**

Create `supabase/functions/_shared/context.ts`:

```typescript
export interface ContextLecture {
  title: string | null
  summary_overview: string | null
  transcript: string | null
}

export function buildTutorContext(input: {
  lectures: ContextLecture[]
  assignmentPrompt: string | null
}): string {
  const parts: string[] = []

  if (input.lectures.length === 0) {
    parts.push('(No lecture content is available for this class yet.)')
  } else {
    const body = input.lectures.map((l) => {
      const lines = [`[Lecture: ${l.title ?? 'Untitled'}]`]
      if (l.summary_overview?.trim()) lines.push(`Summary: ${l.summary_overview}`)
      if (l.transcript?.trim()) lines.push(`Transcript: ${l.transcript.slice(0, 20000)}`)
      return lines.join('\n')
    }).join('\n\n')
    parts.push(`=== CLASS LECTURE CONTENT ===\n${body}`)
  }

  if (input.assignmentPrompt?.trim()) {
    parts.push(`=== ASSIGNMENT RUBRIC ===\n${input.assignmentPrompt}`)
  }

  return parts.join('\n\n')
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- context`
Expected: PASS, 6 tests.

- [ ] **Step 5: Rewrite the function body**

In `supabase/functions/ai-tutor/index.ts`, **delete** `generateResponse`, `generateExplanation`, `generateSummary`, `generateMnemonic`, `generatePracticeQuestion`, and `generateGeneralResponse` (lines 168-255). Keep `gatherContext` and `extractSources` — they are real. Replace the response generation with:

```typescript
const context = buildTutorContext({ lectures, assignmentPrompt })

const msg = await anthropic.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000,
  system: [
    { type: 'text', text: TUTOR_SYSTEM },
    { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
  ],
  messages: [
    ...priorTurns.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ],
})

const answer = msg.content
  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
  .map((b) => b.text).join('\n')
```

The lecture context is byte-identical across every turn of a conversation, so the cache breakpoint after it means only the new question is billed fresh.

Apply the same identity-then-ownership guard from Task 5, checking `tutor_conversations.user_id` instead of `lectures.user_id`.

- [ ] **Step 6: Rewire the callers**

`src/pages/TutorPage.tsx` — replace the `fetch` at :281-297 with:

```typescript
      const { data, error } = await supabase.functions.invoke('ai-tutor', {
        body: { conversationId: currentConversation.id, message: input,
                classId: selectedClassId || null, assignmentPrompt },
      })
      if (error) throw new Error(error.message)
      const answer = data.answer
```

Delete the DOM-scrape at :288 (`document.querySelector('textarea[placeholder*="assignment prompt"]')`) and pass `assignmentPrompt` as a prop from `PaperEditor` state instead.

`src/components/GlobalChatWidget.tsx` — same replacement at :81-89. Response shape `{ answer }` is unchanged, so the render path at :93 needs no edit.

- [ ] **Step 7: Verify**

Run: `npm test && npm run build`
Expected: all PASS.

Run: `grep -rn 'n8n-e2ph' src/`
Expected: **only `src/components/ScheduleUpload.tsx`** (handled in Task 11).

- [ ] **Step 8: Deploy — requires user approval, then commit**

```bash
npx supabase functions deploy ai-tutor --project-ref hkqoesqiallwqbvuqgpp
git add supabase/functions/ai-tutor/index.ts supabase/functions/_shared/context.ts \
        supabase/functions/_shared/context.test.ts src/pages/TutorPage.tsx \
        src/components/GlobalChatWidget.tsx
git commit -m "feat(tutor): replace template generators with Claude + prompt caching"
```

---

## Task 11: Failure UI, reaper, and disabling the schedule path

**Files:**
- Modify: `src/pages/UploadPage.tsx` (status rendering ~393-444)
- Modify: `src/pages/LectureDetailPage.tsx:260` and its status rendering
- Modify: `src/components/ScheduleUpload.tsx:89-104`
- Create: `supabase/migrations/20260819220000_stuck_lecture_reaper.sql`

**Interfaces:**
- Consumes: `processing_error` (2)
- Produces: no exports

- [ ] **Step 1: Render `failed` in UploadPage**

The status block currently handles only `pending`/`processing`/`completed`, so a failed lecture shows the yellow "pending" pill forever. Add:

```tsx
{lecture.processing_status === 'failed' && (
  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
    <p className="font-medium text-red-800">Processing failed</p>
    <p className="mt-1 text-sm text-red-700">
      {lecture.processing_error ?? 'No further detail was recorded.'}
    </p>
    <button onClick={() => retryAnalysis(lecture.id)}
            className="mt-3 rounded bg-red-600 px-3 py-1.5 text-sm text-white">
      Retry
    </button>
  </div>
)}
```

```typescript
const retryAnalysis = async (id: string) => {
  await supabase.from('lectures')
    .update({ processing_status: 'pending', processing_error: null }).eq('id', id)
  const { error } = await supabase.functions.invoke('analyze-lecture', { body: { lectureId: id } })
  if (error) setToast({ message: `❌ Retry failed: ${error.message}`, type: 'error' })
}
```

- [ ] **Step 2: Un-stub key points**

`src/pages/LectureDetailPage.tsx:260` currently reads:

```typescript
const keyPoints: string[] = [];  // keys_points column dropped
```

Replace with:

```typescript
const keyPoints: string[] = Array.isArray(lecture?.key_points) ? lecture.key_points : [];
```

The column now exists (Task 2), which makes the 18-line block at :408-425 reachable for the first time.

Add the same `failed` branch from Step 1 to this page's status rendering.

- [ ] **Step 3: Disable the schedule path**

In `src/components/ScheduleUpload.tsx`, delete the `fetch` at :89-100 **and** the `setSuccess(true)` + confetti at :103-104. Replace with:

```typescript
      setToast({
        message: 'Schedule saved. Automatic class extraction is not available yet.',
        type: 'info',
      })
```

The n8n `schedule-upload` webhook never existed server-side — it was 404ing before Render died. Firing confetti for an operation that has never once worked is the same dishonesty as the upload toast.

- [ ] **Step 4: Write the reaper**

Create `supabase/migrations/20260819220000_stuck_lecture_reaper.sql`:

```sql
/*
  # Stuck lecture reaper

  A browser tab closed mid-transcription, or an Edge Function killed by the wall
  clock, leaves a row in 'transcribing'/'analyzing' forever. Previously such rows
  sat at 'pending' and the detail page polled every 5 seconds indefinitely.

  Uses the partial index from 20260819210000.
*/

CREATE OR REPLACE FUNCTION reap_stuck_lectures()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE reaped integer;
BEGIN
  UPDATE lectures
     SET processing_status = 'failed',
         processing_error  = 'Processing timed out. The browser tab may have been '
                             'closed during transcription. Press Retry to try again.'
   WHERE processing_status IN ('transcribing','analyzing')
     AND updated_at < now() - interval '15 minutes';
  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

REVOKE ALL ON FUNCTION reap_stuck_lectures() FROM public, anon, authenticated;
```

`SET search_path` is required — the audit found two existing `SECURITY DEFINER` functions without it.

- [ ] **Step 5: Verify**

Run: `npm test && npm run build`
Expected: PASS.

```sql
SELECT reap_stuck_lectures();
```
Expected: `0` on a healthy database.

Run: `grep -rn 'n8n-e2ph' src/ supabase/`
Expected: **no matches anywhere.** n8n is fully removed.

- [ ] **Step 6: Commit**

```bash
git add src/pages/UploadPage.tsx src/pages/LectureDetailPage.tsx \
        src/components/ScheduleUpload.tsx \
        supabase/migrations/20260819220000_stuck_lecture_reaper.sql
git commit -m "feat(ui): surface failures, add retry, reap stuck lectures, disable schedule path"
```

---

## Task 12: End-to-end verification

No new code. This proves Phase 1 actually works before it is called done.

**Files:** none

- [ ] **Step 1: Full check**

```bash
npm test && npm run build && npm run lint
```
Expected: tests PASS, build SUCCEEDS with a separate `transformers` chunk.

- [ ] **Step 2: Confirm n8n is gone**

```bash
grep -rn 'n8n-e2ph\|onrender.com' src/ supabase/ --include='*.ts' --include='*.tsx'
```
Expected: **no matches.**

- [ ] **Step 3: Confirm no mock generators survive**

```bash
grep -rn 'generateMnemonic\|generatePracticeQuestion\|This is not correct\|Another incorrect option' supabase/functions/
```
Expected: **no matches.**

- [ ] **Step 4: Confirm the key never reached the bundle**

```bash
grep -rn 'ANTHROPIC_API_KEY' src/ ; grep -rl 'sk-ant' dist/ 2>/dev/null
```
Expected: **no matches for either.** If either hits, stop and rotate the key.

- [ ] **Step 5: Live upload test**

Upload a real short audio lecture through the running app and confirm, in order:
1. Progress bar advances through transcription
2. `lectures.transcript` is populated and `transcript_source = 'browser-whisper'`
3. `processing_status` reaches `completed`
4. `summary_overview`, `key_points`, `claims`, `distinctions` are non-empty
5. `flashcards` rows exist for the lecture
6. The detail page renders the results without a refresh (realtime fired)

- [ ] **Step 6: Live failure test**

Set a lecture's `transcript` to `''`, set status to `pending`, invoke `analyze-lecture`, and confirm:
1. `processing_status` becomes `failed`
2. `processing_error` contains a readable message
3. The UI shows the red failure card with a working Retry button

**A failure that is invisible is the bug this whole phase exists to fix — do not skip this step.**

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: Phase 1 complete — Claude backend replaces n8n"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Schema (9 columns, status CHECK) | 2 |
| Auth pattern (JWT → ownership → service-role) | 5, 7, 10 |
| `analyze-lecture` | 7 |
| `ai-tutor` rewrite + prompt caching | 10 |
| Claude contract (`messages.parse`, 16000 tokens) | 6 |
| Rewritten prompts (claims/distinctions/no-invention) | 4 |
| Browser Whisper, pluggable | 8 |
| Failure semantics + reaper | 11 |
| Frontend rewiring (all 4 n8n call sites) | 9, 10, 11 |
| Code splitting | 8 |
| `verify_jwt` on `process-slides` | 7 (config.toml) |

No gaps.

**Placeholder scan:** clean — every code step carries real code; the reaper interval is 15 minutes, not "N".

**Type consistency:** `Transcriber.name` → `transcript_source` (8→9). `LectureAnalysis` fields → `lectures` columns (3→6→7). `AuthResult`/`AuthDeps` (5→7). `buildTutorContext` signature (10). `ContentBlock` (6→7). Verified consistent.

**Known deviations from the plan template:** Tasks 2, 7, 10, 11 include steps that touch the live database or deploy functions. Those are gated on explicit user approval and are marked as such — they are not autonomous steps.
