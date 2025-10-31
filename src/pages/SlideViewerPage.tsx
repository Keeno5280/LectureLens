import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  MessageSquare,
  Highlighter,
  FileText,
  X,
  Plus,
  Search,
  Grid,
  Book,
  Brain,
  CheckCircle2,
} from 'lucide-react';

interface Slide {
  id: string;
  slide_number: number;
  image_url: string;
  extracted_text: string;
  summary: string;
}

interface Highlight {
  id: string;
  text_content: string;
  color: string;
  note: string;
  position_data: any;
}

interface Annotation {
  id: string;
  annotation_type: string;
  content: string;
  color: string;
  position_data: any;
}

interface Bookmark {
  id: string;
  slide_id: string;
  note: string;
}

export default function SlideViewerPage() {
  const lectureId = new URLSearchParams(window.location.search).get('id') || '';

  const [slides, setSlides] = useState<Slide[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [showAnnotationTool, setShowAnnotationTool] = useState(false);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const [selectedColor, setSelectedColor] = useState('#FFFF00');
  const [annotationText, setAnnotationText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const slideRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);

  const MOCK_USER_ID = '00000000-0000-0000-0000-000000000000';

  useEffect(() => {
    loadSlides();
    loadUserData();
    updateProgress();

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [lectureId]);

  useEffect(() => {
    if (slides.length > 0) {
      loadSlideData(slides[currentSlideIndex].id);
      updateProgress();
    }
  }, [currentSlideIndex, slides]);

  const loadSlides = async () => {
    try {
      const { data, error } = await supabase
        .from('slides')
        .select('*')
        .eq('lecture_id', lectureId)
        .order('slide_number');

      if (error) throw error;
      setSlides(data || []);
    } catch (error) {
      console.error('Error loading slides:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSlideData = async (slideId: string) => {
    try {
      const [highlightsRes, annotationsRes] = await Promise.all([
        supabase.from('slide_highlights').select('*').eq('slide_id', slideId),
        supabase.from('slide_annotations').select('*').eq('slide_id', slideId),
      ]);

      setHighlights(highlightsRes.data || []);
      setAnnotations(annotationsRes.data || []);
    } catch (error) {
      console.error('Error loading slide data:', error);
    }
  };

  const loadUserData = async () => {
    try {
      const { data } = await supabase
        .from('lecture_bookmarks')
        .select('*')
        .eq('lecture_id', lectureId)
        .eq('user_id', MOCK_USER_ID);

      setBookmarks(data || []);
    } catch (error) {
      console.error('Error loading bookmarks:', error);
    }
  };

  const updateProgress = async () => {
    if (!slides.length) return;

    try {
      const { data: existing } = await supabase
        .from('lecture_progress')
        .select('*')
        .eq('lecture_id', lectureId)
        .eq('user_id', MOCK_USER_ID)
        .maybeSingle();

      const progressData = {
        lecture_id: lectureId,
        user_id: MOCK_USER_ID,
        current_slide: currentSlideIndex + 1,
        last_viewed: new Date().toISOString(),
      };

      if (existing) {
        await supabase
          .from('lecture_progress')
          .update(progressData)
          .eq('id', existing.id);
      } else {
        await supabase.from('lecture_progress').insert(progressData);
      }
    } catch (error) {
      console.error('Error updating progress:', error);
    }
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') previousSlide();
    if (e.key === 'ArrowRight') nextSlide();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;

    if (Math.abs(diff) > 50) {
      if (diff > 0) nextSlide();
      else previousSlide();
    }
  };

  const nextSlide = () => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
  };

  const previousSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const toggleBookmark = async () => {
    const currentSlide = slides[currentSlideIndex];
    const existingBookmark = bookmarks.find((b) => b.slide_id === currentSlide.id);

    try {
      if (existingBookmark) {
        await supabase.from('lecture_bookmarks').delete().eq('id', existingBookmark.id);
        setBookmarks(bookmarks.filter((b) => b.id !== existingBookmark.id));
      } else {
        const { data } = await supabase
          .from('lecture_bookmarks')
          .insert({
            lecture_id: lectureId,
            slide_id: currentSlide.id,
            user_id: MOCK_USER_ID,
            note: '',
          })
          .select()
          .single();

        if (data) setBookmarks([...bookmarks, data]);
      }
    } catch (error) {
      console.error('Error toggling bookmark:', error);
    }
  };

  const addAnnotation = async () => {
    if (!annotationText.trim()) return;

    try {
      const { data } = await supabase
        .from('slide_annotations')
        .insert({
          slide_id: slides[currentSlideIndex].id,
          user_id: MOCK_USER_ID,
          annotation_type: 'text',
          content: annotationText,
          color: selectedColor,
          position_data: { x: 50, y: 50 },
        })
        .select()
        .single();

      if (data) {
        setAnnotations([...annotations, data]);
        setAnnotationText('');
        setShowAnnotationTool(false);
      }
    } catch (error) {
      console.error('Error adding annotation:', error);
    }
  };

  const isBookmarked = slides.length > 0 && bookmarks.some(
    (b) => b.slide_id === slides[currentSlideIndex].id
  );

  const filteredSlides = searchQuery
    ? slides.filter(
        (s) =>
          s.extracted_text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.summary.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : slides;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading slides...</p>
        </div>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <FileText className="h-16 w-16 text-slate-400 mx-auto mb-4" />
          <p className="text-xl text-slate-600">No slides found for this lecture</p>
        </div>
      </div>
    );
  }

  const currentSlide = slides[currentSlideIndex];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => window.history.back()}
            className="flex items-center text-slate-600 hover:text-blue-600 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 mr-1" />
            Back to Lecture
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={`p-2 rounded-lg transition-all ${
                showSearch ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowThumbnails(!showThumbnails)}
              className={`p-2 rounded-lg transition-all ${
                showThumbnails ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Grid className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowSummaryPanel(!showSummaryPanel)}
              className={`p-2 rounded-lg transition-all ${
                showSummaryPanel ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FileText className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowFlashcards(true)}
              className="p-2 bg-white rounded-lg text-slate-700 hover:bg-slate-100 transition-all"
            >
              <Book className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowQuiz(true)}
              className="p-2 bg-white rounded-lg text-slate-700 hover:bg-slate-100 transition-all"
            >
              <Brain className="h-5 w-5" />
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="mb-4 bg-white rounded-lg p-4 shadow-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search slides, annotations, and content..."
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <p className="text-sm text-slate-600 mt-2">
                Found {filteredSlides.length} slide(s) matching "{searchQuery}"
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={showSummaryPanel ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div
                ref={slideRef}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className="relative aspect-video bg-slate-100"
              >
                <img
                  src={currentSlide.image_url}
                  alt={`Slide ${currentSlide.slide_number}`}
                  className="w-full h-full object-contain"
                />

                {annotations.map((annotation) => (
                  <div
                    key={annotation.id}
                    className="absolute p-2 rounded-lg shadow-lg text-sm"
                    style={{
                      left: `${annotation.position_data.x}%`,
                      top: `${annotation.position_data.y}%`,
                      backgroundColor: annotation.color,
                    }}
                  >
                    {annotation.content}
                  </div>
                ))}

                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                  <button
                    onClick={previousSlide}
                    disabled={currentSlideIndex === 0}
                    className="p-3 bg-white/90 rounded-full shadow-lg hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-6 w-6 text-slate-700" />
                  </button>

                  <div className="flex items-center gap-2 bg-white/90 px-4 py-2 rounded-full shadow-lg">
                    <span className="text-sm font-medium text-slate-700">
                      {currentSlideIndex + 1} / {slides.length}
                    </span>
                  </div>

                  <button
                    onClick={nextSlide}
                    disabled={currentSlideIndex === slides.length - 1}
                    className="p-3 bg-white/90 rounded-full shadow-lg hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="h-6 w-6 text-slate-700" />
                  </button>
                </div>
              </div>

              <div className="p-6 border-t border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-slate-800">
                    Slide {currentSlide.slide_number}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleBookmark}
                      className={`p-2 rounded-lg transition-all ${
                        isBookmarked
                          ? 'bg-yellow-100 text-yellow-600'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <Bookmark className="h-5 w-5" fill={isBookmarked ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => setShowAnnotationTool(!showAnnotationTool)}
                      className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {showAnnotationTool && (
                  <div className="mb-4 p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Highlighter className="h-4 w-4 text-slate-600" />
                      <span className="text-sm font-medium text-slate-700">Add Annotation</span>
                    </div>
                    <div className="flex gap-2 mb-3">
                      {['#FFFF00', '#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181'].map((color) => (
                        <button
                          key={color}
                          onClick={() => setSelectedColor(color)}
                          className={`w-8 h-8 rounded-full border-2 transition-all ${
                            selectedColor === color ? 'border-slate-900 scale-110' : 'border-slate-300'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <textarea
                      value={annotationText}
                      onChange={(e) => setAnnotationText(e.target.value)}
                      placeholder="Type your annotation..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                      rows={2}
                    />
                    <button
                      onClick={addAnnotation}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                )}

                {currentSlide.summary && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h3 className="text-sm font-medium text-blue-900 mb-2">Summary</h3>
                    <p className="text-sm text-blue-800">{currentSlide.summary}</p>
                  </div>
                )}
              </div>
            </div>

            {showThumbnails && (
              <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-slate-800">All Slides</h3>
                  <button
                    onClick={() => setShowThumbnails(false)}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.id}
                      onClick={() => {
                        setCurrentSlideIndex(index);
                        setShowThumbnails(false);
                      }}
                      className={`relative aspect-video bg-slate-100 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all ${
                        index === currentSlideIndex ? 'ring-2 ring-blue-600' : ''
                      }`}
                    >
                      <img
                        src={slide.image_url}
                        alt={`Slide ${slide.slide_number}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs py-1 text-center">
                        {slide.slide_number}
                      </div>
                      {bookmarks.some((b) => b.slide_id === slide.id) && (
                        <div className="absolute top-1 right-1">
                          <Bookmark className="h-3 w-3 text-yellow-400" fill="currentColor" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {showSummaryPanel && (
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl shadow-lg p-6 sticky top-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-slate-800">Slide Notes</h3>
                  <button
                    onClick={() => setShowSummaryPanel(false)}
                    className="text-slate-500 hover:text-slate-700 lg:hidden"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {currentSlide.extracted_text && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">Extracted Text</h4>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {currentSlide.extracted_text}
                      </p>
                    </div>
                  )}

                  {annotations.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">Annotations</h4>
                      <div className="space-y-2">
                        {annotations.map((annotation) => (
                          <div
                            key={annotation.id}
                            className="p-3 rounded-lg text-sm"
                            style={{ backgroundColor: `${annotation.color}40` }}
                          >
                            <MessageSquare className="h-4 w-4 inline mr-2" />
                            {annotation.content}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showFlashcards && (
        <FlashcardModal lectureId={lectureId} onClose={() => setShowFlashcards(false)} />
      )}

      {showQuiz && (
        <QuizModal lectureId={lectureId} onClose={() => setShowQuiz(false)} />
      )}
    </div>
  );
}

function FlashcardModal({ lectureId, onClose }: { lectureId: string; onClose: () => void }) {
  const [flashcards, setFlashcards] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFlashcards();
  }, [lectureId]);

  const loadFlashcards = async () => {
    try {
      const { data } = await supabase
        .from('flashcards')
        .select('*')
        .eq('lecture_id', lectureId)
        .order('created_at');

      setFlashcards(data || []);
    } catch (error) {
      console.error('Error loading flashcards:', error);
    } finally {
      setLoading(false);
    }
  };

  const nextCard = () => {
    setShowAnswer(false);
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const previousCard = () => {
    setShowAnswer(false);
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (flashcards.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-8 max-w-md">
          <h3 className="text-xl font-bold text-slate-800 mb-4">No Flashcards Yet</h3>
          <p className="text-slate-600 mb-6">Flashcards will be auto-generated when slides are processed.</p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const currentCard = flashcards[currentIndex];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h3 className="text-xl font-bold text-slate-800">Flashcards</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-8">
          <div className="text-center mb-4">
            <span className="text-sm text-slate-600">
              Card {currentIndex + 1} of {flashcards.length}
            </span>
          </div>

          <div
            onClick={() => setShowAnswer(!showAnswer)}
            className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-12 min-h-[300px] flex items-center justify-center cursor-pointer hover:shadow-xl transition-all"
          >
            <div className="text-center">
              <p className="text-2xl font-medium mb-4">
                {showAnswer ? currentCard.answer : currentCard.question}
              </p>
              <p className="text-sm opacity-75">Click to {showAnswer ? 'see question' : 'reveal answer'}</p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-6">
            <button
              onClick={previousCard}
              disabled={currentIndex === 0}
              className="px-6 py-3 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Previous
            </button>
            <button
              onClick={nextCard}
              disabled={currentIndex === flashcards.length - 1}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizModal({ lectureId, onClose }: { lectureId: string; onClose: () => void }) {
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(true);

  const MOCK_USER_ID = '00000000-0000-0000-0000-000000000000';

  useEffect(() => {
    loadQuestions();
  }, [lectureId]);

  const loadQuestions = async () => {
    try {
      const { data } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('lecture_id', lectureId)
        .order('created_at');

      setQuestions(data || []);
    } catch (error) {
      console.error('Error loading questions:', error);
    } finally {
      setLoading(false);
    }
  };

  const submitQuiz = async () => {
    const score = questions.reduce((acc, q, i) => {
      return acc + (answers[i] === q.correct_answer ? 1 : 0);
    }, 0);

    try {
      await supabase.from('quiz_attempts').insert({
        lecture_id: lectureId,
        user_id: MOCK_USER_ID,
        score,
        total_questions: questions.length,
        answers: JSON.stringify(answers),
      });
    } catch (error) {
      console.error('Error submitting quiz:', error);
    }

    setShowResults(true);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-8 max-w-md">
          <h3 className="text-xl font-bold text-slate-800 mb-4">No Quiz Available</h3>
          <p className="text-slate-600 mb-6">Quiz questions will be auto-generated when slides are processed.</p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (showResults) {
    const score = questions.reduce((acc, q, i) => {
      return acc + (answers[i] === q.correct_answer ? 1 : 0);
    }, 0);
    const percentage = Math.round((score / questions.length) * 100);

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl max-w-2xl w-full p-8">
          <div className="text-center">
            <CheckCircle2 className="h-20 w-20 text-green-500 mx-auto mb-4" />
            <h3 className="text-3xl font-bold text-slate-800 mb-2">Quiz Complete!</h3>
            <p className="text-5xl font-bold text-blue-600 my-6">{percentage}%</p>
            <p className="text-lg text-slate-600 mb-8">
              You got {score} out of {questions.length} questions correct
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  setAnswers({});
                  setCurrentIndex(0);
                  setShowResults(false);
                }}
                className="flex-1 px-6 py-3 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
              >
                Retake Quiz
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const options = JSON.parse(currentQuestion.options);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl max-w-2xl w-full my-8">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h3 className="text-xl font-bold text-slate-800">Quiz</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-8">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-slate-600">
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
                {currentQuestion.difficulty}
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2 mb-6">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          <h4 className="text-xl font-semibold text-slate-800 mb-6">
            {currentQuestion.question_text}
          </h4>

          <div className="space-y-3 mb-8">
            {options.map((option: string, i: number) => (
              <button
                key={i}
                onClick={() => setAnswers({ ...answers, [currentIndex]: option })}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  answers[currentIndex] === option
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="px-6 py-3 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            {currentIndex === questions.length - 1 ? (
              <button
                onClick={submitQuiz}
                disabled={Object.keys(answers).length !== questions.length}
                className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Quiz
              </button>
            ) : (
              <button
                onClick={() => setCurrentIndex(currentIndex + 1)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
