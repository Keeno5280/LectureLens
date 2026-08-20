import React, { useState, useEffect, useRef } from 'react';
import { Brain, X, Send, Sparkles, ChevronDown, Loader2 } from 'lucide-react';
import { useNavigate } from '../hooks/useNavigate';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function GlobalChatWidget() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);

    // Chat State
    const [messages, setMessages] = useState<any[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [selectedClassId, setSelectedClassId] = useState('');
    const [classes, setClasses] = useState<any[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            loadClasses();
            scrollToBottom();
        }
    }, [isOpen, messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const loadClasses = async () => {
        const { data } = await supabase.from('classes').select('id, name').order('name');
        if (data) setClasses(data);
    };

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputMessage.trim() || !selectedClassId || !user) return;

        const userText = inputMessage.trim();
        setInputMessage('');
        setIsTyping(true);

        // Optimistic Update
        const tempId = Date.now().toString();
        setMessages(prev => [...prev, { id: tempId, role: 'user', content: userText }]);

        try {
            let currentConvoId = conversationId;

            // 1. Create Conversation if first message
            if (!currentConvoId) {
                const { data: convo } = await supabase
                    .from('tutor_conversations')
                    .insert({
                        user_id: user.id,
                        title: `Quick Chat: ${userText.substring(0, 30)}...`,
                        class_id: selectedClassId,
                    })
                    .select()
                    .single();

                if (convo) {
                    setConversationId(convo.id);
                    currentConvoId = convo.id;
                }
            }

            if (!currentConvoId) throw new Error("Failed to create conversation");

            // 2. Insert User Message
            await supabase.from('tutor_messages').insert({
                conversation_id: currentConvoId,
                role: 'user',
                content: userText
            });

            // 3. Call AI Webhook
            const response = await fetch('https://n8n-e2ph.onrender.com/webhook/ai-tutor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: userText,
                    class_id: selectedClassId,
                    conversation_id: currentConvoId,
                }),
            });

            if (!response.ok) throw new Error('AI Error');
            const result = await response.json();
            const aiResponse = result.answer || "I'm having trouble thinking right now.";

            // 4. Update UI with AI Response
            setMessages(prev => [...prev, { id: Date.now().toString() + 'ai', role: 'assistant', content: aiResponse }]);

            // 5. Save AI Message to DB
            await supabase.from('tutor_messages').insert({
                conversation_id: currentConvoId,
                role: 'assistant',
                content: aiResponse
            });

        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev, { id: 'err', role: 'assistant', content: "Sorry, something went wrong." }]);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">

            {/* Expanded Chat Input Bubble */}
            {isOpen && (
                <div className="mb-4 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden transform transition-all duration-300 origin-bottom-right animate-in fade-in slide-in-from-bottom-4">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-white">
                            <Sparkles className="w-4 h-4" />
                            <span className="font-semibold text-sm">Quick Tutor</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Expand Button (Go to Full Page) */}
                            {conversationId && (
                                <button
                                    onClick={() => {
                                        navigate('tutor'); // Logic to open specific convo could occur here if TutorPage supported convoId param
                                    }}
                                    className="text-white/80 hover:text-white text-[10px] bg-white/10 px-2 py-0.5 rounded"
                                >
                                    Full View
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-white/80 hover:text-white transition"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Chat Area */}
                    <div className="flex-1 bg-slate-50 p-3 overflow-y-auto min-h-[250px] max-h-[400px]">
                        {!selectedClassId && messages.length === 0 && (
                            <div className="text-center mt-10 opacity-60">
                                <Brain className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                <p className="text-xs text-slate-500">Pick a class to start.</p>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex mb-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed shadow-sm ${msg.role === 'user'
                                        ? 'bg-blue-600 text-white rounded-tr-none'
                                        : 'bg-white text-slate-700 border border-slate-200 rounded-tl-none'
                                    }`}>
                                    {msg.content}
                                </div>
                            </div>
                        ))}

                        {isTyping && (
                            <div className="flex justify-start mb-2">
                                <div className="bg-white border border-slate-200 rounded-xl rounded-tl-none px-3 py-2 shadow-sm">
                                    <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <form onSubmit={sendMessage} className="p-3 bg-white border-t border-slate-100">

                        {/* Class Selector (Only show if not set or allow changing?) -> Better to lock once started? Use simplifed logic for now */}
                        {!conversationId && (
                            <div className="mb-2">
                                <div className="relative">
                                    <select
                                        value={selectedClassId}
                                        onChange={(e) => setSelectedClassId(e.target.value)}
                                        className="w-full appearance-none bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 pr-8 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                                        required
                                    >
                                        <option value="" disabled>Select Class...</option>
                                        {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-2 w-3 h-3 text-slate-400 pointer-events-none" />
                                </div>
                            </div>
                        )}

                        <div className="relative flex items-end gap-2">
                            <textarea
                                value={inputMessage}
                                onChange={(e) => setInputMessage(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); }
                                }}
                                placeholder="Ask your question..."
                                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none h-10 max-h-24"
                                disabled={!selectedClassId}
                            />
                            <button
                                type="submit"
                                disabled={!inputMessage.trim() || !selectedClassId || isTyping}
                                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                                <Send className="w-3 h-3" />
                            </button>
                        </div>
                    </form>              </div>
            )}

            {/* Floating Action Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`group relative flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 ${isOpen ? 'bg-slate-800 rotate-90' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-blue-500/30'
                    }`}
            >
                {/* Pulse Effect */}
                {!isOpen && (
                    <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-20 animate-ping"></span>
                )}

                {isOpen ? (
                    <X className="w-6 h-6 text-white transition-transform" />
                ) : (
                    <Brain className="w-7 h-7 text-white" />
                )}
            </button>
        </div>
    );
}
