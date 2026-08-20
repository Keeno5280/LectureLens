# LectureLens — Handover (2026-08-20)

Phase 1 is complete, deployed, and verified working in a real browser.
Read this first; it is the state of the world.

---

## Run it

```bash
cd ~/Desktop/LectureLens/LectureLens
npm run dev        # http://localhost:5173
npm test           # 65 tests
npm run typecheck:shared   # 0 errors — covers supabase/functions/_shared
npm run typecheck          # 12 PRE-EXISTING errors in src/ — the baseline, not new
```

**Supabase project:** `hkqoesqiallwqbvuqgpp` (LectureLens). Deploy with
`npx supabase functions deploy <name> --project-ref hkqoesqiallwqbvuqgpp --use-api`

⚠️ **Dev-server gotcha:** after any dependency change, first boot takes ~60s while Vite
re-optimizes. `/` will hang until it finishes — that is normal, not the old deadlock.

---

## What Phase 1 did

Replaced a dead n8n/Gemini pipeline with two Claude-backed Supabase Edge Functions plus
browser-side Whisper. Before this branch the app **fabricated study material** (flashcards built
by pairing consecutive sentences, quiz distractors reading "This is not correct"), reported
"✅ upload successful" while the backend was dead, and exposed a public unauthenticated
service-role write endpoint.

### Architecture

```
Upload (audio/video)                 Upload (slides)
   ↓ browser Whisper (transformers.js)   ↓
   transcript → lectures.transcript      PDF stays in storage
   ↓                                     ↓
   supabase.functions.invoke('analyze-lecture')
   ↓
   Edge Function: JWT → ownership check → service-role
   ↓  audio/video: transcript as text     slides: PDF as a document block
   Claude (claude-opus-5, structured output via zodOutputFormat)
   ↓
   lectures.{summary_overview,key_points,important_terms,exam_questions,claims,distinctions}
   + flashcards + key_terms rows   →  status 'completed'
```

**Key files**
| Path | Role |
|---|---|
| `supabase/functions/analyze-lecture/index.ts` | The pipeline. Auth → dispatch → Claude → DB |
| `supabase/functions/ai-tutor/index.ts` | Real Claude tutor with prompt caching |
| `supabase/functions/_shared/claude.ts` | Claude client, `buildAnalysisInput`, `analyzeLecture` |
| `supabase/functions/_shared/schemas.ts` | zod schema constraining Claude's output |
| `supabase/functions/_shared/prompts.ts` | `LECTURE_ANALYST_SYSTEM`, `TUTOR_SYSTEM` |
| `supabase/functions/_shared/auth.ts` | `authorizeLectureAccess` — JWT → ownership |
| `supabase/functions/_shared/context.ts` | Tutor context + `normalizeTurns` |
| `supabase/functions/_shared/cors.ts` | Shared CORS (do NOT duplicate it per function) |
| `src/lib/transcribe/` | Pluggable transcription; `browser.ts` is Whisper |

---

## Rules that WILL bite you

1. **supabase-js RETURNS `{data, error}`; it does not throw.** `functions.invoke` too.
   This codebase shipped unchecked-error bugs **seven** separate times. Check every one.
2. **Never write a success message on a failed operation.** The entire branch exists to undo that.
3. **Model is exactly `claude-opus-5`.** No date suffix. `max_tokens: 16000` (a 300 default is
   what silently truncated the old pipeline). No `thinking` param, no assistant prefill — both 400.
4. **Auth order is absolute:** identity from the caller's OWN JWT → ownership check →
   *then* service-role. Two IDORs came from breaking this.
5. **Deno ≠ Node.** `_shared` modules need explicit `.ts` extensions on relative imports; bare
   specifiers must be mapped in `supabase/functions/deno.json`, wired via `config.toml`'s
   `import_map`. Supabase does NOT auto-discover it.
