'use client';

// ============================================
// MessageArea — the right panel showing messages
// for the active channel + composer input.
// Step 2.4: Added reactions, thread replies,
// file attachments, message actions.
// ============================================

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
  ClipboardList,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { Channel, MessageResponse } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';
import { DeleteMessageModal } from './DeleteMessageModal';
import FormCard from '@/components/forms/FormCard';
import type { MessageType, MessagePriority, FormType, PatientStage } from '@/types';
import { FORM_TYPE_LABELS, FORMS_BY_STAGE } from '@/lib/form-registry';

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
  user_role: string;       // rounds_role from GetStream user custom data
  user_department: string;  // department_id from GetStream user
  created_at: string;
  message_type: MessageType;
  priority: MessagePriority;
  is_system: boolean;
  reply_count: number;
  reaction_counts: Record<string, number>;
  own_reactions: string[];
  attachments: AttachmentData[];
  raw: MessageResponse;
  // Soft-delete fields
  rounds_deleted: boolean;
  rounds_deleted_by_name?: string;
  rounds_deleted_at?: string;
  rounds_deleted_reason?: string;
  rounds_original_text?: string;
}

// Role display labels and colors
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Admin',
  department_head: 'Dept Head',
  doctor: 'Doctor',
  surgeon: 'Surgeon',
  nurse: 'Nurse',
  anesthesiologist: 'Anesthetist',
  ot_coordinator: 'OT Coord',
  ip_coordinator: 'IP Coord',
  billing_executive: 'Billing',
  insurance_coordinator: 'Insurance',
  pharmacist: 'Pharmacist',
  physiotherapist: 'Physio',
  marketing_executive: 'Marketing',
  support_staff: 'Support',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  department_head: 'bg-indigo-100 text-indigo-700',
  doctor: 'bg-blue-100 text-blue-700',
  surgeon: 'bg-red-100 text-red-700',
  nurse: 'bg-green-100 text-green-700',
  anesthesiologist: 'bg-amber-100 text-amber-700',
  ot_coordinator: 'bg-orange-100 text-orange-700',
  ip_coordinator: 'bg-teal-100 text-teal-700',
  billing_executive: 'bg-cyan-100 text-cyan-700',
  insurance_coordinator: 'bg-sky-100 text-sky-700',
  pharmacist: 'bg-lime-100 text-lime-700',
  physiotherapist: 'bg-emerald-100 text-emerald-700',
  marketing_executive: 'bg-pink-100 text-pink-700',
  support_staff: 'bg-gray-100 text-gray-600',
};

// Cross-functional channel → which roles are "primary" (get highlighted)
const CF_RELEVANT_ROLES: Record<string, string[]> = {
  'admission-coordination': ['ip_coordinator', 'billing_executive', 'insurance_coordinator', 'nurse'],
  'discharge-coordination': ['ip_coordinator', 'billing_executive', 'nurse', 'pharmacist', 'doctor'],
  'surgery-coordination': ['surgeon', 'anesthesiologist', 'ot_coordinator', 'nurse'],
  'emergency-escalation': ['doctor', 'surgeon', 'nurse', 'department_head', 'super_admin'],
  'ops-daily-huddle': ['department_head', 'super_admin', 'ip_coordinator'],
};

interface AttachmentData {
  type: string;
  title?: string;
  file_size?: number;
  mime_type?: string;
  image_url?: string;
  asset_url?: string;
  thumb_url?: string;
  // Form submission card fields
  form_id?: string;
  form_type?: string;
  form_status?: string;
  submitted_by_name?: string;
  completion_score?: number | null;
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
  const router = useRouter();
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DisplayMessage | null>(null);
  const [showDeletedAccordion, setShowDeletedAccordion] = useState(false);
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

