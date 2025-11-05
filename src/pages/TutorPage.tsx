import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Send,
  Search,
  Plus,
  MessageSquare,
  Loader2,
  ArrowLeft,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import Toast from '../components/Toast';

interface Message {
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  user_id: string;
  class_id: string;
  summary: string | null;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

interface Class {
  id: string;
  name: string;
  code: string;
}

type ToastState = {
  message: string;
  type: 'success' | 'error';
} | null;

export default function TutorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [toast, setToast] = useState<ToastState>(null);
  const [lastMessageTime, setLastMessageTime] = useState<number>(Date.now());
  const [summaryTimer, setSummaryTimer] = useState<NodeJS.Timeout | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      loadClasses();
    }
  }, [user]);

  useEffect(() => {
    if (selectedClassId) {
      loadConversations();
    }
  }, [selectedClassId]);

  useEffect(() => {
    if (currentConversation) {
      setMessages(currentConversation.messages || []);
    }
  }, [currentConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const filtered = conversations.filter((conv) =>
      conv.summary?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredConversations(filtered);
  }, [searchQuery, conversations]);

  useEffect(() => {
    if (summaryTimer) {
      clearTimeout(summaryTimer);
    }

    if (currentConversation && messages.length > 0) {
      const timer = setTimeout(() => {
        generateSummary();
      }, 60000);
      setSummaryTimer(timer);
    }

    return () => {
      if (summaryTimer) {
        clearTimeout(summaryTimer);
      }
    };
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadClasses = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, code')
        .eq('user_id', user.id)
        .order('name');

      if (error) throw error;

      if (data && data.length > 0) {
        setClasses(data);
        setSelectedClassId(data[0].id);
      }
    } catch (error) {
      console.error('Error loading classes:', error);
      setToast({
        message: 'Failed to load classes',
        type: 'error',
      });
    }
  };

  const loadConversations = async () => {
    if (!user || !selectedClassId) return;

    try {
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('user_id', user.id)
        .eq('class_id', selectedClassId)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      setConversations(data || []);
      setFilteredConversations(data || []);

      if (data && data.length > 0 && !currentConversation) {
        setCurrentConversation(data[0]);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
      setToast({
        message: 'Failed to load conversations',
        type: 'error',
      });
    }
  };

  const createNewConversation = async () => {
    if (!user || !selectedClassId) return;

    try {
      const { data, error } = await supabase
        .from('ai_conversations')
        .insert({
          user_id: user.id,
          class_id: selectedClassId,
          messages: [],
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setConversations([data, ...conversations]);
        setCurrentConversation(data);
        setMessages([]);
        setToast({
          message: 'New conversation started',
          type: 'success',
        });
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
      setToast({
        message: 'Failed to create conversation',
        type: 'error',
      });
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !currentConversation || !user || isTyping) return;

    const userMessage: Message = {
      sender: 'user',
      text: inputMessage.trim(),
      timestamp: new Date().toISOString(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputMessage('');
    setIsTyping(true);
    setLastMessageTime(Date.now());

    try {
      const response = await fetch('https://n8n-e2ph.onrender.com/webhook/ai-tutor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          class_id: selectedClassId,
          question: userMessage.text,
        }),
      });

      if (!response.ok) throw new Error('Failed to get AI response');

      const result = await response.json();

      const aiMessage: Message = {
        sender: 'assistant',
        text: result.answer || result.response || 'Sorry, I could not process your request.',
        timestamp: new Date().toISOString(),
      };

      const updatedMessages = [...newMessages, aiMessage];
      setMessages(updatedMessages);

      await supabase
        .from('ai_conversations')
        .update({
          messages: updatedMessages,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentConversation.id);

      setCurrentConversation({
        ...currentConversation,
        messages: updatedMessages,
      });

      await loadConversations();
    } catch (error) {
      console.error('Error sending message:', error);
      setToast({
        message: 'Failed to send message. Please try again.',
        type: 'error',
      });
    } finally {
      setIsTyping(false);
    }
  };

  const generateSummary = async () => {
    if (!currentConversation || messages.length === 0) return;

    try {
      const last10Messages = messages.slice(-10);

      const response = await fetch('https://n8n-e2ph.onrender.com/webhook/ai-tutor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'summarize_conversation',
          messages: last10Messages,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate summary');

      const result = await response.json();
      const summary = result.summary || result.Summary || 'Conversation summary';

      await supabase
        .from('ai_conversations')
        .update({ summary })
        .eq('id', currentConversation.id);

      setCurrentConversation({
        ...currentConversation,
        summary,
      });

      await loadConversations();
    } catch (error) {
      console.error('Error generating summary:', error);
    }
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm('Delete this conversation? This action cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('ai_conversations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setConversations(conversations.filter((c) => c.id !== id));

      if (currentConversation?.id === id) {
        const remaining = conversations.filter((c) => c.id !== id);
        setCurrentConversation(remaining[0] || null);
        setMessages(remaining[0]?.messages || []);
      }

      setToast({
        message: 'Conversation deleted',
        type: 'success',
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      setToast({
        message: 'Failed to delete conversation',
        type: 'error',
      });
    }
  };

  const selectConversation = (conversation: Conversation) => {
    setCurrentConversation(conversation);
    setMessages(conversation.messages || []);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Please log in to use the AI Tutor</p>
          <button
            onClick={() => navigate('login')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex flex-col">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-lg">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white">
            <button
              onClick={() => navigate('dashboard')}
              className="flex items-center gap-2 text-blue-100 hover:text-white mb-4 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back to Dashboard</span>
            </button>
            <div className="flex items-center gap-3 mb-2">
              <MessageSquare className="w-8 h-8" />
              <h1 className="text-2xl font-bold">AI Tutor</h1>
            </div>
            <p className="text-blue-100 text-sm">Conversations</p>
          </div>

          <div className="p-4 border-b border-gray-200">
            <button
              onClick={createNewConversation}
              disabled={!selectedClassId}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-5 h-5" />
              New Conversation
            </button>
          </div>

          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {filteredConversations.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">
                  {searchQuery ? 'No conversations found' : 'No conversations yet'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => selectConversation(conv)}
                    className={`w-full text-left p-3 rounded-lg transition group ${
                      currentConversation?.id === conv.id
                        ? 'bg-blue-50 border-2 border-blue-200 shadow-sm'
                        : 'bg-gray-50 border-2 border-transparent hover:border-gray-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">
                          {conv.summary || 'New conversation'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(conv.updated_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">AI Tutor Chat</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Ask questions about your course materials
                </p>
              </div>
              <div className="relative">
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="appearance-none pl-4 pr-10 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium text-gray-700"
                >
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.code} - {cls.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 bg-gradient-to-br from-gray-50 to-blue-50">
            <div className="max-w-4xl mx-auto space-y-4">
              {messages.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="w-10 h-10 text-blue-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    Start a Conversation
                  </h3>
                  <p className="text-gray-600 max-w-md mx-auto">
                    Ask me anything about your lectures, slides, and course materials.
                    I'm here to help you understand and review!
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${
                        message.sender === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-2xl px-6 py-4 rounded-2xl shadow-md ${
                          message.sender === 'user'
                            ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-tr-sm'
                            : 'bg-white text-gray-800 rounded-tl-sm border border-gray-200'
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                        <p
                          className={`text-xs mt-2 ${
                            message.sender === 'user' ? 'text-blue-100' : 'text-gray-500'
                          }`}
                        >
                          {new Date(message.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  ))}

                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="max-w-2xl px-6 py-4 rounded-2xl rounded-tl-sm shadow-md bg-white border border-gray-200">
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                          <span className="text-gray-600 font-medium">
                            The tutor is thinking...
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
          </div>

          <div className="bg-white border-t border-gray-200 px-6 py-4 shadow-lg">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-end gap-3">
                <div className="flex-1">
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
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isTyping || !currentConversation}
                  />
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!inputMessage.trim() || isTyping || !currentConversation}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium flex items-center gap-2 shadow-md hover:shadow-lg"
                >
                  <Send className="w-5 h-5" />
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
