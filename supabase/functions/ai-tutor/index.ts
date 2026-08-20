import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@^0.120.0';
import { buildTutorContext, normalizeTurns, type ContextLecture, type Turn } from '../_shared/context.ts';
import { TUTOR_SYSTEM } from '../_shared/prompts.ts';

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173';
const corsHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface TutorRequest {
  conversationId: string;
  message: string;
  queryType?: 'explain' | 'summarize' | 'mnemonic' | 'question' | 'general';
  complexityLevel?: 'simple' | 'medium' | 'advanced';
  contextLectures?: string[];
  contextSlides?: string[];
  classId?: string | null;
  assignmentPrompt?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: TutorRequest;
  try {
    body = (await req.json()) as TutorRequest;
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }

  const {
    conversationId,
    message,
    queryType = 'general',
    complexityLevel = 'medium',
    contextLectures = [],
    contextSlides = [],
    classId,
    assignmentPrompt = null,
  } = body;

  if (!conversationId || !message) {
    return json(400, { error: 'Missing required fields' });
  }

  // Identity → ownership → privileged work. Never reorder. Mirrors
  // analyze-lecture's authorizeLectureAccess pattern, but keyed on the
  // conversation instead of the lecture — the service-role client never
  // makes the authorization decision, only the caller-scoped one does.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'missing authorization header' });
  const token = authHeader.trim().replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'malformed authorization header' });

  const scoped = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  let callerId: string;
  try {
    const { data: userData, error: userErr } = await scoped.auth.getUser();
    if (userErr || !userData.user?.id) {
      return json(401, { error: 'invalid or expired token' });
    }
    callerId = userData.user.id;
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }

  let conversation: { id: string; user_id: string; class_id: string | null };
  try {
    const { data, error } = await admin
      .from('tutor_conversations')
      .select('id, user_id, class_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) return json(500, { error: `Could not load conversation: ${error.message}` });
    if (!data) return json(404, { error: 'conversation not found' });
    if (!data.user_id) return json(403, { error: 'conversation has no owner' });
    if (data.user_id !== callerId) return json(403, { error: 'forbidden' });
    conversation = data;
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }

  try {
    // Prior turns must be fetched BEFORE the current user message is
    // inserted below, or the current question would appear twice in the
    // messages[] sent to Claude (once from history, once appended fresh).
    const { data: priorRows, error: priorErr } = await admin
      .from('tutor_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (priorErr) {
      return json(500, { error: `Could not load conversation history: ${priorErr.message}` });
    }
    // Fetched newest-first to get the *last* 10 rows, then reversed so the
    // model reads them oldest-first.
    const priorTurns = (priorRows ?? []).reverse() as { role: string; content: string }[];

    // Store user message. Deliberately inserted BEFORE the Claude call
    // below rather than after: if the call fails (rate limit, timeout,
    // network), the question is still preserved instead of silently lost.
    // The tradeoff is an orphaned 'user' row with no reply — this is safe
    // specifically because normalizeTurns() below merges consecutive
    // same-role turns before every request, so an orphan here (or one left
    // over from the old n8n pipeline, which has the same failure mode)
    // never produces two consecutive 'user' turns in messages[] and can
    // never permanently wedge the conversation with a 400 from the API.
    const { error: insertUserErr } = await admin.from('tutor_messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      query_type: queryType,
      complexity_level: complexityLevel,
    });
    if (insertUserErr) {
      return json(500, { error: `Could not store message: ${insertUserErr.message}` });
    }

    // Class-scoped lecture content for the model. RULING D: this is the bug
    // that made the deployed n8n tutor leak lecture content across users —
    // its class filter was built so the condition always took the false
    // branch and it queried every lecture row for every user. The filter
    // here must actually apply; if there is no class to scope to, we say so
    // honestly instead of falling back to an unfiltered query.
    //
    // A body-supplied classId is NOT already trustworthy the way
    // conversation.class_id is: the conversation row was just verified to
    // belong to the caller, but classId comes straight off the request body
    // and nothing has checked it belongs to them. Without this check, any
    // authenticated user could pass another user's class UUID here and get
    // Claude answering from that user's transcripts on the service-role
    // client below. A mismatch is treated as a straight 403, the same way
    // the conversation-ownership check above does — this is a deliberate
    // request to read another user's data, not an ambiguous "no class"
    // case, so it gets denied rather than quietly degraded to empty context.
    let scopeClassId: string | null;
    if (classId) {
      const { data: classRow, error: classErr } = await admin
        .from('classes')
        .select('user_id')
        .eq('id', classId)
        .maybeSingle();
      if (classErr) {
        return json(500, { error: `Could not verify class ownership: ${classErr.message}` });
      }
      if (!classRow || classRow.user_id !== callerId) {
        return json(403, { error: 'forbidden: class does not belong to the caller' });
      }
      scopeClassId = classId;
    } else {
      // conversation.class_id needs no re-check here — the conversation's
      // ownership was already verified above and its class_id was set
      // under RLS when the conversation was created.
      scopeClassId = conversation.class_id;
    }
    let lectures: ContextLecture[] = [];
    if (scopeClassId) {
      const { data: lectureRows, error: lecErr } = await admin
        .from('lectures')
        .select('title, summary_overview, transcript')
        .eq('class_id', scopeClassId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (lecErr) {
        return json(500, { error: `Could not load lecture context: ${lecErr.message}` });
      }
      lectures = (lectureRows ?? []) as ContextLecture[];
    }

    // Explicitly selected lectures/slides (if the caller passed any) get
    // folded in as supplementary context. gatherContext is scoped to the
    // caller below (see its definition) — contextLectures/contextSlides are
    // client-supplied ids and, unlike classId/conversationId, were never
    // otherwise checked against callerId.
    const extraContext = await gatherContext(admin, contextLectures, contextSlides, callerId);
    const sources = extractSources(extraContext);

    const context =
      buildTutorContext({ lectures, assignmentPrompt }) +
      (extraContext ? `\n\n${extraContext}` : '');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    // Normalize AFTER appending the new user turn, not before: an orphaned
    // 'user' row at the tail of priorTurns (see the insert comment above)
    // would otherwise sit immediately next to the fresh user turn we just
    // appended, still leaving two consecutive 'user' entries right at the
    // history/new-message boundary.
    const rawTurns: Turn[] = [
      ...priorTurns.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: message },
    ];
    const turns = normalizeTurns(rawTurns);

    const msg = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: [
        { type: 'text', text: TUTOR_SYSTEM },
        { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
      ],
      messages: turns,
    });

    const answer = msg.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    // Store AI response
    const { error: insertAssistantErr } = await admin.from('tutor_messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: answer,
      sources: JSON.stringify(sources),
      query_type: queryType,
      complexity_level: complexityLevel,
    });
    if (insertAssistantErr) {
      return json(500, { error: `Could not store response: ${insertAssistantErr.message}` });
    }

    return json(200, { answer });
  } catch (error) {
    console.error('AI Tutor error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

async function gatherContext(
  supabase: any,
  lectureIds: string[],
  slideIds: string[],
  callerId: string
): Promise<string> {
  const contextParts: string[] = [];

  // Gather lecture context. Scoped to the caller — lectureIds is a
  // client-supplied array of ids, not something already checked against
  // callerId the way conversationId/classId are above. Without the
  // user_id filter, any authenticated caller could pass another user's
  // lecture id here and have its content folded into their answer (IDOR).
  if (lectureIds.length > 0) {
    const { data: lectures, error: lecturesErr } = await supabase
      .from('lectures')
      .select('title, summary_overview, key_points, important_terms')
      .in('id', lectureIds)
      .eq('user_id', callerId);

    if (lecturesErr) {
      console.error('gatherContext: could not load lectures', lecturesErr);
    } else if (lectures) {
      for (const lecture of lectures) {
        contextParts.push(`\n## Lecture: ${lecture.title}`);
        if (lecture.summary_overview) {
          contextParts.push(`Summary: ${lecture.summary_overview}`);
        }
        if (lecture.key_points && lecture.key_points.length > 0) {
          contextParts.push(
            `Key Points: ${lecture.key_points.join('; ')}`
          );
        }
        if (lecture.important_terms && Object.keys(lecture.important_terms).length > 0) {
          const terms = Object.entries(lecture.important_terms)
            .map(([term, def]) => `${term}: ${def}`)
            .join('; ');
          contextParts.push(`Important Terms: ${terms}`);
        }
      }
    }
  }

  // Gather slide context. slides has no user_id of its own — ownership is
  // via its parent lecture — so this scopes through an inner join on
  // lectures(user_id). `!inner` is required: without it, eq() on an
  // embedded column doesn't exclude non-matching rows, it just leaves the
  // embedded object null on them, which would defeat the filter entirely.
  if (slideIds.length > 0) {
    const { data: slides, error: slidesErr } = await supabase
      .from('slides')
      .select('slide_number, extracted_text, summary, lectures!inner(user_id)')
      .in('id', slideIds)
      .eq('lectures.user_id', callerId);

    if (slidesErr) {
      console.error('gatherContext: could not load slides', slidesErr);
    } else if (slides) {
      for (const slide of slides) {
        contextParts.push(
          `\n## Slide ${slide.slide_number}: ${slide.summary || slide.extracted_text}`
        );
      }
    }
  }

  return contextParts.join('\n');
}

function extractSources(context: string): Array<{ type: string; reference: string }> {
  const sources: Array<{ type: string; reference: string }> = [];
  const lines = context.split('\n');

  for (const line of lines) {
    if (line.startsWith('## Lecture:')) {
      sources.push({
        type: 'lecture',
        reference: line.replace('## Lecture: ', ''),
      });
    } else if (line.startsWith('## Slide')) {
      sources.push({
        type: 'slide',
        reference: line.replace('## ', ''),
      });
    }
  }

  return sources;
}
