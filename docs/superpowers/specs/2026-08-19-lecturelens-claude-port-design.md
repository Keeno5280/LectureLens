# LectureLens — Phase 1 Design: Claude Backend

**Date:** 2026-08-19
**Status:** Awaiting review
**Phase:** 1 of 3 — *Work → Feature → Multi-user*

---

## Context

LectureLens does not currently function. Its AI processing ran on an n8n instance at
`n8n-e2ph.onrender.com` whose Render account is suspended (verified: HTTP 503,
`<title>Service Suspended</title>`). Every upload today writes a storage object and a
`lectures` row, POSTs into the void, and reports **"✅ Lecture uploaded successfully!"**
while the row stays at `pending` forever.

Four audits (security, AI pipeline, frontend inventory, multi-tenant readiness) established the ground truth; the recovered Gemini prompts are preserved in
`docs/superpowers/specs/recovered/n8n-prompts.md`. See *Findings carried in* below.

### Phase sequencing and rationale

| Phase | Scope | Why this order |
|---|---|---|
| **1 (this doc)** | Claude backend; the app works | Nothing else matters while the product does nothing |
| **2** | Quiz-miss diagnosis feature | The differentiator; it changes the schema |
| **3** | Multi-user hardening | RLS hardened **once**, after the schema is final |

### Decisions already made

| Decision | Choice | Rationale |
|---|---|---|
| Model provider | **Claude only.** Gemini removed entirely. | Owner uses Claude; Gemini billing was a concern |
| Model | `claude-opus-5` for every step | ~$0.20/lecture, ~$3/semester. Phase 2's diagnosis is a judgment task; no downgrade |
| Transcription | **Browser Whisper (transformers.js), behind a pluggable interface** | $0, no vendor, no key; audio never leaves the device |
| Orchestration | **Status machine on `lectures`** | Only option where failure is visible and retryable; upgrades to a queue in Phase 3 |
| n8n | **Deleted** | A second runtime to keep alive is the failure we just lived through |

---

## The audio constraint (drives the whole design)

**The Anthropic Messages API accepts text, images, and PDFs. It does not accept audio.**

The old pipeline was built on Gemini's native audio: one node uploaded the file to the Gemini
Files API and got back transcript + summary + terms in a single call. That step has no Claude
equivalent and cannot be ported. It splits into **transcribe → reason**.

Transcription therefore happens *outside* both Claude and Supabase Edge Functions (Deno
sandbox: no Python, no ffmpeg, no binaries, short wall clock). Phase 1 runs it in the browser
via transformers.js on WebGPU, falling back to WASM CPU.

**Consequence for the frontend build:** the app currently emits a single unsplit 906 KB
bundle. The Whisper loader **must** be dynamically imported. Model weights (~40–150 MB) are
fetched at runtime and cached by the browser, not bundled.

**PDF is an upgrade, not a port.** Claude reads PDFs natively as document blocks, so the
`Download → extractFromFile → aggregate pages` chain is deleted outright. Slide layout
survives, and one dependency disappears.

---

## Schema

Additive only — nothing dropped or renamed, so the running app cannot break.

Verified against the live database (`hkqoesqiallwqbvuqgpp`), **not** the local migration
files, which do not describe it (see *Migration drift*).

```sql
ALTER TABLE lectures
  ADD COLUMN key_points        jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN important_terms   jsonb DEFAULT '[]'::jsonb,   -- array, not the old '{}' map
  ADD COLUMN exam_questions    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN claims            jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN distinctions      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN processing_error  text,
  ADD COLUMN transcript_source text;   -- 'browser-whisper' | 'local-cli' | 'hosted'

ALTER TABLE lectures DROP CONSTRAINT IF EXISTS lectures_processing_status_check;
ALTER TABLE lectures ADD CONSTRAINT lectures_processing_status_check
  CHECK (processing_status IN
    ('pending','transcribing','transcribed','analyzing','completed','failed'));
```

### Already present on the live table (do not re-add)

`transcript text` · `processed_at timestamptz` · `ai_summary text` · `summary_overview text`

`ai_summary` is unused and left alone; dropping it is Phase 3 cleanup.

### Why `key_points` / `important_terms` / `exam_questions` are *additions*

