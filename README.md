# LectureLens

Turn lecture slides into study material. Upload a slide deck, and
LectureLens processes it into summaries, key points, and flashcards —
then lets you chat with an AI tutor that answers from *your* course
content, not the open internet.

## What it does

- **Upload** a lecture's slides and attach them to a class
- **Automatic processing** — an n8n agent workflow ingests the deck and
  generates structured notes (summaries, key points, flashcards)
- **Slide viewer** — read the original slides side-by-side with notes
- **AI tutor** — a chat tutor (Supabase Edge Function) grounded in the
  processed lecture content
- **Class notes** — everything organized per class, per lecture

## How it's built

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind |
| Backend | Supabase — Postgres (23 versioned migrations, RLS), Auth, Storage |
| Serverless | 2 Supabase Edge Functions: `process-slides`, `ai-tutor` |
| Processing pipeline | n8n webhook workflow (slide ingestion → notes generation) |

The processing pipeline is decoupled: the app hands uploads to an n8n
webhook and tracks status in Postgres, so the AI workflow can change
without touching the frontend. (`N8N_TROUBLESHOOTING.md` documents the
integration and its sharp edges.)

## Running it

```bash
npm install
# .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev
```

Requires a Supabase project (apply `supabase/migrations/` in order) and
an n8n instance with the processing workflow.

## Status

Working v1, built October 2025 – January 2026 as a self-directed
project. Part of the portfolio at [keeno.krispltd.com](https://keeno.krispltd.com).
