import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  Send,
  Lightbulb,
  FileText,
  Brain,
  HelpCircle,
  BookOpen,
  Save,
  CreditCard,
  Trash2,
  X,
  Plus,
  Check,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';

const MOCK_USER_ID = '00000000-0000-0000-0000-000000000000';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ type: string; reference: string }>;
  query_type?: string;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  context_lectures: string[];
  context_slides: string[];
  updated_at: string;
}

interface QuickAction {
  id: string;
  label: string;
  query_template: string;
  icon: string;
}

interface ContextItem {
  id: string;
  type: 'lecture' | 'slide';
  title: string;
  subtitle?: string;
}

interface ClassOption {
  id: string;
  name: string;
  professor: string;
}

export default function TutorPage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [availableContext, setAvailableContext] = useState<ContextItem[]>([]);
  const [selectedContext, setSelectedContext] = useState<string[]>([]);
  const [showContextSelector, setShowContextSelector] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [selectedMessageForSave, setSelectedMessageForSave] = useState<Message | null>(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveCategory, setSaveCategory] = useState<'note' | 'flashcard' | 'summary'>('note');
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [classesError, setClassesError] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id);
    }
  }, [currentConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadAvailableContext();
  }, [selectedClassId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadInitialData = async () => {
    await Promise.all([
      loadConversations(),
      loadQuickActions(),
      loadAvailableContext(),
      loadClasses(),
    ]);
  };

  const loadClasses = async () => {
    setIsLoadingClasses(true);
    setClassesError('');

    try {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, professor')
        .order('name');

      if (error) throw error;

      setClasses(data || []);
    } catch (error) {
      console.error('Error loading classes:', error);
      setClassesError('Failed to load classes');
    } finally {
      setIsLoadingClasses(false);
    }
  };

  const loadConversations = async () => {
    try {
      const { data } = await supabase
        .from('tutor_conversations')
        .select('*')
        .eq('user_id', MOCK_USER_ID)
        .order('updated_at', { ascending: false });

      if (data && data.length > 0) {
        setConversations(data);
        setCurrentConversation(data[0]);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const { data } = await supabase
        .from('tutor_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at');

      const normalizedMessages = (data || []).map(msg => ({
        ...msg,
        sources: Array.isArray(msg.sources) ? msg.sources : (msg.sources ? [] : [])
      }));

      setMessages(normalizedMessages);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const loadQuickActions = async () => {
    try {
      const { data } = await supabase
        .from('tutor_quick_actions')
        .select('*')
        .is('user_id', null)
        .order('sort_order');

      setQuickActions(data || []);
    } catch (error) {
      console.error('Error loading quick actions:', error);
    }
  };

  const loadAvailableContext = async () => {
    try {
      let query = supabase
        .from('lectures')
        .select('id, title, recording_date, class_id')
        .eq('processing_status', 'completed')
        .order('recording_date', { ascending: false })
        .limit(20);

      if (selectedClassId) {
        query = query.eq('class_id', selectedClassId);
      }

      const [lecturesRes, slidesRes] = await Promise.all([
        query,
        supabase
          .from('slides')
          .select('id, slide_number, summary, lecture_id, lectures(title)')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const contextItems: ContextItem[] = [];

      if (lecturesRes.data) {
        lecturesRes.data.forEach((lecture) => {
          contextItems.push({
            id: lecture.id,
            type: 'lecture',
            title: lecture.title,
            subtitle: new Date(lecture.recording_date).toLocaleDateString(),
          });
        });
      }

      setAvailableContext(contextItems);
    } catch (error) {
      console.error('Error loading context:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const { data } = await supabase
        .from('tutor_conversations')
        .insert({
          user_id: MOCK_USER_ID,
          title: 'New Conversation',
          context_lectures: JSON.stringify([]),
          context_slides: JSON.stringify([]),
        })
        .select()
        .single();

      if (data) {
        setConversations([data, ...conversations]);
        setCurrentConversation(data);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
    }
  };

  const sendMessage = async (queryType: string = 'general', complexityLevel: string = 'medium') => {
    if (!inputMessage.trim() || !currentConversation) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsTyping(true);

    const userMsgData = {
      id: crypto.randomUUID(),
      conversation_id: currentConversation.id,
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    setMessages([...messages, userMsgData as Message]);

    try {
      await supabase.from('tutor_messages').insert(userMsgData);

      const apiUrl = 'https://n8n-e2ph.onrender.com/webhook/4109c225-7faa-4672-80a6-57c05e383026';
      const headers = {
        'Content-Type': 'application/json',
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: userMessage,
          class_id: selectedClassId || null,
        }),
      });

      if (!response.ok) throw new Error('The AI tutor failed to respond');

      const result = await response.json();

      const assistantMsgData = {
        id: crypto.randomUUID(),
        conversation_id: currentConversation.id,
        role: 'assistant',
        content: result.answer || 'No response received',
        created_at: new Date().toISOString(),
      };

      await supabase.from('tutor_messages').insert(assistantMsgData);
      setMessages((prev) => [...prev, assistantMsgData as Message]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('The AI tutor failed to respond');
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    const template = action.query_template;
    setInputMessage(template);
    inputRef.current?.focus();
  };

  const saveResponse = async () => {
    if (!selectedMessageForSave || !saveTitle.trim()) return;

    try {
      await supabase.from('saved_tutor_responses').insert({
        user_id: MOCK_USER_ID,
        message_id: selectedMessageForSave.id,
        title: saveTitle,
        category: saveCategory,
        tags: JSON.stringify([]),
      });

      if (saveCategory === 'flashcard') {
        await supabase.from('tutor_flashcards').insert({
          user_id: MOCK_USER_ID,
          message_id: selectedMessageForSave.id,
          question: saveTitle,
          answer: selectedMessageForSave.content,
          difficulty: 'medium',
        });
      }

      setShowSaveDialog(false);
      setSelectedMessageForSave(null);
      setSaveTitle('');
      alert('Response saved successfully!');
    } catch (error) {
      console.error('Error saving response:', error);
      alert('Failed to save response');
    }
  };

  const deleteConversation = async (id: string) => {
    if (!confirm('Delete this conversation?')) return;

    try {
      await supabase.from('tutor_conversations').delete().eq('id', id);
      setConversations(conversations.filter((c) => c.id !== id));
      if (currentConversation?.id === id) {
        setCurrentConversation(conversations[0] || null);
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  const getQueryTypeIcon = (type?: string) => {
    switch (type) {
      case 'explain':
        return <Lightbulb className="h-4 w-4" />;
      case 'summarize':
        return <FileText className="h-4 w-4" />;
      case 'mnemonic':
        return <Brain className="h-4 w-4" />;
      case 'question':
        return <HelpCircle className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex">
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <button
            onClick={() => navigate('dashboard')}
            className="text-sm text-slate-600 hover:text-blue-600 mb-4 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <button
            onClick={createNewConversation}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium"
          >
            <Plus className="h-5 w-5" />
            New Conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Conversations
          </h3>
          <div className="space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setCurrentConversation(conv)}
                className={`w-full text-left p-3 rounded-lg transition-all ${
                  currentConversation?.id === conv.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'bg-slate-50 border border-transparent hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{conv.title}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {new Date(conv.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="ml-2 p-1 text-slate-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200">
          <button
            onClick={() => setShowContextSelector(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all text-sm font-medium"
          >
            <BookOpen className="h-4 w-4" />
            Select Context ({selectedContext.length})
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {currentConversation ? (
          <>
            <div className="bg-white border-b border-slate-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h1 className="text-xl font-bold text-slate-800">{currentConversation.title}</h1>
                  <p className="text-sm text-slate-500 mt-1">
                    Ask me anything about your uploaded materials
                  </p>
                </div>
                <div className="ml-6">
                  <label className="block text-xs font-medium text-slate-600 mb-2">
                    Filter by Class
                  </label>
                  {isLoadingClasses ? (
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </div>
                  ) : classesError ? (
                    <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                      {classesError}
                    </div>
                  ) : (
                    <select
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                      className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[200px] cursor-pointer hover:border-slate-400 transition-colors"
                    >
                      <option value="">All Classes</option>
                      {classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name} - {cls.professor}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="max-w-4xl mx-auto space-y-4">
                {messages.length === 0 && (
                  <div className="text-center py-12">
                    <Brain className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">
                      Start a conversation
                    </h3>
                    <p className="text-slate-500 mb-6">
                      Ask questions, request explanations, or get help understanding your course
                      materials
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center max-w-2xl mx-auto">
                      {quickActions.map((action) => (
                        <button
                          key={action.id}
                          onClick={() => handleQuickAction(action)}
                          className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-all text-sm font-medium"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-3xl ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm'
                          : 'bg-white text-slate-800 rounded-2xl rounded-tl-sm shadow-md border border-slate-200'
                      } px-6 py-4`}
                    >
                      {message.role === 'assistant' && message.query_type && (
                        <div className="flex items-center gap-2 mb-2 text-slate-500">
                          {getQueryTypeIcon(message.query_type)}
                          <span className="text-xs font-medium uppercase">
                            {message.query_type}
                          </span>
                        </div>
                      )}

                      <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>

                      {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                          <p className="text-xs font-medium text-slate-500 mb-2">Sources:</p>
                          <div className="space-y-1">
                            {message.sources.map((source, idx) => (
                              <div key={idx} className="text-xs text-slate-600 flex items-center gap-2">
                                <BookOpen className="h-3 w-3" />
                                {source.reference}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {message.role === 'assistant' && (
                        <div className="mt-4 flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedMessageForSave(message);
                              setSaveTitle(message.content.substring(0, 50));
                              setShowSaveDialog(true);
                            }}
                            className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all text-xs font-medium flex items-center gap-1"
                          >
                            <Save className="h-3 w-3" />
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setSelectedMessageForSave(message);
                              setSaveCategory('flashcard');
                              setSaveTitle('Q: ' + messages[messages.indexOf(message) - 1]?.content.substring(0, 50));
                              setShowSaveDialog(true);
                            }}
                            className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all text-xs font-medium flex items-center gap-1"
                          >
                            <CreditCard className="h-3 w-3" />
                            Flashcard
                          </button>
                        </div>
                      )}

                      <p className="text-xs mt-3 opacity-60">
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white text-slate-800 rounded-2xl rounded-tl-sm shadow-md border border-slate-200 px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        <span className="text-sm text-slate-600">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="bg-white border-t border-slate-200 px-6 py-4">
              <div className="max-w-4xl mx-auto">
                <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
                  {quickActions.slice(0, 5).map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action)}
                      className="flex-shrink-0 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all text-sm flex items-center gap-2"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-end gap-3">
                  <div className="flex-1 relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="Ask a question about your materials..."
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-12"
                      disabled={isTyping}
                    />
                  </div>
                  <button
                    onClick={() => sendMessage()}
                    disabled={!inputMessage.trim() || isTyping}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium flex items-center gap-2"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-20 w-20 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-700 mb-2">
                No conversation selected
              </h3>
              <p className="text-slate-500 mb-6">Create a new conversation to get started</p>
              <button
                onClick={createNewConversation}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium"
              >
                Start Chatting
              </button>
            </div>
          </div>
        )}
      </div>

      {showContextSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h3 className="text-xl font-bold text-slate-800">Select Context Materials</h3>
              <button
                onClick={() => setShowContextSelector(false)}
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-slate-600 mb-4">
                Choose which lectures and materials the AI should reference when answering your
                questions.
              </p>

              <div className="space-y-2">
                {availableContext.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedContext((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((id) => id !== item.id)
                          : [...prev, item.id]
                      );
                    }}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      selectedContext.includes(item.id)
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-800">{item.title}</p>
                        {item.subtitle && (
                          <p className="text-sm text-slate-500 mt-1">{item.subtitle}</p>
                        )}
                      </div>
                      {selectedContext.includes(item.id) && (
                        <Check className="h-5 w-5 text-blue-600" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 border-t border-slate-200">
              <button
                onClick={() => setShowContextSelector(false)}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium"
              >
                Done ({selectedContext.length} selected)
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h3 className="text-xl font-bold text-slate-800">Save Response</h3>
              <button
                onClick={() => setShowSaveDialog(false)}
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Title</label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter a title..."
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">Save As</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['note', 'flashcard', 'summary'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSaveCategory(cat)}
                      className={`px-4 py-2 rounded-lg border-2 transition-all capitalize ${
                        saveCategory === cat
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={saveResponse}
                disabled={!saveTitle.trim()}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
