import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface SlideData {
  slideNumber: number;
  extractedText: string;
  imageUrl: string;
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

    const { lectureId, slides } = await req.json() as {
      lectureId: string;
      slides: SlideData[];
    };

    if (!lectureId || !slides || !Array.isArray(slides)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request data' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Insert all slides
    const slideRecords = slides.map((slide) => ({
      lecture_id: lectureId,
      slide_number: slide.slideNumber,
      image_url: slide.imageUrl,
      extracted_text: slide.extractedText,
      summary: '', // Will be generated later
    }));

    const { data: insertedSlides, error: slideError } = await supabase
      .from('slides')
      .insert(slideRecords)
      .select();

    if (slideError) {
      throw slideError;
    }

    // Generate AI summaries and extract key terms
    const summaries: string[] = [];
    const keyTerms: Array<{ term: string; definition: string; slideId: string }> = [];

    for (const slide of insertedSlides || []) {
      if (slide.extracted_text) {
        // Generate summary (2-3 sentences)
        const summary = await generateSlideSummary(slide.extracted_text);
        summaries.push(summary);

        // Update slide with summary
        await supabase
          .from('slides')
          .update({ summary })
          .eq('id', slide.id);

        // Extract key terms
        const terms = await extractKeyTerms(slide.extracted_text);
        keyTerms.push(...terms.map((t) => ({ ...t, slideId: slide.id })));
      }
    }

    // Insert key terms
    if (keyTerms.length > 0) {
      const keyTermRecords = keyTerms.map((kt) => ({
        lecture_id: lectureId,
        slide_id: kt.slideId,
        term: kt.term,
        definition: kt.definition,
      }));

      await supabase.from('key_terms').insert(keyTermRecords);
    }

    // Generate flashcards (5-10 per lecture)
    const flashcards = await generateFlashcards(
      slides.map((s) => s.extractedText).join('\n\n'),
      lectureId
    );

    if (flashcards.length > 0) {
      await supabase.from('flashcards').insert(flashcards);
    }

    // Generate quiz questions
    const quizQuestions = await generateQuizQuestions(
      slides.map((s) => s.extractedText).join('\n\n'),
      lectureId
    );

    if (quizQuestions.length > 0) {
      await supabase.from('quiz_questions').insert(quizQuestions);
    }

    // Update lecture status
    await supabase
      .from('lectures')
      .update({
        processing_status: 'completed',
        file_type: 'slides',
        slide_count: slides.length,
      })
      .eq('id', lectureId);

    return new Response(
      JSON.stringify({
        success: true,
        slidesProcessed: slides.length,
        flashcardsGenerated: flashcards.length,
        quizQuestionsGenerated: quizQuestions.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing slides:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// AI Helper Functions (simplified - in production, use OpenAI or similar)
async function generateSlideSummary(text: string): Promise<string> {
  // Simple summarization logic
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const summary = sentences.slice(0, 2).join('. ') + '.';
  return summary || 'No summary available.';
}

async function extractKeyTerms(
  text: string
): Promise<Array<{ term: string; definition: string }>> {
  // Simple term extraction (in production, use NLP)
  const terms: Array<{ term: string; definition: string }> = [];
  const words = text.split(/\s+/);
  
  // Look for capitalized words or phrases
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length > 3 && /^[A-Z]/.test(word)) {
      // Simple definition: next few words
      const definition = words.slice(i + 1, i + 10).join(' ');
      terms.push({ term: word, definition });
    }
  }

  return terms.slice(0, 10); // Limit to 10 terms
}

async function generateFlashcards(
  content: string,
  lectureId: string
): Promise<any[]> {
  const flashcards: any[] = [];
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);

  // Generate 5-10 flashcards
  for (let i = 0; i < Math.min(10, sentences.length); i += 2) {
    if (i + 1 < sentences.length) {
      flashcards.push({
        lecture_id: lectureId,
        question: `What does this statement mean: "${sentences[i].trim()}"?`,
        answer: sentences[i + 1].trim(),
        difficulty: 'medium',
        is_auto_generated: true,
      });
    }
  }

  return flashcards;
}

async function generateQuizQuestions(
  content: string,
  lectureId: string
): Promise<any[]> {
  const questions: any[] = [];
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);

  // Generate multiple choice questions
  for (let i = 0; i < Math.min(5, sentences.length); i += 3) {
    const sentence = sentences[i].trim();
    questions.push({
      lecture_id: lectureId,
      question_type: 'multiple_choice',
      question_text: `Which statement is true about: ${sentence.substring(0, 50)}...?`,
      correct_answer: sentence,
      options: JSON.stringify([
        sentence,
        'This is not correct',
        'Another incorrect option',
        'Yet another wrong answer',
      ]),
      explanation: 'Based on the slide content.',
      difficulty: 'medium',
    });
  }

  // Generate true/false questions
  for (let i = 1; i < Math.min(3, sentences.length); i += 4) {
    questions.push({
      lecture_id: lectureId,
      question_type: 'true_false',
      question_text: `True or False: ${sentences[i].trim()}`,
      correct_answer: 'true',
      options: JSON.stringify(['true', 'false']),
      explanation: 'This statement appears in the lecture slides.',
      difficulty: 'easy',
    });
  }

  return questions;
}
