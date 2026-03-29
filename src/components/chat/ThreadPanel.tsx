'use client';

// ============================================
// ThreadPanel — slide-in panel for thread
// replies on a specific message. Shows parent
// message + all replies, with a composer.
// ============================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Send, ArrowLeft } from 'lucide-react';
import type { Channel, MessageResponse } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';
import type { MessageType, MessagePriority } from '@/types';

interface ThreadPanelProps {
  channel: Channel;
  parentMessage: MessageResponse;
  onClose: () => void;
}

interface ThreadMessage {
  id: string;
  text: string;
  user_name: string;
  user_id: string;
  created_at: string;
  message_type: MessageType;
  priority: MessagePriority;
  is_system: boolean;
}

export function ThreadPanel({
  channel,
  parentMessage,
  onClose,
}: ThreadPanelProps) {
  const { client } = useChatContext();
  const [replies, setReplies] = useState<ThreadMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const repliesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const toThreadMessage = (msg: MessageResponse): ThreadMessage => ({
    id: msg.id,
    text: msg.text || '',
    user_name: msg.user?.name || msg.user?.id || 'Unknown',
    user_id: msg.user?.id || '',
    created_at: msg.created_at || new Date().toISOString(),
    message_type:
      ((msg as Record<string, unknown>).message_type as MessageType) || 'chat',
    priority:
      ((msg as Record<string, unknown>).priority as MessagePriority) || 'normal',
    is_system: msg.user?.id === 'rounds-system',
  });

  const scrollToBottom = useCallback(() => {
    repliesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load thread replies
  useEffect(() => {
    if (!channel || !parentMessage) return;

    const loadReplies = async () => {
      setLoading(true);
      try {
        const response = await channel.getReplies(parentMessage.id, {
          limit: 100,
        });
        setReplies(response.messages.map(toThreadMessage));
        setTimeout(scrollToBottom, 100);
      } catch (err) {
        console.error('Failed to load thread replies:', err);
      } finally {
        setLoading(false);
      }
    };

    loadReplies();

    // Listen for new replies in this thread
    const handleNewMessage = (event: { message?: MessageResponse }) => {
      if (event.message?.parent_id === parentMessage.id) {
        setReplies((prev) => [...prev, toThreadMessage(event.message!)]);
        setTimeout(scrollToBottom, 50);
      }
    };

    channel.on('message.new', handleNewMessage);
    return () => {
      channel.off('message.new', handleNewMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, parentMessage?.id]);

  const sendReply = async () => {
    if (!replyText.trim() || sending) return;

    setSending(true);
    try {
      await channel.sendMessage({
        text: replyText.trim(),
        parent_id: parentMessage.id,
      });
      setReplyText('');
      inputRef.current?.focus();
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

  const parentType =
    ((parentMessage as Record<string, unknown>).message_type as MessageType) ||
    'chat';
  const parentUserName =
    parentMessage.user?.name || parentMessage.user?.id || 'Unknown';
  const isParentOwn = parentMessage.user?.id === client?.userID;

  return (
    <div className="w-80 lg:w-96 border-l border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200">
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={16} className="text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-even-navy flex-1">
          Thread
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-gray-100 transition-colors"
        >
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      {/* Parent message */}
      <div className="px-3 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2 mb-1">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${
              parentMessage.user?.id === 'rounds-system'
                ? 'bg-even-blue'
                : isParentOwn
                ? 'bg-even-blue'
                : 'bg-gray-400'
            }`}
          >
            {parentMessage.user?.id === 'rounds-system'
              ? 'R'
              : parentUserName.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs font-semibold text-gray-700">
            {parentMessage.user?.id === 'rounds-system'
              ? 'Rounds System'
              : isParentOwn
              ? 'You'
              : parentUserName}
          </span>
          {parentType !== 'chat' && <MessageTypeBadge type={parentType} />}
          <span className="text-[10px] text-gray-400">
            {formatTime(parentMessage.created_at || '')}
          </span>
        </div>
        <p className="text-sm text-gray-700 ml-8">
          {parentMessage.text || ''}
        </p>
        <div className="ml-8 mt-1 text-[10px] text-gray-400">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </div>
      </div>

      {/* Replies */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin" />
          </div>
        ) : replies.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-6">
            No replies yet
          </div>
        ) : (
          replies.map((reply) => {
            const isOwn = reply.user_id === client?.userID;
            return (
              <div key={reply.id}>
                <div className="flex items-center gap-2 mb-0.5">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 ${
                      reply.is_system
                        ? 'bg-even-blue'
                        : isOwn
                        ? 'bg-even-blue'
                        : 'bg-gray-400'
                    }`}
                  >
                    {reply.is_system
                      ? 'R'
                      : reply.user_name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold text-gray-600">
                    {reply.is_system
                      ? 'Rounds System'
                      : isOwn
                      ? 'You'
                      : reply.user_name}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {formatTime(reply.created_at)}
                  </span>
                </div>
                <p className="text-sm text-gray-700 ml-7 leading-relaxed">
                  {reply.text}
                </p>
              </div>
            );
          })
        )}
        <div ref={repliesEndRef} />
      </div>

      {/* Reply composer */}
      <div className="px-3 py-2 border-t border-gray-200">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Reply..."
            rows={1}
            className="flex-1 resize-none bg-gray-100 rounded-lg px-3 py-2 text-sm outline-none focus:bg-gray-50 focus:ring-1 focus:ring-even-blue/30 transition-colors max-h-24"
            style={{ minHeight: '36px' }}
          />
          <button
            onClick={sendReply}
            disabled={!replyText.trim() || sending}
            className={`p-2 rounded-lg flex-shrink-0 transition-colors ${
              replyText.trim()
                ? 'bg-even-blue text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-300'
            }`}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