They do not exist on the live table. The old n8n audio branch's final step was
`PATCH lectures` with exactly these columns plus `flashcards`. PostgREST returns 400; n8n
never checked the response. **Audio processing never worked, for this reason.** The same
missing columns break `process-slides`'s summary write and the `ai-tutor` function's
`SELECT key_points, important_terms`.

### Decisions embedded

- **`important_terms` is an array of `{term, definition}`**, not a term→definition map. The map
  loses ordering and cannot carry a third field.
- **Flashcards live in the `flashcards` table, not a column.** The live schema settles the
  "two competing homes" question: the table exists, the column never did.
- **`transcript_source`** is what makes transcription swappable — it records which
  implementation produced the text, so a later provider change can re-run selectively.

---

## Edge Functions

Two functions. The count collapses from the eight a naive port would need because Claude
reads PDFs natively.

### Authorization pattern (applies to both)

Both current functions instantiate a `SUPABASE_SERVICE_ROLE_KEY` client — total RLS bypass —
and never read the `Authorization` header. `process-slides` additionally has
`verify_jwt: false`, making it a public, unauthenticated, service-role write endpoint.

Every function follows this order, without exception:

```ts
// 1. Resolve identity using the CALLER'S OWN JWT
const { data: { user } } = await createClient(URL, ANON_KEY, {
  global: { headers: { Authorization: req.headers.get('Authorization')! } },
}).auth.getUser()
if (!user) return json(401, { error: 'unauthorized' })

// 2. Load the row with service-role, then CHECK OWNERSHIP before acting
const { data: lecture } = await admin
  .from('lectures').select('*').eq('id', lectureId).single()
if (!lecture)                      return json(404, { error: 'not found' })
if (lecture.user_id !== user.id)   return json(403, { error: 'forbidden' })

// 3. Only now may service-role write.
```

CORS is locked to the app origin, replacing `Access-Control-Allow-Origin: '*'`.
`verify_jwt: true` on both, set in `supabase/config.toml` (which does not currently exist).

### 1. `analyze-lecture`

**Request** `POST /functions/v1/analyze-lecture` · `{ lectureId: string }` · caller's JWT
**Response** `202 { status: 'analyzing' }` — results arrive over realtime

Dispatch by `file_type`:

| `file_type` | Model input |
|---|---|
| `audio`, `video` | `lectures.transcript` as a text block |
| `slides` | the PDF as `{type:'document', source:{type:'base64', media_type:'application/pdf'}}` |

`video` is handled. It fell off the end of the old n8n switch, which had cases only for
`audio` and `slides` and no fallback — video uploads hung at `pending` forever.

**Writes:** `lectures.{summary_overview, key_points, important_terms, exam_questions, claims,
distinctions, processing_status, processed_at}`; `flashcards` rows; `key_terms` rows.

Results **must** be written to `lectures` — it is the only table in the `supabase_realtime`
publication, so writes to child tables alone will never update the UI.

### 2. `ai-tutor` (rewrite)

**Request** `{ conversationId, message, classId?, assignmentPrompt? }`
**Response** `{ answer: string }` — shape preserved so `TutorPage.tsx:306` and
`GlobalChatWidget.tsx:93` need no change.

Three sources merge:
- `gatherContext()` from the existing function — the one genuinely real piece of code in it;
  it does correct Supabase reads and builds clean markdown. **Kept verbatim.**
- The history / assignment / `=== TASK ===` context blocks from the undeployed n8n draft.
- The tutor system prompt, as the top-level `system` field.

Every template generator (`generateExplanation`, `generateSummary`, `generateMnemonic`,
`generatePracticeQuestion`, `generateGeneralResponse`) is **deleted**.

Two bugs fixed in passing: the deployed tutor's class filter never applied, so it selected
**every lecture row in the database across all users**; and its system prompt interpolated an
undefined variable, literally reading *"use ONLY the lecture context provided in undefined"*.

**Prompt caching.** Lecture context is byte-identical across every turn of a conversation:

```ts
system: [
  { type: 'text', text: TUTOR_SYSTEM },
  { type: 'text', text: lectureContext, cache_control: { type: 'ephemeral' } },
],
messages: [...priorTurns, { role: 'user', content: message }],
```

Conversation history becomes real `messages[]` turns rather than being `JSON.stringify`'d
into the prompt.

---

## The Claude contract

