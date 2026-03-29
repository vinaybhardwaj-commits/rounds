'use client';

// ============================================
// MessageArea — the right panel showing messages
// for the active channel + composer input.
// Uses GetStream React SDK components with
// custom rendering overrides.
// ============================================

import React, { useState, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  Paperclip,
  ChevronDown,
  Menu,
  Hash,
  Users,
  Activity,
  Megaphone,
} from 'lucide-react';
import type { Channel, MessageResponse } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';
import type { MessageType, MessagePriority } from '@/types';

// --- Types ---

interface MessageAreaProps {
  channel: Channel | null;
  onOpenSidebar: () => void;
}

interface DisplayMessage {
  id: string;
  text: string;
  user_name: string;
  user_id: string;
  created_at: string;
  message_type: MessageType;
  priority: MessagePriority;
  is_system: boolean;
}

// --- Channel icon helper ---
const CHANNEL_TYPE_ICONS: Record<string, React.ElementType> = {
  department: Hash,
  'cross-functional': Users,
  'patient-thread': Activity,
  direct: MessageSquare,
  'ops-broadcast': Megaphone,
};

// --- Component ---

export function MessageArea({ channel, onOpenSidebar }: MessageAreaProps) {
  const { client } = useChatContext();
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeChannelRef = useRef<Channel | null>(null);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Convert GetStream message to our display format
  const toDisplayMessage = (msg: MessageResponse): DisplayMessage => ({
    id: msg.id,
    text: msg.text || '',
    user_name: msg.user?.name || msg.user?.id || 'Unknown',
    user_id: msg.user?.id || '',
    created_at: msg.created_at || new Date().toISOString(),
    message_type: ((msg as Record<string, unknown>).message_type as MessageType) || 'chat',
    priority: ((msg as Record<string, unknown>).priority as MessagePriority) || 'normal',
    is_system: msg.user?.id === 'rounds-system',
  });

  // Load messages when channel changes
  React.useEffect(() => {
    if (!channel || !client) {
      setMessages([]);
      return;
    }

    // Prevent double-loading same channel
    if (activeChannelRef.current?.cid === channel.cid && messages.length > 0) {
      return;
    }
    activeChannelRef.current = channel;

    const loadMessages = async () => {
      setLoading(true);
      try {
        await channel.watch();
        const state = channel.state;
        const msgs = state.messages.map(toDisplayMessage);
        setMessages(msgs);
        setTimeout(scrollToBottom, 100);
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();

    // Listen for new messages
    const handleNewMessage = (event: { message?: MessageResponse }) => {
      if (event.message) {
        setMessages((prev) => [...prev, toDisplayMessage(event.message!)]);
        setTimeout(scrollToBottom, 50);
      }
    };

    channel.on('message.new', handleNewMessage);

    return () => {
      channel.off('message.new', handleNewMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.cid, client]);

  // Send message
  const sendMessage = async () => {
    if (!messageText.trim() || !channel || sending) return;

    setSending(true);
    try {
      await channel.sendMessage({
        text: messageText.trim(),
      });
      setMessageText('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  // Handle enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // No channel selected
  if (!channel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-center p-6">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden mb-4 p-2 bg-even-navy text-white rounded-lg"
        >
          <Menu size={20} />
        </button>
        <div className="w-16 h-16 bg-even-blue/10 rounded-2xl flex items-center justify-center mb-4">
          <MessageSquare size={32} className="text-even-blue" />
        </div>
        <h2 className="text-lg font-semibold text-even-navy mb-1">
          Welcome to Rounds
        </h2>
        <p className="text-sm text-gray-500 max-w-sm">
          Select a channel from the sidebar to start messaging your team.
        </p>
      </div>
    );
  }

  const channelName = (channel.data?.name as string) || channel.id || 'Channel';
  const channelDesc = (channel.data?.description as string) || '';
  const ChannelIcon = CHANNEL_TYPE_ICONS[channel.type] || Hash;
  const memberCount = Object.keys(channel.state?.members || {}).length;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Channel header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden p-1 rounded-md hover:bg-gray-100"
        >
          <Menu size={18} className="text-gray-600" />
        </button>
        <ChannelIcon size={18} className="text-even-blue flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-even-navy truncate">
            {channelName}
          </h2>
          {channelDesc && (
            <p className="text-[11px] text-gray-400 truncate">{channelDesc}</p>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Users size={13} />
          <span>{memberCount}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-12">
            No messages yet. Start the conversation!
          </div>
        ) : (
          <>
            {messages.map((msg, index) => {
              const isOwn = msg.user_id === client?.userID;
              const isSystem = msg.is_system;
              const showAvatar =
                index === 0 ||
                messages[index - 1].user_id !== msg.user_id ||
                // Show avatar if >5 min gap
                new Date(msg.created_at).getTime() -
                  new Date(messages[index - 1].created_at).getTime() >
                  300000;

              const time = new Date(msg.created_at).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              });

              // System message
              if (isSystem) {
                return (
                  <div
                    key={msg.id}
                    className="flex items-start gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100"
                  >
                    <div className="w-6 h-6 bg-even-blue rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-white">R</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-even-blue">
                          Rounds System
                        </span>
                        {msg.message_type !== 'chat' && (
                          <MessageTypeBadge type={msg.message_type} />
                        )}
                        <span className="text-[10px] text-gray-400">{time}</span>
                      </div>
                      <p className="text-sm text-gray-700 mt-0.5">{msg.text}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className={`${showAvatar ? 'mt-3' : 'mt-0.5'}`}>
                  {showAvatar && (
                    <div className="flex items-center gap-2 mb-0.5">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${
                          isOwn ? 'bg-even-blue' : 'bg-gray-400'
                        }`}
                      >
                        {msg.user_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-semibold text-gray-700">
                        {isOwn ? 'You' : msg.user_name}
                      </span>
                      {msg.message_type !== 'chat' && (
                        <MessageTypeBadge type={msg.message_type} />
                      )}
                      <span className="text-[10px] text-gray-400">{time}</span>
                    </div>
                  )}
                  <div className={`${showAvatar ? 'ml-8' : 'ml-8'}`}>
                    <p className="text-sm text-gray-800 leading-relaxed">
                      {msg.text}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <div className="px-3 py-2 bg-white border-t border-gray-200">
        <div className="flex items-end gap-2">
          <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
            <Paperclip size={18} />
          </button>
          <textarea
            ref={inputRef}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channelName.toLowerCase()}`}
            rows={1}
            className="flex-1 resize-none bg-gray-100 rounded-lg px-3 py-2 text-sm outline-none focus:bg-gray-50 focus:ring-1 focus:ring-even-blue/30 transition-colors max-h-32"
            style={{ minHeight: '36px' }}
          />
          <button
            onClick={sendMessage}
            disabled={!messageText.trim() || sending}
            className={`
              p-2 rounded-lg flex-shrink-0 transition-colors
              ${
                messageText.trim()
                  ? 'bg-even-blue text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-300'
              }
            `}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
