import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
// import BubbleMenuExtension from '@tiptap/extension-bubble-menu';
import { useEffect, useState, useRef } from 'react';
import { Loader2, Check, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Props = {
    conversationId: string;
    userId: string;
    onAskAI?: (text: string, context: string) => void;
};

export default function PaperEditor({ conversationId, userId, onAskAI }: Props) {
    const [paperId, setPaperId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [title, setTitle] = useState('Untitled Paper');
    const [assignmentPrompt, setAssignmentPrompt] = useState('');
    const [showPrompt, setShowPrompt] = useState(true);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Load or Create Paper on Mount
    useEffect(() => {
        async function loadPaper() {
            // Try to find existing paper for this conversation
            const { data } = await supabase
                .from('papers')
                .select('*')
                .eq('conversation_id', conversationId)
                .maybeSingle();

            if (data) {
                setPaperId(data.id);
                setTitle(data.title);
                setAssignmentPrompt(data.assignment_prompt || '');
                if (editor && data.content && Object.keys(data.content).length > 0) {
                    editor.commands.setContent(data.content);
                }
            } else {
                // Create new paper if none exists
                const { data: newPaper } = await supabase
                    .from('papers')
                    .insert({
                        user_id: userId,
                        conversation_id: conversationId,
                        title: 'Untitled Paper',
                        content: {},
                        assignment_prompt: ''
                    })
                    .select()
                    .single();

                if (newPaper) {
                    setPaperId(newPaper.id);
                }
            }
        }

        if (conversationId && userId) {
            loadPaper();
        }
    }, [conversationId, userId]);

    const editor = useEditor({
        extensions: [
            StarterKit,
            Placeholder.configure({
                placeholder: 'Start writing your paper here...',
            }),
            // BubbleMenuExtension,
        ],
        editorProps: {
            attributes: {
                class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[500px] px-8 py-6',
            },
        },
        onUpdate: () => {
            triggerSave();
        },
    });

    // Handle auto-saving
    const triggerSave = () => {
        setSaving(true);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = setTimeout(async () => {
            if (!paperId || !editor) return;

            const content = editor.getJSON();

            await supabase
                .from('papers')
                .update({
                    content,
                    title,
                    assignment_prompt: assignmentPrompt,
                    updated_at: new Date().toISOString()
                })
                .eq('id', paperId);

            setSaving(false);
            setLastSaved(new Date());
        }, 1500); // Debounce 1.5s
    };

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTitle(e.target.value);
        triggerSave();
    };

    const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setAssignmentPrompt(e.target.value);
        triggerSave();
    };

    if (!editor || !paperId) {
        return (
            <div className="flex h-full items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                Loading Paper...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white relative">
            <div className="border-b border-gray-100 bg-white sticky top-0 z-10 shadow-sm">
                <div className="p-4 flex items-center justify-between">
                    <input
                        type="text"
                        value={title}
                        onChange={handleTitleChange}
                        className="text-2xl font-bold text-gray-800 placeholder-gray-300 focus:outline-none w-full bg-transparent"
                        placeholder="Paper Title"
                    />
                    <div className="text-xs text-gray-400 flex items-center gap-1 min-w-[100px] justify-end">
                        {saving ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Saving...
                            </>
                        ) : lastSaved ? (
                            <>
                                <Check className="w-3 h-3 text-green-500" />
                                Saved
                            </>
                        ) : (
                            'Ready'
                        )}
                    </div>
                </div>

                {/* Assignment Prompt Toggle */}
                <div className="px-4 pb-2">
                    <button
                        onClick={() => setShowPrompt(!showPrompt)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        {showPrompt ? 'Hide Assignment Prompt' : '+ Add Assignment Prompt'}
                    </button>

                    {showPrompt && (
                        <div className="mt-2 mb-2">
                            <textarea
                                value={assignmentPrompt}
                                onChange={handlePromptChange}
                                placeholder="Paste your assignment prompt or rubric here so the AI can help you stay on track..."
                                className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none resize-none h-20 text-slate-600"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-white" onClick={() => editor.commands.focus()}>
                {/* {editor && (
                    <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="bg-white shadow-xl border border-slate-200 rounded-lg overflow-hidden flex divide-x divide-slate-100 p-1">
                        <button
                            onClick={() => onAskAI?.(editor.state.selection.content().content.textBetween(0, editor.state.selection.content().size, '\n'), assignmentPrompt)}
                            className="px-3 py-1.5 text-sm font-medium text-purple-600 hover:bg-purple-50 flex items-center gap-1.5 transition-colors"
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            Ask AI
                        </button>
                    </BubbleMenu>
                )} */}
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
