import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@^0.120.0';
import { buildTutorContext, type ContextLecture } from '../_shared/context.ts';
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
  classId?: string;
  assignmentPrompt?: string;
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

    // Store user message
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
    const scopeClassId = classId || conversation.class_id || null;
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
    // folded in as supplementary context; gatherContext/extractSources are
    // the original real code in this file and are kept as-is.
    const extraContext = await gatherContext(admin, contextLectures, contextSlides);
    const sources = extractSources(extraContext);

    const context =
      buildTutorContext({ lectures, assignmentPrompt }) +
      (extraContext ? `\n\n${extraContext}` : '');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

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
  slideIds: string[]
): Promise<string> {
  const contextParts: string[] = [];

  // Gather lecture context
  if (lectureIds.length > 0) {
    const { data: lectures } = await supabase
      .from('lectures')
      .select('title, summary_overview, key_points, important_terms')
      .in('id', lectureIds);

    if (lectures) {
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

  // Gather slide context
  if (slideIds.length > 0) {
    const { data: slides } = await supabase
      .from('slides')
      .select('slide_number, extracted_text, summary')
      .in('id', slideIds);

    if (slides) {
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