6. **Never import `src/lib/transcribe/browser.ts` in a test.** Vitest runs under `node`, which
   resolves transformers' Node condition and drags in `onnxruntime-node` + `sharp`.
7. **`onnxruntime-web` is pinned to 1.27.0 via `package.json` overrides.** The version
   transformers ships is a dev build whose WASM backend cannot load any Whisper model. Don't remove it.
8. **CURL DOES NOT TEST CORS.** A perfect backend can still be unreachable from the browser.
   Test in an actual browser.

---

## Verified working (in a real browser, not just tests)

- Slides (PDF) → real summary, key points, terms, exam questions, flashcards
- Audio → browser Whisper → Claude, on **both** WebGPU and WASM
- **90-minute lecture: 65s** (gateway limit ~150s). Time scales with OUTPUT, not input length
- AI tutor answers from lecture context and refuses when the answer isn't there
- Failures write `processing_status='failed'` + a readable `processing_error`, with a Retry
- Anonymous/anon-key calls to both functions → 401; foreign lecture id → 404
- `pg_cron` job `reap-stuck-lectures` every 5 min flips non-terminal rows older than 15 min

**The honesty test:** given a 14-second clip containing no lecture, Claude returns *empty arrays*
and says "No lecture content was provided." The old code produced 17 flashcards from it.

---

## Known issues / Phase 3

| Issue | Notes |
|---|---|
| 12 pre-existing typecheck errors in `src/` | Unused vars + 2 `Dashboard.tsx` type mismatches. Predate this work |
| `file_url` still built by `getPublicUrl()` | Buckets are now **private**, so those URLs 404. Nothing renders them; the delete paths only parse the string. Switch to `createSignedUrl` when convenient |
| 382MB of orphaned storage objects | ~94% garbage from old failed uploads; free tier is 1GB |
| No upload size cap / quota / rate limit | Bucket limit is 500MB. Two uploads could exhaust the free tier |
| 3 of 4 accounts have no `profiles` row | The `on_auth_user_created` trigger is missing. **Do not** re-apply the repo's version — it inserts `full_name`, a dropped column |
| No jsdom → UI honesty branches lack automated coverage | The guarantees are verified manually, not by CI |
| Analysis is on the request path | Fine to ~90 min. For 3-hour lectures, move to `EdgeRuntime.waitUntil` |
| Login page makes untrue claims | "Trusted by students at Stanford • MIT • Harvard", "thousands of students", and a ToS/Privacy Policy that don't exist. 4 real accounts |
| No recording-consent flow | Relevant if this ever records classmates or a lecturer |

---

## Phase 2 — the actual point

**Quiz-miss diagnosis.** The differentiator, and the reason `claims` and `distinctions` exist.

Today the app generates study material *forward*. Phase 2 runs *backward*: given a quiz question
the student got wrong, explain **why** — citing what the lecture actually said and naming the
distinction they collapsed.

Those two columns are already populated by every analysis:
- `claims`: `{statement, quote, emphasis, contested}` — `quote` is verbatim so a diagnosis can cite
- `distinctions`: `{this_, not_that, why_confusable}` — a wrong answer is usually a collapsed distinction

`quiz_questions` / `quiz_attempts` tables exist but are near-empty schema — a scorekeeper, not a
diagnostician. There is no "why was this wrong" column anywhere yet. That is the work.

The worked example this was designed from lives in `~/hcli-school/weeks/week-01/review.md`.

---

## Reference

- Design spec: `docs/superpowers/specs/2026-08-19-lecturelens-claude-port-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-19-lecturelens-phase1-claude-backend.md`
- Recovered Gemini prompts (only surviving copy): `docs/superpowers/specs/recovered/n8n-prompts.md`
- Secrets: `ANTHROPIC_API_KEY` is set in Supabase Edge Function secrets. **Rotate it** — it was
  pasted into a chat transcript. `console.anthropic.com` → new key → update the Supabase secret.
