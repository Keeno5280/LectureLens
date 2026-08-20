import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Send,
  BookOpen,
  Trash2,
  Loader2,
  MessageSquare,
  PenTool,
  Layout,
  Plus,
  Brain
} from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import PaperEditor from '../components/PaperEditor';

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
  created_at: string;
  updated_at: string;
  class_id?: string;
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

type ViewMode = 'study' | 'write';

export default function TutorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('study');

  // Data State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);

  // UI State
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [classesError, setClassesError] = useState<string>('');
  // Lifted from PaperEditor so sendMessage can pass it to ai-tutor without
  // scraping the DOM for the assignment-prompt textarea's value.
  const [assignmentPrompt, setAssignmentPrompt] = useState<string>('');

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadInitialData();

    // Check for pending global query + class
    const pendingQuery = sessionStorage.getItem('tutor_initial_query');
    const pendingClass = sessionStorage.getItem('tutor_initial_class');

    if (pendingClass) {
      setSelectedClassId(pendingClass);
      sessionStorage.removeItem('tutor_initial_class');
    }

    if (pendingQuery) {
      setInputMessage(pendingQuery);
      sessionStorage.removeItem('tutor_initial_query');
      // Auto-send if class is selected (which it should be now)
      setTimeout(() => {
        if (pendingClass) {
          const sendBtn = document.querySelector('button[aria-label="Send Message"]') || document.querySelector('.lucide-send')?.closest('button');
          if (sendBtn instanceof HTMLElement) sendBtn.click();
        } else {
          inputRef.current?.focus();
        }
      }, 800);
    }
  }, []);

  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id);
    }
    // Each conversation has its own paper; clear the stale prompt until
    // PaperEditor reports the new one via onAssignmentPromptChange.
    setAssignmentPrompt('');
  }, [currentConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, viewMode]); // Scroll when messages change or layout changes

  useEffect(() => {
    setMessages([]);
    loadConversations();
  }, [selectedClassId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadInitialData = async () => {
    await Promise.all([
      loadConversations(),
      loadQuickActions(),
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
      let query = supabase
        .from('tutor_conversations')
        .select('*')
        .eq('user_id', user?.id);

      if (selectedClassId) {
        query = query.eq('class_id', selectedClassId);
      }

      const { data } = await query.order('updated_at', { ascending: false });

      if (data && data.length > 0) {
        setConversations(data);
        // Only auto-select the first conversation if we aren't already viewing one
        if (!currentConversation) {
          setCurrentConversation(data[0]);
        }
      } else {
        setConversations([]);
        setCurrentConversation(null);
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



  const createNewConversation = async () => {
    // Logic handled dynamically in sendMessage if no conversation selected
    // But explicit "New Chat" button needs this:
    const { data } = await supabase
      .from('tutor_conversations')
      .insert({
        user_id: user?.id,
        title: 'New Conversation',
        class_id: selectedClassId || null,
      })
      .select()
      .single();

    if (data) {
      setConversations([data, ...conversations]);
      setCurrentConversation(data);
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;
    if (!selectedClassId) return; // Enforce class selection

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsTyping(true);

    let conversationToUse = currentConversation;

    if (!conversationToUse) {
      const { data } = await supabase
        .from('tutor_conversations')
        .insert({
          user_id: user?.id,
          title: userMessage.substring(0, 50),
          class_id: selectedClassId,
        })
        .select()
        .single();

      if (data) {
        conversationToUse = data;
        setCurrentConversation(data);
        setConversations([data, ...conversations]);
      } else {
        setIsTyping(false);
        return;
      }
    }

    if (!conversationToUse) return; // Strict check for TS

    const userMsgData = {
      conversation_id: conversationToUse.id,
      role: 'user',
      content: userMessage,
    };

    setMessages(prev => [...prev, { ...userMsgData, id: 'temp-user', created_at: new Date().toISOString() } as Message]);

    try {
      // The ai-tutor edge function stores both the user and assistant
      // messages itself (and does the class-scoped context lookup), so we
      // do NOT insert userMsgData here — only the optimistic local echo above.
      const { data, error } = await supabase.functions.invoke('ai-tutor', {
        body: {
          conversationId: conversationToUse.id,
          message: userMessage,
          classId: selectedClassId || null,
          assignmentPrompt: assignmentPrompt || null,
        },
      });

      if (error) throw new Error(error.message);
      if (!data || typeof data.answer !== 'string') {
        throw new Error('AI tutor returned no answer');
      }

      // Refresh messages to get the real rows (with real IDs) the edge
      // function just wrote.
      loadMessages(conversationToUse.id);

    } catch (error) {
      console.error('Error sending message:', error);
      alert('The AI tutor failed to respond');
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    setInputMessage(action.query_template);
    inputRef.current?.focus();
  };

  const handleAskAI = (text: string, context: string) => {
    const prompt = context
      ? `I am working on this assignment: "${context}".\n\nI need help with this text:\n"${text}"`
      : `I need help with this text from my paper:\n"${text}"`;

    setInputMessage(prompt);
    // Optional: Auto-focus input
    inputRef.current?.focus();
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    await supabase.from('tutor_conversations').delete().eq('id', id);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (currentConversation?.id === id) setCurrentConversation(null);
  };

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex overflow-hidden">

      {/* Sidebar - Always visible */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col flex-shrink-0 z-20 shadow-sm">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <button
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 mb-6 transition-colors font-medium"
          >
            ← Back to Dashboard
          </button>

          {/* Mode Switcher */}
          <div className="bg-slate-200/50 p-1 rounded-xl flex mb-2">
            <button
              onClick={() => setViewMode('study')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === 'study' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Layout className="w-4 h-4" />
              Study Chat
            </button>
            <button
              onClick={() => setViewMode('write')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === 'write' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <PenTool className="w-4 h-4" />
              Paper Lab
            </button>
          </div>
          <p className="text-[10px] text-center text-slate-400 font-medium tracking-wide uppercase">
            {viewMode === 'write' ? 'Split Screen Mode' : 'Standard Chat Mode'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Conversations
            </h3>
            <button onClick={createNewConversation} className="text-blue-600 hover:text-blue-700">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => {
                  setCurrentConversation(conv);
                  if (conv.class_id && conv.class_id !== selectedClassId) {
                    setSelectedClassId(conv.class_id);
                  }
                }}
                className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm ${currentConversation?.id === conv.id
                  ? 'bg-blue-50 border-blue-200 shadow-sm'
                  : 'bg-white border-transparent hover:border-slate-200'
                  }`}
              >
                <p className={`text-sm font-medium truncate ${currentConversation?.id === conv.id ? 'text-blue-700' : 'text-slate-700'}`}>{conv.title}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-400">{new Date(conv.created_at).toLocaleDateString()}</span>
                  <div
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="text-slate-300 hover:text-red-500 p-1 rounded hover:bg-red-50 transition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </div>
                </div>
              </button>
            ))}

            {conversations.length === 0 && (
              <div className="text-center py-8 px-4 border-2 border-dashed border-slate-100 rounded-xl">
                <MessageSquare className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">No chats yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area - Handles Split or Full View */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Paper Editor (Visible only in Write Mode) */}
        {viewMode === 'write' && (
          <div className="flex-[1.4] border-r border-slate-200 bg-white h-full overflow-hidden flex flex-col shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)] z-10">
            {currentConversation && user ? (
              <PaperEditor
                conversationId={currentConversation.id}
                userId={user.id} // Should use real user from AuthContext in prod
                onAskAI={handleAskAI}
                onAssignmentPromptChange={setAssignmentPrompt}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center bg-slate-50/50">
                <div>
                  <div className="w-16 h-16 bg-purple-100 text-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <PenTool className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700">Select a Conversation</h3>
                  <p className="text-slate-500 max-w-xs mx-auto mt-2">
                    Open a chat to load its associated paper draft. Every chat has one paper.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI Chat (Always Visible, but adapts width) */}
        <div className="flex-1 flex flex-col h-full bg-slate-50 relative">

          {/* Class Selector Header */}
          <div className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm flex items-center justify-between flex-shrink-0">
            <div>
              <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                {viewMode === 'write' ? (
                  <>
                    <Brain className="w-5 h-5 text-purple-600" />
                    AI Co-Pilot
                  </>
                ) : (
                  <>
                    <Brain className="w-6 h-6 text-blue-600" />
                    AI Tutor
                  </>
                )}
              </h1>
            </div>

            {/* Class Dropdown */}
            <div className="flex items-center gap-2">
              {isLoadingClasses ? (
                <span className="text-xs text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /></span>
              ) : (
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="text-sm border-none bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 focus:ring-0 cursor-pointer font-medium text-slate-700 transition"
                >
                  <option value="" disabled>Select Class...</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
            {messages.length === 0 && !selectedClassId ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-60">
                <BookOpen className="w-12 h-12 text-slate-300 mb-4" />
                <p className="text-slate-500 font-medium">Please select a class to begin.</p>
              </div>
            ) : (
              <div className="space-y-6 max-w-2xl mx-auto">
                {messages.length === 0 && (
                  <div className="text-center py-10">
                    <p className="text-sm text-slate-400">Start asking questions about your lectures!</p>
                    <div className="flex flex-wrap gap-2 justify-center mt-4">
                      {quickActions.slice(0, 3).map(qa => (
                        <button
                          key={qa.id}
                          onClick={() => handleQuickAction(qa)}
                          className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-full hover:border-blue-400 hover:text-blue-600 transition"
                        >
                          {qa.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 shadow-sm text-sm leading-relaxed ${msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-none'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-tl-none'
                      }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-2">
                      <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                      <span className="text-xs text-slate-400 font-medium">Thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 bg-white border-t border-slate-200 z-10">
            <div className="max-w-2xl mx-auto flex items-end gap-2">
              <div className="flex-1 bg-slate-100 rounded-xl px-4 py-3 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:bg-white transition-all border border-transparent focus-within:border-blue-200">
                <input
                  ref={inputRef}
                  className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm text-slate-800 placeholder-slate-400 resize-none"
                  placeholder={viewMode === 'write' ? "Ask for help with your paper..." : "Ask a question..."}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
              </div>
              <button
                onClick={() => sendMessage()}
                disabled={!inputMessage.trim() || isTyping || !selectedClassId}
                className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-200 transition-all active:scale-95"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div >
  );
}