Gemini's `jsonOutput: true` still emitted code fences — hence four separate
`.replace(/```json/…)` cleanup blocks across this repo. That entire class of bug is deleted.

```ts
const LectureAnalysis = z.object({
  summary_overview: z.string(),
  key_points:       z.array(z.string()),
  important_terms:  z.array(z.object({ term: z.string(), definition: z.string() })),
  exam_questions:   z.array(z.string()),
  flashcards:       z.array(z.object({ front: z.string(), back: z.string() })),
  claims: z.array(z.object({
    statement: z.string(),
    quote:     z.string(),
    emphasis:  z.enum(['stated-definition','repeated','flagged','passing']),
    contested: z.boolean(),
  })),
  distinctions: z.array(z.object({
    this_:          z.string(),
    not_that:       z.string(),
    why_confusable: z.string(),
  })),
})

const res = await client.messages.parse({
  model: 'claude-opus-5',
  max_tokens: 16000,
  system: LECTURE_ANALYST_SYSTEM,
  messages: [{ role: 'user', content: [inputBlock] }],
  output_config: { format: zodOutputFormat(LectureAnalysis) },
})
res.parsed_output   // validated; null on parse failure — guard it
```

`max_tokens: 16000`, against the **300** the Gemini node silently defaulted to. That cap is
the prime suspect for audio truncation even before the missing-column 400s.

`ANTHROPIC_API_KEY` lives in Supabase Edge Function secrets. It is never in the client bundle.

---

## Prompts

Rewritten rather than ported. The surviving Gemini prompts ask for a summary, five terms, and
five flashcards — adequate for a generic study tool, insufficient for Phase 2.

Phase 2 diagnoses *why a specific wrong answer was wrong*. That requires evidence Phase 1 must
capture at analysis time, because the audio is gone by then:

| Captured | Why Phase 2 needs it |
|---|---|
| **Verbatim quotes** on every claim | A diagnosis that cannot cite the lecture is an opinion |
| **`distinctions`** | A wrong answer is almost always a collapsed distinction. Quiz traps are built on these seams |
| **`emphasis`** | Repeated / defined / "this is on the test" material is disproportionately tested |
| **`contested`** | Lets the tutor say "this is *this course's* position" instead of "correct" |

### `LECTURE_ANALYST_SYSTEM` (draft)

> You are analyzing a lecture to build study material a student will be quizzed on.
>
> Your output is not a summary for its own sake. It is the evidence base a tutor will later
> use to explain to a specific student why a specific quiz answer was wrong. That purpose
> changes what matters.
>
> **Preserve the lecturer's own words.** Every claim carries a verbatim quote. A later
> explanation must cite what was actually said, not your paraphrase.
>
> **Capture emphasis.** What was repeated, stated as a definition, or flagged as important
> ("this will be on the test", "the key thing here") is disproportionately likely to be
> tested. Mark it.
>
> **Capture distinctions.** Wherever the lecturer separates two things that are easily
> confused — *X is not Y*, *the difference between A and B* — record both sides and why they
> get confused. Quiz questions are built on exactly these seams, and a student's wrong answer
> usually means a distinction collapsed.
>
> **Mark what is contested.** If the lecturer presents a position that other traditions,
> schools, or authorities hold differently, set `contested`. A student needs to know when
> they are learning *this course's* position rather than a settled fact.
>
> **Do not invent.** If the lecture does not address something, leave the field empty. Absent
> study material is recoverable; fabricated study material is studied and believed.

That last instruction is not abstract. The current `process-slides` fallback builds flashcards
by pairing consecutive sentences, and quiz distractors that read literally
`"This is not correct"`, `"Another incorrect option"`. They are marked
`is_auto_generated: true` and are identifiable — see *Pre-flight*.

---

## Failure semantics

```
pending ──► transcribing ──► transcribed ──► analyzing ──► completed
                │                                │
                └────────────► failed ◄──────────┘
                          + processing_error
