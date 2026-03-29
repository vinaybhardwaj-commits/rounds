'use client';

// ============================================
// MessageArea — the right panel showing messages
// for the active channel + composer input.
// Step 2.4: Added reactions, thread replies,
// file attachments, message actions.
// ============================================

import React, { useState, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  Paperclip,
  Menu,
  Hash,
  Users,
  Activity,
  Megaphone,
  MessageCircleReply,
  Image as ImageIcon,
  File as FileIcon,
  Download,
} from 'lucide-react';
import type { Channel, MessageResponse } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';
import type { MessageType, MessagePriority } from '@/types';

// --- Types ---

interface MessageAreaProps {
  channel: Channel | null;
  onOpenSidebar: () => void;
  onOpenThread: (message: MessageResponse) => void;
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
  reply_count: number;
  reaction_counts: Record<string, number>;
  own_reactions: string[];
  attachments: AttachmentData[];
  raw: MessageResponse;
}

interface AttachmentData {
  type: string;
  title?: string;
  file_size?: number;
  mime_type?: string;
  image_url?: string;
  asset_url?: string;
  thumb_url?: string;
}

// --- Constants ---

const CHANNEL_TYPE_ICONS: Record<string, React.ElementType> = {
  department: Hash,
  'cross-functional': Users,
  'patient-thread': Activity,
  direct: MessageSquare,
  'ops-broadcast': Megaphone,
};

const REACTION_EMOJIS = [
  { emoji: '✅', type: 'check' },
  { emoji: '👍', type: 'thumbsup' },
  { emoji: '👀', type: 'eyes' },
  { emoji: '🙏', type: 'pray' },
  { emoji: '❓', type: 'question' },
];

// --- Component ---

