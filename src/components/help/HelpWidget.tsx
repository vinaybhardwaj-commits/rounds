'use client';

// ============================================
// HelpWidget — Floating ? button + chat panel
// Always visible, bottom-right above tab bar.
// Opens a bottom sheet (mobile) or side panel.
// ============================================

import { useState, useRef, useEffect } from 'react';
import {
  HelpCircle,
  X,
  Send,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Terminal,
  Brain,
  FileText,
} from 'lucide-react';
import { trackFeature } from '@/lib/session-tracker';

interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'ai' | 'template' | 'no-match';
  interactionId?: number;
  feedbackGiven?: boolean;
}

interface HelpWidgetProps {
  currentPage?: string;
}

export default function HelpWidget({ currentPage }: HelpWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasNewDot, setHasNewDot] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setHasNewDot(false);
    }
  }, [isOpen]);

  // Show welcome message on first open
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: "Hi! I'm the EHRC assistant. Ask me anything about Rounds — how to use features, what things mean, or what to do when something isn't working. I know your role and what page you're on.",
        source: 'template',
      }]);
    }
  }, [isOpen, messages.length]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    trackFeature('help_ask', { page: currentPage });
    setInput('');
    setLoading(true);

    // Add user message
    const userMsg: HelpMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/help/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, page: currentPage }),
      });

      if (!res.ok) {
        throw new Error('Request failed');
      }

      const data = await res.json();

      const aiMsg: HelpMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        source: data.source,
        interactionId: data.interactionId ?? undefined,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: "Sorry, I couldn't process that right now. Please try again, or ask your department head for help.",
        source: 'no-match',
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleFeedback(msgId: string, helpful: boolean) {
    // Find the message to get the interactionId
    const msg = messages.find(m => m.id === msgId);
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, feedbackGiven: true } : m
    ));

    // Send feedback to backend
    if (msg?.interactionId) {
      try {
        await fetch('/api/help/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interactionId: msg.interactionId, helpful }),
        });
      } catch {
        // Silently fail — feedback is non-critical
      }
    }
  }

  return (
    <>
      {/* ── Floating Button ── */}
      <button
        onClick={() => { if (!isOpen) trackFeature('help_open'); setIsOpen(!isOpen); }}
        className={`fixed z-[55] rounded-full shadow-lg transition-all duration-200 ${
          isOpen
            ? 'bottom-20 right-4 w-10 h-10 bg-gray-600 hover:bg-gray-700'
            : 'bottom-20 right-4 w-12 h-12 bg-teal-600 hover:bg-teal-700 hover:scale-105'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label={isOpen ? 'Close help' : 'Get help'}
      >
        {isOpen ? (
          <X className="w-5 h-5 text-white mx-auto" />
        ) : (
          <div className="relative">
            <HelpCircle className="w-6 h-6 text-white mx-auto" />
            {hasNewDot && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full" />
            )}
          </div>
        )}
      </button>

      {/* ── Chat Panel (bottom sheet on mobile, side panel concept) ── */}
      {isOpen && (
        <div
          className="fixed z-[54] bottom-32 right-4 w-[340px] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
          style={{
            maxHeight: 'calc(100dvh - 180px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-4 py-3 flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-white" />
            <span className="text-white font-semibold text-sm">Ask EHRC</span>
            <span className="ml-auto text-teal-200 text-[10px] uppercase font-medium">
              Help Assistant
            </span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-[200px]">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-50 border border-gray-200 text-gray-800'
                }`}>
                  {/* Source badge for assistant messages */}
                  {msg.role === 'assistant' && msg.source && msg.source !== 'no-match' && (
                    <div className="flex items-center gap-1 mb-1">
                      {msg.source === 'ai' ? (
                        <Brain className="w-3 h-3 text-teal-500" />
                      ) : (
                        <FileText className="w-3 h-3 text-gray-400" />
                      )}
                      <span className={`text-[9px] font-medium uppercase ${
                        msg.source === 'ai' ? 'text-teal-500' : 'text-gray-400'
                      }`}>
                        {msg.source === 'ai' ? 'AI-powered' : 'From docs'}
                      </span>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  {/* Feedback buttons */}
                  {msg.role === 'assistant' && msg.id !== 'welcome' && !msg.feedbackGiven && (
                    <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-gray-100">
                      <span className="text-[10px] text-gray-400">Helpful?</span>
                      <button
                        onClick={() => handleFeedback(msg.id, true)}
                        className="p-1 hover:bg-green-50 rounded transition-colors"
                      >
                        <ThumbsUp className="w-3 h-3 text-gray-300 hover:text-green-500" />
                      </button>
                      <button
                        onClick={() => handleFeedback(msg.id, false)}
                        className="p-1 hover:bg-red-50 rounded transition-colors"
                      >
                        <ThumbsDown className="w-3 h-3 text-gray-300 hover:text-red-500" />
                      </button>
                    </div>
                  )}
                  {msg.feedbackGiven && (
                    <div className="text-[10px] text-gray-300 mt-1">Thanks for the feedback!</div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-teal-500 animate-spin" />
                  <span className="text-xs text-gray-400">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 px-3 py-2 bg-gray-50">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your question..."
                rows={1}
                className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Press Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      )}
    </>
  );
}