```

- Every function wraps its body in try/catch and writes `failed` plus a human-readable
  `processing_error`.
- The UI renders `failed` distinctly — currently only `pending`/`processing`/`completed` are
  handled, so a failure is indistinguishable from pending forever.
- A reaper flips rows stuck in `transcribing`/`analyzing` past 15 minutes to `failed`.
- **`UploadPage` stops claiming success on a throw.** Today `UploadPage.tsx:201-223` swallows
  the failure in a `catch` that only `console.error`s, then shows
  *"✅ Lecture uploaded successfully! AI processing will begin shortly."* This is the single
  most dishonest surface in the app and it is fixed as part of this phase.
- `ScheduleUpload.tsx:91` has the same defect with added confetti; the schedule path is out
  of scope for Phase 1, so its trigger is **disabled** rather than left lying.

---

## Frontend changes

| File | Change |
|---|---|
| `UploadPage.tsx:201-223` | `fetch(n8n)` → `supabase.functions.invoke('analyze-lecture')`; **surface failures** |
| `UploadPage.tsx` | Add the dynamically-imported browser-Whisper step with a progress bar |
| `TutorPage.tsx:281` | `fetch(n8n)` → `supabase.functions.invoke('ai-tutor')` |
| `TutorPage.tsx:288` | Delete the DOM-scrape (`querySelector('textarea[placeholder*=…]')`); pass the prompt as a prop |
| `GlobalChatWidget.tsx:81` | `fetch(n8n)` → `supabase.functions.invoke('ai-tutor')` |
| `ScheduleUpload.tsx:89` | Disable the trigger and its confetti until Phase 3 |
| `LectureDetailPage.tsx:260` | Un-stub `keyPoints` — the column now exists |
| `vite.config.ts` | Code-split; the 906 KB single chunk cannot absorb the Whisper loader |

---

## Out of scope for Phase 1 (tracked, not forgotten)

**Phase 2:** quiz-miss diagnosis; `quiz_questions` has no real generator anywhere and never
did — Gemini produced quiz questions in no workflow.

**Phase 3:** the `on_auth_user_created` trigger (3 of 4 live accounts have no `profiles` row
and physically cannot create a class or lecture); public storage buckets; upload size caps and
quotas; `MOCK_USER_ID` in `SlideViewerPage`; the unreachable `slide-viewer` route; recording
consent; account deletion and export; the login page's unsubstantiated claims
(Stanford/MIT/Harvard, "thousands of students", a ToS and Privacy Policy that do not exist);
`SearchBar.tsx:135` regex injection; `PaperEditor` data-loss bugs.

---

## Pre-flight

Before any code:

1. **Commit the 33 outstanding files.** ~2 weeks of uncommitted work including entire
   features. The n8n exports are now gitignored (done 2026-08-19), so `git add .` is safe.
2. **Preserve the extracted prompts.** `workflows.json` is the only export of the dead n8n
   server and cannot be re-exported. The seven recovered prompts are preserved verbatim in `docs/superpowers/specs/recovered/n8n-prompts.md`.
3. **Audit mock-generated rows** and decide delete-vs-regenerate:
   ```sql
   SELECT count(*) FROM flashcards WHERE is_auto_generated = true;
   SELECT count(*) FROM quiz_questions
    WHERE explanation IN ('Based on the slide content.',
                          'This statement appears in the lecture slides.');
   ```
4. **Capture the 6 server-only migrations into git** so the database is reproducible.

### Migration drift

The local migration history **cannot rebuild this database**. The base schema
`20250101000000` was never applied; six migrations exist only on the server; `semesters` and
`schedules` were created by hand in the dashboard. Every schema claim in this document was
verified by querying the live database directly. Reconciling the history is Phase 3 work, but
**no migration in this repo should be trusted as a description of production** until then.

---

## Findings carried in

Completed and verified on 2026-08-19, ahead of this phase:

- **`.gitignore`** now covers all six n8n JSON exports plus the two `.cjs` helpers.
  `workflows.json` (175 KB) contains credential IDs and internal URLs for the owner's entire
  n8n instance, including unrelated Airtable/Gmail/AWS workflows. Verified with
  `git check-ignore`.
- **RLS migration applied** (`fix_anon_access_to_tutor_tables`): six tutor tables carried
  policies containing `OR auth.role() = 'anon'` and `WITH CHECK (... OR true)`. Since the anon
  key ships in the public bundle, 24 real tutor messages were readable, updatable, and
  deletable by any anonymous caller. Verified after: `SET LOCAL ROLE anon` returns **0 rows**
  across all affected tables.
- **`classes` needed no change.** The migration files imply a permissive
  `"Allow all access to classes"` policy; it does not exist on the live database.
