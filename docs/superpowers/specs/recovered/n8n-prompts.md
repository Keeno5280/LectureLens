# Recovered n8n Prompts (Gemini era)

**Recovered 2026-08-19.** The n8n instance at `n8n-e2ph.onrender.com` is permanently gone
(Render account suspended). `workflows.json` was the only export of the live server and
**cannot be re-exported**. These are the only surviving copies of this logic.

Preserved verbatim for reference during the Claude port. **These are not the prompts to
ship** — Phase 1 rewrites them (see the design doc). Kept because they encode real decisions
about output shape and because losing them loses the only record of what the pipeline did.

Model IDs used: `models/gemini-2.5-flash` (upload), `models/gemini-2.5-pro` (schedule
vision), `models/gemini-flash-latest` (tutor).

---

## 1. Audio analysis — DEPLOYED, node `Analyze audio`

The only prompt that ran in production and produced real output. Note it is a JSON-shaped
instruction blob, not structured output — no `responseSchema` was configured.

```
={
  "instruction": "You are an AI lecture summarizer. Listen to the provided audio and return only valid JSON — no markdown, no explanations, no 'json' prefix, no code fences.",
  "schema": {
    "summary_overview": "string - a concise 2–3 paragraph overview of the lecture.",
    "key_points": ["string - list of key ideas and takeaways."],
    "important_terms": [
      {"term": "string - key term", "definition": "string - short definition"}
    ],
    "exam_questions": ["string - possible exam or quiz questions."],
    "flashcards": [
      {"front": "string - question side", "back": "string - answer side"}
    ]
  },
  "output_requirements": "Return a single valid JSON object matching the schema above."
}
```

**Known defects:** the node left `options: {}`, so `maxOutputTokens` defaulted to **300** —
far too few for this schema. MIME type was hardcoded `audio/mpeg` regardless of the real
file, so in-app `.webm` recordings were mislabelled.

---

## 2. Slides — DEPLOYED, node `Google Gemini`

Static string with **no interpolation** — the slide text was never inserted. This is why
every production slides upload fell through to the mock generator.

```
You are an expert academic assistant for 'LectureLens'. Your goal is to analyze lecture slide text and create high-quality study materials.

Instructions:

Create a 3-sentence summary of the main concepts.

Extract 5 key terms with clear, student-friendly definitions.

Generate 5 flashcards with a 'question' and 'answer'.

Output Format: You MUST return ONLY a valid JSON object. Do not include any text outside the JSON
```

---

## 3. Slides — NEVER DEPLOYED, the fixed version that does interpolate

```
You are an expert academic assistant for LectureLens. Your goal is to analyze lecture slide text and create high-quality study materials.

Instructions:
1. Create a 3-sentence summary of the main concepts.
2. Extract 5 key terms with clear, student-friendly definitions.
3. Generate 5 flashcards with a question (front) and answer (back).

Output Format: You MUST return ONLY a valid JSON object matching this schema:
{
  "summary": "string",
  "key_terms": [{"term": "string", "definition": "string"}],
  "flashcards": [{"front": "string", "back": "string"}]
}

Do not include any markdown formatting or text outside the JSON.

Lecture Content:
<full concatenated PDF text>
```

**Schema mismatch worth noting:** the audio prompt emits `summary_overview` / `key_points`;
this one emits `summary` / `key_terms`. The n8n `Prepare_AI_Payload_Audio` node existed
purely to adapt between them. The Claude port uses one schema for both paths.

---

## 4. Tutor system message — DEPLOYED

```
You are an AI tutor helping a college student understand the course material.

Use ONLY the lecture context provided in {{ $json.context }} to answer the student's question.

Rules:
- Do NOT invent facts. If the context doesn't contain an answer, say so.
- Explain all answers clearly and in simple terms.
- Use bullet points when helpful.
- Keep answers tightly grounded in the class material.
```

**Defect:** `$json.context` did not exist at that point in the flow, so the deployed system
prompt literally read *"use ONLY the lecture context provided in undefined"*.

---

## 5. Tutor user message — DEPLOYED

```
You are a helpful lecture tutor. Use only the context provided below to answer the student's question as clearly and accurately as possible.

Question:{{ question }}

Context from class lectures:
{{ JSON.stringify(first row of the lectures query) }}
```

**Defect:** took only the **first** lecture row, and the class filter never applied — the
query selected every lecture in the database across all users.

---

## 6. Tutor context assembly — NEVER DEPLOYED, the best logic in the repo

The structure worth carrying into the Claude port:

```
You are a helpful lecture tutor. Use only the context provided below to answer the student's question as clearly and accurately as possible.

=== PREVIOUS CHAT HISTORY ===
<last 10 tutor_messages, oldest-first>

=== CLASS LECTURE CONTENT ===
[Lecture: <title>]
Summary: <summary_overview | 'N/A'>
Transcript Snippet: <transcript.substring(0,1500)>...

=== ASSIGNMENT RUBRIC/PROMPT ===
<assignment_prompt>

=== TASK ===
The student has highlighted specific text in their paper and needs help. Focus your answer strictly on improving that specific text or answering their specific question about it.
```

The `=== TASK ===` block was triggered by the magic string `"I am working on this assignment"`
produced at `TutorPage.tsx:329`. **That coupling is load-bearing** — replace it with an
explicit request flag rather than string-matching.

It also read `lectures.transcript`, which the pipeline never populated. The tutor has never
had real lecture context.

---

## 7. Schedule parsing — NEVER DEPLOYED

```
Analyze this class schedule. Extract the list of classes found. For each class, extract: 'name' (course code/title), 'professor' (if available), 'days' (e.g. Mon/Wed), 'time' (e.g. 10:00 AM). Return ONLY valid JSON array: [{"name": "BIO101", "professor": "Dr. Smith", "details": "Mon 10am"}]
```

**Defects:** asks for `days` and `time` but the example object shows `details`; the
downstream parser persists neither, discarding all scheduling information. The node was also
misconfigured (defaulted to URL input while being handed binary), so it could never have run
as saved.
