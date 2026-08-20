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

    const { lectureId, slides, aiSummary, aiKeyTerms, aiFlashcards } = await req.json() as {
      lectureId: string;
      slides: SlideData[];
      aiSummary?: string;
      aiKeyTerms?: Array<{ term: string; definition: string }>;
      aiFlashcards?: Array<{ front: string; back: string }>;
    };

    if (!lectureId) {
      return new Response(
        JSON.stringify({ error: 'Invalid request data: lectureId is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Default slides to empty array if not provided (e.g. for Audio uploads)
    const slidesToProcess = (slides && Array.isArray(slides)) ? slides : [];

    // --- SAFETY FIX: ENSURE LECTURE EXISTS ---
    const { data: lectureCheck } = await supabase
      .from('lectures')
      .select('id, file_type')
      .eq('id', lectureId)
      .single();

    if (!lectureCheck) {
      return new Response(
        JSON.stringify({ error: 'Lecture not found. Please upload via the app first.' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 1. Insert all slides
    // 1. Insert all slides (if any)
    let insertedSlides: any[] = [];
    if (slidesToProcess.length > 0) {
      const slideRecords = slidesToProcess.map((slide) => ({
        lecture_id: lectureId,
        slide_number: slide.slideNumber,
        image_url: slide.imageUrl,
        extracted_text: slide.extractedText,
        summary: '', // Will be generated later or by AI
      }));

      const { data: slidesIns, error: slideError } = await supabase
        .from('slides')
        .insert(slideRecords)
        .select();

      if (slideError) {
        throw slideError;
      }
      insertedSlides = slidesIns;
    }

    // 2. Use Real AI Data if available, otherwise fallback to mock
    if (aiSummary || (aiKeyTerms && Array.isArray(aiKeyTerms) && aiKeyTerms.length > 0) || (aiFlashcards && Array.isArray(aiFlashcards) && aiFlashcards.length > 0)) {
      console.log('Using Real AI Data from n8n');

      // Update global lecture summary
      if (aiSummary) {
        await supabase
          .from('lectures')
          .update({
            summary_overview: aiSummary
          })
          .eq('id', lectureId);
      }

      // Insert Key Terms
      if (aiKeyTerms && Array.isArray(aiKeyTerms) && aiKeyTerms.length > 0) {
        const firstSlideId = insertedSlides?.[0]?.id;

        const keyTermRecords = aiKeyTerms.map((kt) => ({
          lecture_id: lectureId,
          slide_id: firstSlideId,
          term: kt.term,
          definition: kt.definition,
        }));
        await supabase.from('key_terms').insert(keyTermRecords);
      }

      // Insert Flashcards
      if (aiFlashcards && Array.isArray(aiFlashcards) && aiFlashcards.length > 0) {
        const flashcardRecords = aiFlashcards.map((fc) => ({
          lecture_id: lectureId,
          question: fc.front,
          answer: fc.back,
          difficulty: 'medium',
          is_auto_generated: true,
        }));
        await supabase.from('flashcards').insert(flashcardRecords);
      }

    } else {
      console.log('No AI Data provided, falling back to Mock Generation');

      const summaries: string[] = [];
      const keyTerms: Array<{ term: string; definition: string; slideId: string }> = [];

      for (const slide of insertedSlides || []) {
        if (slide.extracted_text) {
          const summary = await generateSlideSummary(slide.extracted_text);
          summaries.push(summary);

          await supabase
            .from('slides')
            .update({ summary })
            .eq('id', slide.id);

          const terms = await extractKeyTerms(slide.extracted_text);
          keyTerms.push(...terms.map((t) => ({ ...t, slideId: slide.id })));
        }
      }

      if (keyTerms.length > 0) {
        const keyTermRecords = keyTerms.map((kt) => ({
          lecture_id: lectureId,
          slide_id: kt.slideId,
          term: kt.term,
          definition: kt.definition,
        }));

        await supabase.from('key_terms').insert(keyTermRecords);
      }

      const flashcards = await generateFlashcards(
        slides.map((s) => s.extractedText).join('\n\n'),
        lectureId
      );

      if (flashcards.length > 0) {
        await supabase.from('flashcards').insert(flashcards);
      }

      const quizQuestions = await generateQuizQuestions(
        slides.map((s) => s.extractedText).join('\n\n'),
        lectureId
      );

      if (quizQuestions.length > 0) {
        await supabase.from('quiz_questions').insert(quizQuestions);
      }
    }

    // 3. Update lecture status
    // 3. Update lecture status
    const updatePayload: any = {
      processing_status: 'completed',
      slide_count: slidesToProcess.length,
    };
    if (slidesToProcess.length > 0) {
      updatePayload.file_type = 'slides';
    }

    await supabase
      .from('lectures')
      .update(updatePayload)
      .eq('id', lectureId);

    return new Response(
      JSON.stringify({
        success: true,
        slidesProcessed: slides.length,
        aiDataUsed: !!aiSummary
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
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
