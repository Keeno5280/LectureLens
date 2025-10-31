import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface TutorRequest {
  conversationId: string;
  message: string;
  queryType?: 'explain' | 'summarize' | 'mnemonic' | 'question' | 'general';
  complexityLevel?: 'simple' | 'medium' | 'advanced';
  contextLectures?: string[];
  contextSlides?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      conversationId,
      message,
      queryType = 'general',
      complexityLevel = 'medium',
      contextLectures = [],
      contextSlides = [],
    } = (await req.json()) as TutorRequest;

    if (!conversationId || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Store user message
    await supabase.from('tutor_messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      query_type: queryType,
      complexity_level: complexityLevel,
    });

    // Gather context from lectures and slides
    const context = await gatherContext(
      supabase,
      contextLectures,
      contextSlides
    );

    // Generate AI response based on query type and context
    const aiResponse = await generateResponse(
      message,
      context,
      queryType,
      complexityLevel
    );

    // Extract sources from context
    const sources = extractSources(context);

    // Store AI response
    const { data: assistantMessage } = await supabase
      .from('tutor_messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: aiResponse,
        sources: JSON.stringify(sources),
        query_type: queryType,
        complexity_level: complexityLevel,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        message: aiResponse,
        sources,
        messageId: assistantMessage?.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('AI Tutor error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
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

function generateResponse(
  query: string,
  context: string,
  queryType: string,
  complexityLevel: string
): string {
  // In production, this would use OpenAI or similar AI service
  // For now, we'll create intelligent template-based responses

  if (!context || context.trim().length === 0) {
    return "I don't have enough context from your uploaded materials to answer this question. Please select some lectures or slides to provide context, or upload relevant materials first.";
  }

  const complexityInstructions = {
    simple: 'in very simple terms that anyone can understand',
    medium: 'clearly and concisely',
    advanced: 'with technical depth and nuance',
  };

  switch (queryType) {
    case 'explain':
      return generateExplanation(query, context, complexityLevel);
    case 'summarize':
      return generateSummary(context, complexityLevel);
    case 'mnemonic':
      return generateMnemonic(query, context);
    case 'question':
      return generatePracticeQuestion(context);
    default:
      return generateGeneralResponse(query, context, complexityLevel);
  }
}

function generateExplanation(
  query: string,
  context: string,
  complexityLevel: string
): string {
  const complexity = {
    simple: 'Here\'s a simple explanation: ',
    medium: 'Let me explain: ',
    advanced: 'Here\'s a detailed explanation: ',
  }[complexityLevel];

  // Extract relevant sections from context
  const contextLines = context.split('\n').filter((line) => line.trim().length > 20);
  const relevantContent = contextLines.slice(0, 5).join(' ');

  return `${complexity}\n\nBased on your materials: ${relevantContent}\n\nKey points to remember:\n- The main concept involves understanding the foundational principles\n- This connects to other topics you've studied\n- Practical application is important for retention\n\nWould you like me to elaborate on any specific aspect?`;
}

function generateSummary(context: string, complexityLevel: string): string {
  const lines = context
    .split('\n')
    .filter((line) => line.trim().length > 20);
  const keyPoints = lines.slice(0, 5);

  return `Here's a summary of the key information:\n\n${keyPoints.map((point, i) => `${i + 1}. ${point.replace(/^#+\s*/, '')}`).join('\n')}\n\nThese are the most important concepts from your materials. Would you like me to explain any of these in more detail?`;
}

function generateMnemonic(query: string, context: string): string {
  const topicMatch = query.match(/remember (.+?)(?:\?|$)/i);
  const topic = topicMatch ? topicMatch[1] : 'this concept';

  return `Here's a mnemonic device to help you remember ${topic}:\n\n🧠 Memory Tip: Try creating a vivid mental image or story connecting these elements\n\n📝 Acronym Strategy: Take the first letter of each key term and create a memorable phrase\n\n🔄 Chunking Method: Break the information into smaller, related groups\n\n💡 Association Technique: Link this concept to something you already know well\n\nWould you like me to help you create a specific mnemonic based on your materials?`;
}

function generatePracticeQuestion(context: string): string {
  const contextLines = context
    .split('\n')
    .filter((line) => line.trim().length > 20);
  const topicLine = contextLines[Math.floor(Math.random() * Math.min(3, contextLines.length))];

  return `Here's a practice question based on your materials:\n\n❓ Question: Explain the key concepts related to the following topic and how they connect to the broader subject matter.\n\nTopic: ${topicLine.replace(/^#+\s*/, '')}\n\n💭 Think about:\n- What are the main components?\n- How does this relate to other concepts?\n- What are practical applications?\n\nTake a moment to formulate your answer, then let me know if you'd like to discuss it!`;
}

function generateGeneralResponse(
  query: string,
  context: string,
  complexityLevel: string
): string {
  const contextLines = context
    .split('\n')
    .filter((line) => line.trim().length > 20);
  const relevantContent = contextLines.slice(0, 3).join(' ');

  return `Based on your uploaded materials, here's what I found:\n\n${relevantContent}\n\nThis information directly relates to your question. Here are some key insights:\n\n• The material covers fundamental concepts that build upon each other\n• Understanding the relationships between ideas is crucial\n• Practical application will help reinforce these concepts\n\nWould you like me to:\n- Explain any part in simpler terms?\n- Create a mnemonic to help you remember?\n- Generate practice questions?\n\nJust let me know how I can help you learn this better!`;
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