export function MessageArea({ channel, onOpenSidebar, onOpenThread }: MessageAreaProps) {
  const { client } = useChatContext();
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeChannelRef = useRef<Channel | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Convert GetStream message to display format
  const toDisplayMessage = useCallback(
    (msg: MessageResponse): DisplayMessage => {
      const reactionCounts: Record<string, number> = {};
      const ownReactions: string[] = [];

      if (msg.reaction_counts) {
        Object.entries(msg.reaction_counts).forEach(([type, count]) => {
          reactionCounts[type] = count as number;
        });
      }

      if (msg.own_reactions && client?.userID) {
        msg.own_reactions.forEach((r) => {
          if (r.type) ownReactions.push(r.type);
        });
      }

      const attachments: AttachmentData[] = (msg.attachments || []).map((a) => ({
        type: a.type || 'file',
        title: a.title || a.fallback || 'Attachment',
        file_size: a.file_size,
        mime_type: a.mime_type,
        image_url: a.image_url || a.thumb_url,
        asset_url: a.asset_url,
        thumb_url: a.thumb_url,
      }));

      return {
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
        reply_count: msg.reply_count || 0,
        reaction_counts: reactionCounts,
        own_reactions: ownReactions,
        attachments,
        raw: msg,
      };
    },
    [client?.userID]
  );

  // Load messages when channel changes
  React.useEffect(() => {
    if (!channel || !client) {
      setMessages([]);
      return;
    }

    if (activeChannelRef.current?.cid === channel.cid && messages.length > 0) {
      return;
    }
    activeChannelRef.current = channel;

    const loadMessages = async () => {
      setLoading(true);
      try {
        await channel.watch();
        const state = channel.state;
        // Only show top-level messages (not thread replies)
        const topLevel = state.messages.filter((m) => !m.parent_id);
        setMessages(topLevel.map(toDisplayMessage));
        setTimeout(scrollToBottom, 100);
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();

    const handleNewMessage = (event: { message?: MessageResponse }) => {
      if (event.message && !event.message.parent_id) {
        setMessages((prev) => [...prev, toDisplayMessage(event.message!)]);
        setTimeout(scrollToBottom, 50);
      }
    };

    const handleReactionNew = () => {
      // Refresh messages to get updated reaction counts
      const topLevel = channel.state.messages.filter((m) => !m.parent_id);
      setMessages(topLevel.map(toDisplayMessage));
    };

    channel.on('message.new', handleNewMessage);
    channel.on('reaction.new', handleReactionNew);
    channel.on('reaction.deleted', handleReactionNew);

    return () => {
      channel.off('message.new', handleNewMessage);
      channel.off('reaction.new', handleReactionNew);
      channel.off('reaction.deleted', handleReactionNew);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.cid, client]);

  // Toggle reaction
  const toggleReaction = async (messageId: string, reactionType: string) => {
    if (!channel) return;
    try {
      const msg = messages.find((m) => m.id === messageId);
      if (msg?.own_reactions.includes(reactionType)) {
        await channel.deleteReaction(messageId, reactionType);
      } else {
        await channel.sendReaction(messageId, { type: reactionType });
      }
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!messageText.trim() || !channel || sending) return;

    setSending(true);
    try {
      await channel.sendMessage({ text: messageText.trim() });
      setMessageText('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !channel) return;

    setUploading(true);
    try {
      // Upload to GetStream CDN
      let response;
      if (file.type.startsWith('image/')) {
        response = await channel.sendImage(file);
      } else {
        response = await channel.sendFile(file);
      }

      // Send message with attachment
      await channel.sendMessage({
        text: '',
        attachments: [
          {
            type: file.type.startsWith('image/') ? 'image' : 'file',
            asset_url: response.file,
            title: file.name,
            file_size: file.size,
            mime_type: file.type,
            ...(file.type.startsWith('image/') ? { image_url: response.file } : {}),
          },
        ],
      });
    } catch (err) {
      console.error('File upload failed:', err);
    } finally {
      setUploading(false);
      // Clear file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 bg-gray-50">
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
              const isHovered = hoveredMessageId === msg.id;
              const showAvatar =
                index === 0 ||
                messages[index - 1].user_id !== msg.user_id ||
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
                <div
                  key={msg.id}
                  className={`group relative ${showAvatar ? 'mt-3' : 'mt-0.5'}`}
                  onMouseEnter={() => setHoveredMessageId(msg.id)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                >
                  {/* Message action toolbar (hover) */}
                  {isHovered && (
                    <div className="absolute -top-3 right-2 flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-sm px-1 py-0.5 z-10">
                      {REACTION_EMOJIS.map((r) => (
                        <button
                          key={r.type}
                          onClick={() => toggleReaction(msg.id, r.type)}
                          className={`text-sm px-1 py-0.5 rounded hover:bg-gray-100 transition-colors ${
                            msg.own_reactions.includes(r.type) ? 'bg-blue-50' : ''
                          }`}
                          title={r.type}
                        >
                          {r.emoji}
                        </button>
                      ))}
                      <div className="w-px h-4 bg-gray-200 mx-0.5" />
                      <button
                        onClick={() => onOpenThread(msg.raw)}
                        className="p-1 rounded hover:bg-gray-100 transition-colors"
                        title="Reply in thread"
                      >
                        <MessageCircleReply size={14} className="text-gray-500" />
                      </button>
                    </div>
                  )}

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

                  <div className="ml-8">
                    {/* Message text */}
                    {msg.text && (
                      <p className="text-sm text-gray-800 leading-relaxed">
                        {msg.text}
                      </p>
                    )}

                    {/* Attachments */}
                    {msg.attachments.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {msg.attachments.map((att, i) => {
                          if (att.type === 'image' && att.image_url) {
                            return (
                              <div key={i} className="max-w-xs">
                                <img
                                  src={att.image_url}
                                  alt={att.title || 'Image'}
                                  className="rounded-lg border border-gray-200 max-h-48 object-cover cursor-pointer"
                                  onClick={() => att.image_url && window.open(att.image_url, '_blank')}
                                />
                              </div>
                            );
                          }
                          return (
                            <a
                              key={i}
                              href={att.asset_url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 max-w-xs hover:bg-gray-200 transition-colors"
                            >
                              {att.mime_type?.startsWith('image/') ? (
                                <ImageIcon size={16} className="text-gray-500 flex-shrink-0" />
                              ) : (
                                <FileIcon size={16} className="text-gray-500 flex-shrink-0" />
                              )}
                              <span className="text-sm text-gray-700 truncate flex-1">
                                {att.title || 'File'}
                              </span>
                              <Download size={14} className="text-gray-400 flex-shrink-0" />
                            </a>
                          );
                        })}
                      </div>
                    )}

                    {/* Reaction pills */}
                    {Object.keys(msg.reaction_counts).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(msg.reaction_counts).map(([type, count]) => {
                          const emojiDef = REACTION_EMOJIS.find((e) => e.type === type);
                          const isOwn = msg.own_reactions.includes(type);
                          return (
                            <button
                              key={type}
                              onClick={() => toggleReaction(msg.id, type)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                                isOwn
                                  ? 'bg-blue-100 border border-blue-200 text-blue-700'
                                  : 'bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              <span>{emojiDef?.emoji || '👍'}</span>
                              <span>{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Thread reply count */}
                    {msg.reply_count > 0 && (
                      <button
                        onClick={() => onOpenThread(msg.raw)}
                        className="flex items-center gap-1 mt-1 text-even-blue text-xs hover:underline"
                      >
                        <MessageCircleReply size={12} />
                        <span>
                          {msg.reply_count} {msg.reply_count === 1 ? 'reply' : 'replies'}
                        </span>
                      </button>
                    )}
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
        {uploading && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-4 h-4 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin" />
            <span className="text-xs text-gray-500">Uploading file...</span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 disabled:opacity-50"
          >
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
            className={`p-2 rounded-lg flex-shrink-0 transition-colors ${
              messageText.trim()
                ? 'bg-even-blue text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-300'
            }`}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