      const attachments: AttachmentData[] = (msg.attachments || []).map((a) => {
        const extra = a as Record<string, unknown>;
        return {
          type: a.type || 'file',
          title: a.title || a.fallback || 'Attachment',
          file_size: a.file_size,
          mime_type: a.mime_type,
          image_url: a.image_url || a.thumb_url,
          asset_url: a.asset_url,
          thumb_url: a.thumb_url,
          // Form submission card fields (custom attachment)
          form_id: extra.form_id as string | undefined,
          form_type: extra.form_type as string | undefined,
          form_status: (extra.status as string) || undefined,
          submitted_by_name: extra.submitted_by_name as string | undefined,
          completion_score: extra.completion_score != null ? Number(extra.completion_score) : null,
        };
      });

      // Extract custom fields from GetStream user object
      const gsUser = msg.user as Record<string, unknown> | undefined;
      const msgExtra = msg as Record<string, unknown>;

      return {
        id: msg.id,
        text: msg.text || '',
        user_name: msg.user?.name || msg.user?.id || 'Unknown',
        user_id: msg.user?.id || '',
        user_role: (gsUser?.rounds_role as string) || '',
        user_department: (gsUser?.department_id as string) || '',
        created_at: msg.created_at || new Date().toISOString(),
        message_type:
          (msgExtra.message_type as MessageType) || 'chat',
        priority:
          (msgExtra.priority as MessagePriority) || 'normal',
        is_system: msg.user?.id === 'rounds-system',
        reply_count: msg.reply_count || 0,
        reaction_counts: reactionCounts,
        own_reactions: ownReactions,
        attachments,
        raw: msg,
        // Soft-delete fields
        rounds_deleted: Boolean(msgExtra.rounds_deleted),
        rounds_deleted_by_name: (msgExtra.rounds_deleted_by_name as string) || undefined,
        rounds_deleted_at: (msgExtra.rounds_deleted_at as string) || undefined,
        rounds_deleted_reason: (msgExtra.rounds_deleted_reason as string) || undefined,
        rounds_original_text: (msgExtra.rounds_original_text as string) || undefined,
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

    const handleMessageUpdated = () => {
      // Re-map all messages — a soft-delete will now show rounds_deleted = true
      const topLevel = channel.state.messages.filter((m) => !m.parent_id);
      setMessages(topLevel.map(toDisplayMessage));
    };

    channel.on('message.new', handleNewMessage);
    channel.on('message.updated', handleMessageUpdated);
    channel.on('reaction.new', handleReactionNew);
    channel.on('reaction.deleted', handleReactionNew);

    return () => {
      channel.off('message.new', handleNewMessage);
      channel.off('message.updated', handleMessageUpdated);
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
        <button
          onClick={() => {
            // Build URL with channel context for form-in-chat integration
            const params = new URLSearchParams();
            if (channel.type) params.set('channel_type', channel.type);
            if (channel.id) params.set('channel_id', channel.id);
            // Extract patient_thread_id from channel custom data if available
            const ptId = (channel.data as Record<string, unknown>)?.patient_thread_id;
            if (ptId && typeof ptId === 'string') params.set('patient_id', ptId);
            const qs = params.toString();
            router.push(`/forms${qs ? `?${qs}` : ''}`);
          }}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-even-blue transition-colors"
          title="New Form"
        >
          <ClipboardList size={16} />
        </button>
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
            {messages.filter(m => !m.rounds_deleted).map((msg, index, filteredMsgs) => {
              const isOwn = msg.user_id === client?.userID;
              const isSystem = msg.is_system;
              const isHovered = hoveredMessageId === msg.id;
              const showAvatar =
                index === 0 ||
                filteredMsgs[index - 1].user_id !== msg.user_id ||
                new Date(msg.created_at).getTime() -
                  new Date(filteredMsgs[index - 1].created_at).getTime() >
                  300000;

              const time = new Date(msg.created_at).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              });

              // System message — enhanced with action buttons
              if (isSystem) {
                const isStageTransition = msg.text.includes('Stage transition');
                const isEscalation = msg.text.includes('Escalation') || msg.text.includes('escalation');
                const isFormMention = msg.text.includes('form') || msg.text.includes('Form');
                const isShiftHandoff = msg.text.includes('shift') || msg.text.includes('handoff');

                // Extract patient_thread_id from channel for action links
                const ptId = (channel.data as Record<string, unknown>)?.patient_thread_id as string | undefined;

                return (
                  <div
                    key={msg.id}
                    className={`group/sys relative px-3 py-2.5 rounded-lg border ${
                      isEscalation
                        ? 'bg-red-50 border-red-100'
                        : isStageTransition
                        ? 'bg-purple-50 border-purple-100'
                        : 'bg-blue-50 border-blue-100'
                    }`}
                  >
                    {/* Delete button for system messages — visible on hover */}
                    <button
                      onClick={() => setDeleteTarget(msg)}
                      className="absolute top-2 right-2 p-1 rounded-md opacity-0 group-hover/sys:opacity-100 hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all"
                      title="Delete this message"
                    >
                      <Trash2 size={13} />
                    </button>
                    <div className="flex items-start gap-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          isEscalation
                            ? 'bg-red-500'
                            : isStageTransition
                            ? 'bg-purple-500'
                            : 'bg-even-blue'
                        }`}
                      >
                        <span className="text-[10px] font-bold text-white">R</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-semibold ${
                              isEscalation
                                ? 'text-red-600'
                                : isStageTransition
                                ? 'text-purple-600'
                                : 'text-even-blue'
                            }`}
                          >
                            Rounds System
                          </span>
                          {msg.message_type !== 'chat' && (
                            <MessageTypeBadge type={msg.message_type} />
                          )}
                          <span className="text-[10px] text-gray-400">{time}</span>
                        </div>
                        <p className="text-sm text-gray-700 mt-0.5">{msg.text}</p>

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {isStageTransition && ptId && (
                            <button
                              onClick={() => {
                                // Navigate to forms page with patient context
                                const params = new URLSearchParams();
                                if (channel.type) params.set('channel_type', channel.type);
                                if (channel.id) params.set('channel_id', channel.id);
                                params.set('patient_id', ptId);
                                router.push(`/forms?${params.toString()}`);
                              }}
                              className="text-[11px] px-2.5 py-1 bg-white rounded-full border border-purple-200 text-purple-600 font-medium hover:bg-purple-50 transition-colors"
                            >
                              Fill Stage Form
                            </button>
                          )}
                          {isEscalation && (
                            <button
                              onClick={() => {
                                // Navigate to escalation log
                                router.push('/admin/escalations');
                              }}
                              className="text-[11px] px-2.5 py-1 bg-white rounded-full border border-red-200 text-red-600 font-medium hover:bg-red-50 transition-colors"
                            >
                              View Escalations
                            </button>
                          )}
                          {(isFormMention || isStageTransition) && ptId && (
                            <button
                              onClick={() => {
                                router.push(`/forms?patient_id=${ptId}`);
                              }}
                              className="text-[11px] px-2.5 py-1 bg-white rounded-full border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
                            >
                              View Forms
                            </button>
                          )}
                          {isShiftHandoff && (
                            <button
                              onClick={() => {
                                router.push('/admin/duty-roster');
                              }}
                              className="text-[11px] px-2.5 py-1 bg-white rounded-full border border-blue-200 text-blue-600 font-medium hover:bg-blue-50 transition-colors"
                            >
                              Duty Roster
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Determine if this message's role is "relevant" in a cross-functional channel
              const isCrossFunc = channel.type === 'cross-functional';
              const relevantRoles = isCrossFunc ? (CF_RELEVANT_ROLES[channel.id || ''] || []) : [];
              const isRelevantRole = isCrossFunc && msg.user_role && relevantRoles.includes(msg.user_role);
              const roleLabel = ROLE_LABELS[msg.user_role] || (msg.user_role ? msg.user_role.replace(/_/g, ' ') : '');
              const roleColor = ROLE_COLORS[msg.user_role] || 'bg-gray-100 text-gray-600';

              return (
                <div
                  key={msg.id}
                  className={`group relative ${showAvatar ? 'mt-3' : 'mt-0.5'} ${
                    isRelevantRole ? 'pl-2 border-l-[3px] border-l-even-blue bg-blue-50/30 rounded-r-md -ml-1' : ''
                  }`}
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
                      {/* Delete button — only for own messages */}
                      {isOwn && (
                        <>
                          <div className="w-px h-4 bg-gray-200 mx-0.5" />
                          <button
                            onClick={() => setDeleteTarget(msg)}
                            className="p-1 rounded hover:bg-red-50 transition-colors"
                            title="Delete message"
                          >
                            <Trash2 size={14} className="text-gray-400 hover:text-red-500" />
                          </button>
                        </>
                      )}
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
                      {/* Role badge */}
                      {roleLabel && !msg.is_system && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${roleColor}`}>
                          {roleLabel}
                        </span>
                      )}
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
                          // Form submission card
                          if (att.type === 'form_submission' && att.form_id) {
                            return (
                              <FormCard
                                key={i}
                                formId={att.form_id}
                                formType={att.form_type as FormType}
                                status={att.form_status || 'submitted'}
                                submittedByName={att.submitted_by_name || 'Unknown'}
                                createdAt={msg.created_at}
                                completionScore={att.completion_score ?? null}
                                compact
                              />
                            );
                          }
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
            {/* Deleted Messages Accordion */}
            {(() => {
              const deletedMsgs = messages.filter(m => m.rounds_deleted);
              if (deletedMsgs.length === 0) return null;
              return (
                <div className="mt-4 border-t border-dashed border-gray-200 pt-3">
                  <button
                    onClick={() => setShowDeletedAccordion(!showDeletedAccordion)}
                    className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-2"
                  >
                    {showDeletedAccordion ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Trash2 size={12} />
                    <span>
                      Deleted Messages ({deletedMsgs.length})
                    </span>
                  </button>
                  {showDeletedAccordion && (
                    <div className="space-y-1.5 pl-1">
                      {deletedMsgs.map(dm => {
                        const delTime = dm.rounds_deleted_at
                          ? new Date(dm.rounds_deleted_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                          : '';
                        const delDate = dm.rounds_deleted_at
                          ? new Date(dm.rounds_deleted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                          : '';
                        const reasonLabels: Record<string, string> = {
                          mistake: 'Sent by mistake',
                          change_of_plans: 'Change of plans',
                          duplicate: 'Duplicate',
                          testing_debug: 'Testing/debug',
                          other: 'Other',
                        };
                        return (
                          <div key={dm.id} className="bg-gray-100/60 border border-gray-200 rounded-lg px-3 py-2 opacity-60">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] font-medium text-gray-500">
                                {dm.is_system ? '🤖 Rounds System' : dm.user_name}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {new Date(dm.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 line-through leading-relaxed">
                              {dm.rounds_original_text || dm.text}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-400">
                              <Trash2 size={10} />
                              <span>
                                Deleted by {dm.rounds_deleted_by_name || 'Unknown'}
                                {delDate ? ` on ${delDate}` : ''}
                                {delTime ? ` at ${delTime}` : ''}
                              </span>
                              {dm.rounds_deleted_reason && (
                                <>
                                  <span className="text-gray-300">|</span>
                                  <span>{reasonLabels[dm.rounds_deleted_reason] || dm.rounds_deleted_reason}</span>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Delete Message Modal */}
      {deleteTarget && channel && (
        <DeleteMessageModal
          messageId={deleteTarget.id}
          channelType={channel.type}
          channelId={channel.id || ''}
          messageText={deleteTarget.text}
          messageAuthor={deleteTarget.user_name}
          isSystemMessage={deleteTarget.is_system}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            // Refresh messages from channel state
            const topLevel = channel.state.messages.filter((m) => !m.parent_id);
            setMessages(topLevel.map(toDisplayMessage));
          }}
        />
      )}

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
          <div className="flex-1 relative">
            {/* Slash command menu */}
            {showSlashMenu && channel && (
              <SlashCommandMenu
                channel={channel}
                onSelect={(formType, patientId) => {
                  setShowSlashMenu(false);
                  setMessageText('');
                  const params = new URLSearchParams();
                  params.set('type', formType);
                  if (patientId) params.set('patient', patientId);
                  if (channel.type) params.set('channel_type', channel.type);
                  if (channel.id) params.set('channel_id', channel.id);
                  router.push(`/forms/new?${params.toString()}`);
                }}
                onClose={() => {
                  setShowSlashMenu(false);
                  setMessageText('');
                }}
              />
            )}
            <textarea
              ref={inputRef}
              value={messageText}
              onChange={(e) => {
                const val = e.target.value;
                setMessageText(val);
                // Show slash menu when user types "/"
                if (val === '/') {
                  setShowSlashMenu(true);
                } else if (!val.startsWith('/')) {
                  setShowSlashMenu(false);
                }
              }}
              onKeyDown={(e) => {
                if (showSlashMenu && e.key === 'Escape') {
                  setShowSlashMenu(false);
                  setMessageText('');
                  e.preventDefault();
                  return;
                }
                handleKeyDown(e);
              }}
              placeholder={`Message #${channelName.toLowerCase()} — type / for forms`}
              rows={1}
              className="w-full resize-none bg-gray-100 rounded-lg px-3 py-2 text-sm outline-none focus:bg-gray-50 focus:ring-1 focus:ring-even-blue/30 transition-colors max-h-32"
              style={{ minHeight: '36px' }}
            />
          </div>
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

// ── Slash Command Menu ──
function SlashCommandMenu({
  channel,
  onSelect,
  onClose,
}: {
  channel: Channel;
  onSelect: (formType: FormType, patientId?: string) => void;
  onClose: () => void;
}) {
  const channelData = channel.data as Record<string, unknown> | undefined;
  const currentStage = (channelData?.current_stage as PatientStage) || null;
  const patientId = (channelData?.patient_thread_id as string) || undefined;
  const isPatientThread = channel.type === 'patient-thread';

  // Build form list: stage-specific + any-stage
  const forms: FormType[] = [];
  if (isPatientThread && currentStage) {
    const stageForms = FORMS_BY_STAGE[currentStage] || [];
    const anyForms = FORMS_BY_STAGE['any'] || [];
    forms.push(...stageForms, ...anyForms);
  } else {
    // Not a patient thread — show the general forms
    const anyForms = FORMS_BY_STAGE['any'] || [];
    forms.push(...anyForms);
  }

  // Also show all forms if this is a patient channel (user might need any form)
  const allForms = Object.keys(FORM_TYPE_LABELS) as FormType[];
  const extraForms = allForms.filter((f) => !forms.includes(f));

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto z-20">
      <div className="px-3 py-2 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500">
          {isPatientThread && currentStage
            ? `Forms for ${currentStage.replace('_', ' ').toUpperCase()} stage`
            : 'Available Forms'}
        </p>
      </div>
      {forms.length > 0 && (
        <div className="py-1">
          {forms.map((formType) => (
            <button
              key={formType}
              onClick={() => onSelect(formType, patientId)}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left transition-colors"
            >
              <ClipboardList size={14} className="text-even-blue shrink-0" />
              <span className="text-sm text-even-navy">
                {FORM_TYPE_LABELS[formType]}
              </span>
              <span className="ml-auto text-[10px] text-purple-500 font-medium">
                Stage
              </span>
            </button>
          ))}
        </div>
      )}
      {isPatientThread && extraForms.length > 0 && (
        <>
          <div className="px-3 py-1.5 border-t border-gray-100">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
              Other Forms
            </p>
          </div>
          <div className="py-1">
            {extraForms.map((formType) => (
              <button
                key={formType}
                onClick={() => onSelect(formType, patientId)}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left transition-colors"
              >
                <ClipboardList size={14} className="text-gray-400 shrink-0" />
                <span className="text-sm text-gray-600">
                  {FORM_TYPE_LABELS[formType]}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="px-3 py-2 border-t border-gray-100">
        <button
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Press Esc to close
        </button>
      </div>
    </div>
  );
}
