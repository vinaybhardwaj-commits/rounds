'use client';

// ============================================
// MessageArea — the right panel showing messages
// for the active channel + composer input.
// Step 2.4: Added reactions, thread replies,
// file attachments, message actions.
// ============================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  AtSign,
  Upload,
  Loader2,
  Plus,
} from 'lucide-react';
import type { Channel, MessageResponse } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';
import { ReadReceipt, computeReadStatus } from './ReadReceipt';
import { DeleteMessageModal } from './DeleteMessageModal';
import FormCard from '@/components/forms/FormCard';
import WhatsAppAnalysisCard from '@/components/wa-analysis/WhatsAppAnalysisCard';
// CT.5 — chat-task card renderer.
import ChatTaskCard from '@/components/chat/attachments/ChatTaskCard';
// CT.6 — chat-task creation modal.
import CreateTaskModal from '@/components/chat/CreateTaskModal';
import type { MessageType, MessagePriority, FormType, PatientStage, DischargeMilestoneStep, ClaimEventType } from '@/types';
import { PATIENT_STAGE_LABELS, VALID_STAGE_TRANSITIONS, DISCHARGE_MILESTONE_LABELS, CLAIM_STATUS_LABELS } from '@/types';
import { FORM_TYPE_LABELS, FORMS_BY_STAGE } from '@/lib/form-registry';
import { trackFeature } from '@/lib/session-tracker';

// --- Types ---

interface MessageAreaProps {
  channel: Channel | null;
  onOpenSidebar: () => void;
  onOpenThread: (message: MessageResponse) => void;
  scrollToMessageId?: string | null;
  onScrollComplete?: () => void;
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
  mentioned_user_ids: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wa_analysis?: any; // WhatsApp analysis card payload (custom GetStream message data)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat_task_card?: any; // CT.5 — chat-task card payload (PRD §4.5)
  raw: MessageResponse;
}

interface DeletedMessageRecord {
  message_id: string;
  channel_id: string;
  original_text: string;
  original_user_name: string;
  deleted_by_name: string;
  deleted_at: string;
  reason: string;
  is_system_message: boolean;
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
  'whatsapp-analysis': MessageSquare,
};

const REACTION_EMOJIS = [
  { emoji: '✅', type: 'check' },
  { emoji: '👍', type: 'thumbsup' },
  { emoji: '👀', type: 'eyes' },
  { emoji: '🙏', type: 'pray' },
  { emoji: '❓', type: 'question' },
];

// --- @Mention text rendering helper ---

function renderTextWithMentions(text: string, mentionedIds: string[], currentUserId: string): React.ReactNode {
  // Split on @Name patterns — highlight any @word that matches
  const parts = text.split(/(@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@') && part.length > 1) {
      const isMentioningMe = mentionedIds.includes(currentUserId);
      return (
        <span
          key={i}
          className={`font-semibold rounded px-0.5 ${
            isMentioningMe
              ? 'bg-blue-100 text-blue-700'
              : 'bg-purple-50 text-purple-700'
          }`}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

// --- Component ---

export function MessageArea({ channel, onOpenSidebar, onOpenThread, scrollToMessageId, onScrollComplete }: MessageAreaProps) {
  const { client } = useChatContext();
  const router = useRouter();
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<DisplayMessage | null>(null);
  // CT.6 — chat-task creation modal toggle.
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showDeletedAccordion, setShowDeletedAccordion] = useState(false);
  const [deletedRecords, setDeletedRecords] = useState<DeletedMessageRecord[]>([]);
  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pendingMentions, setPendingMentions] = useState<{ id: string; name: string }[]>([]);
  const [advancingStage, setAdvancingStage] = useState(false);
  // Read receipt: bump counter to force re-render when read state changes
  const [readTick, setReadTick] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeChannelRef = useRef<Channel | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // WhatsApp Insights upload hooks (must be before early returns)
  const waFileRef = useRef<HTMLInputElement>(null);
  const [waUploading, setWaUploading] = useState(false);
  const handleWAUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.txt')) {
      alert('Only .txt files accepted');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File too large (max 5MB)');
      return;
    }
    setWaUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/wa-analysis/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Upload failed');
      }
      // Message is posted to channel by the API — it'll appear automatically via real-time
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setWaUploading(false);
      if (waFileRef.current) waFileRef.current.value = '';
    }
  }, []);

  // Scroll to a specific message (from search navigation)
  useEffect(() => {
    if (!scrollToMessageId || messages.length === 0) return;

    // Small delay to let DOM render
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-message-id="${scrollToMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedMessageId(scrollToMessageId);
      }
      onScrollComplete?.();
    }, 300);

    // Clear highlight after animation
    const highlightTimer = setTimeout(() => setHighlightedMessageId(null), 2300);

    return () => {
      clearTimeout(timer);
      clearTimeout(highlightTimer);
    };
  }, [scrollToMessageId, messages, onScrollComplete]);

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
        mentioned_user_ids: (msg.mentioned_users || []).map((u: Record<string, unknown>) => (u.id as string) || ''),
        wa_analysis: msgExtra.wa_analysis || undefined,
        chat_task_card: msgExtra.chat_task_card || undefined, // CT.5
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

    const timers: ReturnType<typeof setTimeout>[] = [];

    const loadMessages = async () => {
      setLoading(true);
      try {
        await channel.watch();
        const state = channel.state;
        // Only show top-level messages (not thread replies), exclude deleted tombstones
        // Belt-and-suspenders: check both deleted_at AND type !== 'deleted'
        const topLevel = (state.messages || []).filter(
          (m) => !m.parent_id && !m.deleted_at && (m as Record<string, unknown>).type !== 'deleted'
        );
        setMessages(topLevel.map(toDisplayMessage));
        // Explicitly mark channel as read so unread badges update
        await channel.markRead();
        const timer = setTimeout(scrollToBottom, 100);
        timers.push(timer);
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    };

    // Fetch deleted messages from our DB for the accordion
    const fetchDeletedMessages = async () => {
      try {
        const channelFullId = `${channel.type}:${channel.id}`;
        const res = await fetch(`/api/chat/delete-message?channel_id=${encodeURIComponent(channelFullId)}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = await res.json();
        if (data.success) {
          setDeletedRecords(data.data || []);
        }
      } catch {
        // Non-fatal — accordion just won't show
      }
    };

    loadMessages();
    fetchDeletedMessages();

    const handleNewMessage = (event: { message?: MessageResponse }) => {
      if (event.message && !event.message.parent_id && !event.message.deleted_at && (event.message as Record<string, unknown>).type !== 'deleted') {
        setMessages((prev) => [...prev, toDisplayMessage(event.message!)]);
        const timer = setTimeout(scrollToBottom, 50);
        timers.push(timer);
      }
    };

    const handleReactionNew = () => {
      // Refresh messages to get updated reaction counts
      const topLevel = channel.state.messages.filter(
        (m) => !m.parent_id && !m.deleted_at && (m as Record<string, unknown>).type !== 'deleted'
      );
      setMessages(topLevel.map(toDisplayMessage));
    };

    const handleMessageDeleted = () => {
      // Message was deleted — refresh from channel state, exclude tombstones
      const topLevel = channel.state.messages.filter(
        (m) => !m.parent_id && !m.deleted_at && (m as Record<string, unknown>).type !== 'deleted'
      );
      setMessages(topLevel.map(toDisplayMessage));
    };

    // Read receipt: when another user reads the channel, bump tick to re-render checkmarks
    const handleReadEvent = () => setReadTick((t) => t + 1);

    channel.on('message.new', handleNewMessage);
    channel.on('message.deleted', handleMessageDeleted);
    channel.on('reaction.new', handleReactionNew);
    channel.on('reaction.deleted', handleReactionNew);
    channel.on('message.read', handleReadEvent);

    return () => {
      channel.off('message.new', handleNewMessage);
      channel.off('message.deleted', handleMessageDeleted);
      channel.off('reaction.new', handleReactionNew);
      channel.off('reaction.deleted', handleReactionNew);
      channel.off('message.read', handleReadEvent);
      timers.forEach(clearTimeout);
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

  // Build channel member list for @mention autocomplete
  const channelMembers = React.useMemo(() => {
    if (!channel?.state?.members) return [];
    return Object.entries(channel.state.members)
      .filter(([uid]) => uid !== client?.userID) // exclude self
      .map(([uid, m]) => ({
        id: uid,
        name: (m.user?.name as string) || uid,
        role: ((m.user as Record<string, unknown>)?.rounds_role as string) || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [channel?.state?.members, client?.userID]);

  // Filtered members for the autocomplete dropdown
  const filteredMentionMembers = React.useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return channelMembers.filter(
      (m) => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [mentionQuery, channelMembers]);

  // Handle @mention detection in textarea onChange
  const handleTextChange = (val: string, cursorPos: number) => {
    setMessageText(val);
    // Slash menu
    if (val === '/') {
      setShowSlashMenu(true);
      setSlashQuery('');
      setMentionQuery(null);
      return;
    } else if (val.startsWith('/')) {
      // Track slash command query for filtering
      const query = val.slice(1).split(/\s/)[0]; // Get text after / until space
      setSlashQuery(query);
      setShowSlashMenu(true);
      setMentionQuery(null);
      return;
    } else {
      setShowSlashMenu(false);
      setSlashQuery('');
    }

    // Detect @mention: look backwards from cursor for an unmatched @
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAt = textBeforeCursor.lastIndexOf('@');
    if (lastAt >= 0) {
      // Check that @ is at start or preceded by whitespace
      const charBefore = lastAt > 0 ? textBeforeCursor[lastAt - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastAt === 0) {
        const query = textBeforeCursor.slice(lastAt + 1);
        // Only show autocomplete if no space in query (single-word partial match) or short query
        if (!query.includes('\n') && query.length <= 30) {
          setMentionQuery(query);
          setMentionStartPos(lastAt);
          setMentionCursorPos(cursorPos);
          setMentionIndex(0);
          return;
        }
      }
    }
    setMentionQuery(null);
  };

  // Insert a selected mention into the text
  const insertMention = (member: { id: string; name: string }) => {
    const before = messageText.slice(0, mentionStartPos);
    const after = messageText.slice(mentionCursorPos);
    const mentionText = `@${member.name} `;
    const newText = before + mentionText + after;
    setMessageText(newText);
    setPendingMentions((prev) => {
      // Avoid duplicates
      if (prev.some((m) => m.id === member.id)) return prev;
      return [...prev, { id: member.id, name: member.name }];
    });
    setMentionQuery(null);
    // Refocus textarea and set cursor after mention
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = before.length + mentionText.length;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  // Send message with mention data
  const sendMessage = async () => {
    if (!messageText.trim() || !channel || sending) return;

    setSending(true);
    try {
      // Extract mentioned user IDs from the text (match @Name patterns against pendingMentions)
      const mentionedUserIds = pendingMentions
        .filter((m) => messageText.includes(`@${m.name}`))
        .map((m) => m.id);

      await channel.sendMessage({
        text: messageText.trim(),
        mentioned_users: mentionedUserIds,
      });
      trackFeature('chat_send_message', { channel_type: channel.type, has_mentions: mentionedUserIds.length > 0 });
      setMessageText('');
      setPendingMentions([]);
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  // Handle file upload — in WA channel, paperclip routes to analysis pipeline
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !channel) return;

    // In WhatsApp Insights channel: route .txt through analysis API
    if (channel.type === 'whatsapp-analysis') {
      // Delegate to the WA upload handler (reuse same logic)
      handleWAUpload(e);
      return;
    }

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
      trackFeature('chat_file_upload', { file_type: file.type, channel_type: channel.type });
    } catch (err) {
      console.error('File upload failed:', err);
    } finally {
      setUploading(false);
      // Clear file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSlashCommand = (query: string, patientId?: string) => {
    const channelData = channel?.data as Record<string, unknown> | undefined;
    const currentStage = (channelData?.current_stage as PatientStage) || null;

    // /fc - Open Financial Counselling form
    if (query === 'fc') {
      setShowSlashMenu(false);
      setMessageText('');
      const params = new URLSearchParams();
      params.set('type', 'financial_counseling');
      if (patientId) params.set('patient', patientId);
      if (channel?.type) params.set('channel_type', channel.type);
      if (channel?.id) params.set('channel_id', channel.id);
      router.push(`/forms/new?${params.toString()}`);
      return true;
    }

    // /fc-history - Show FC version history for current patient
    if (query === 'fc-history') {
      if (!patientId) {
        alert('FC history requires a patient thread');
        return false;
      }
      setShowSlashMenu(false);
      setMessageText('');
      // Navigate to FC form with history view (if available)
      const params = new URLSearchParams();
      params.set('type', 'financial_counseling');
      params.set('patient', patientId);
      params.set('view', 'history');
      if (channel?.type) params.set('channel_type', channel.type);
      if (channel?.id) params.set('channel_id', channel.id);
      router.push(`/forms?${params.toString()}`);
      return true;
    }

    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      // Check if this is a slash command that should be handled directly
      if (messageText.startsWith('/')) {
        const query = messageText.slice(1).trim();
        const channelData = channel?.data as Record<string, unknown> | undefined;
        const patientId = (channelData?.patient_thread_id as string) || undefined;

        if (handleSlashCommand(query, patientId)) {
          return; // Command was handled
        }
      }

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

  // For DM channels, resolve the other member's display name instead of showing the raw channel ID
  const resolvedChannelName = (() => {
    if (channel.data?.name) return channel.data.name as string;
    if (channel.type === 'direct' && client?.userID) {
      const members = Object.values(channel.state?.members || {});
      const otherMember = members.find((m) => m.user_id !== client.userID);
      if (otherMember?.user?.name) return otherMember.user.name;
    }
    // Fallback: strip !members- prefix if present for a slightly cleaner look
    const rawId = channel.id || 'Channel';
    return rawId.startsWith('!members-') ? 'Direct Message' : rawId;
  })();
  const channelName = resolvedChannelName;
  const channelDesc = (channel.data?.description as string) || '';
  const ChannelIcon = CHANNEL_TYPE_ICONS[channel.type] || Hash;
  const memberCount = Object.keys(channel.state?.members || {}).length;

  // WhatsApp Insights derived state (super_admin only)
  const isWAChannel = channel.type === 'whatsapp-analysis';
  const isSuperAdmin = ((client?.user as Record<string, unknown>)?.rounds_role as string) === 'super_admin';

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Hidden WA file input */}
      {isWAChannel && isSuperAdmin && (
        <input ref={waFileRef} type="file" accept=".txt" className="hidden" onChange={handleWAUpload} />
      )}

      {/* Channel header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden p-1 rounded-md hover:bg-gray-100"
        >
          <Menu size={18} className="text-gray-600" />
        </button>
        <ChannelIcon size={18} className={isWAChannel ? 'text-green-600 flex-shrink-0' : 'text-even-blue flex-shrink-0'} />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-even-navy truncate">
            {channelName}
          </h2>
          {channelDesc && (
            <p className="text-[11px] text-gray-400 truncate">{channelDesc}</p>
          )}
        </div>
        {/* WA Upload button — super_admin only, only in WA Insights channel */}
        {isWAChannel && isSuperAdmin && (
          <button
            onClick={() => waFileRef.current?.click()}
            disabled={waUploading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg
                       bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50
                       transition-colors"
            title="Upload WhatsApp export (.txt)"
          >
            {waUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {waUploading ? 'Analyzing...' : 'Upload Chat'}
          </button>
        )}
        {!isWAChannel && (
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
        )}
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
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
              <MessageSquare size={20} className="text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">
              {channel.type === 'patient-thread' ? 'No messages in this patient thread'
                : channel.type === 'direct' ? 'No messages yet'
                : 'No messages in this channel'}
            </p>
            <p className="text-xs text-gray-400 mt-1.5 max-w-[240px] mx-auto">
              {channel.type === 'patient-thread'
                ? 'Use the composer below to share updates, lab results, or escalate concerns about this patient.'
                : channel.type === 'direct'
                ? 'Say hello! Direct messages are private between you and this person.'
                : 'Type below to start the discussion. Use @mentions to loop someone in.'}
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => {
              const isOwn = msg.user_id === client?.userID;
              const isSystem = msg.is_system;
              const isHovered = hoveredMessageId === msg.id;
              const mentionsMe = msg.mentioned_user_ids.includes(client?.userID || '');
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
                    data-message-id={msg.id}
                    className={`group/sys relative px-3 py-2.5 rounded-lg border transition-all duration-500 ${
                      highlightedMessageId === msg.id ? 'ring-2 ring-yellow-400 bg-yellow-50' :
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
                  data-message-id={msg.id}
                  className={`group relative transition-all duration-500 ${showAvatar ? 'mt-3' : 'mt-0.5'} ${
                    highlightedMessageId === msg.id
                      ? 'pl-2 border-l-[3px] border-l-yellow-400 bg-yellow-50/70 rounded-r-md -ml-1 ring-1 ring-yellow-300'
                      : mentionsMe
                      ? 'pl-2 border-l-[3px] border-l-blue-500 bg-blue-50/50 rounded-r-md -ml-1'
                      : isRelevantRole ? 'pl-2 border-l-[3px] border-l-even-blue bg-blue-50/30 rounded-r-md -ml-1' : ''
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
                      {/* Read receipt checkmark — only on own messages */}
                      {isOwn && !msg.is_system && (
                        <ReadReceipt
                          status={computeReadStatus(
                            msg.created_at,
                            channel.state?.read as Record<string, { last_read?: string | Date; user?: { id?: string } }>,
                            msg.user_id,
                            Object.keys(channel.state?.members || {}).length
                          )}
                          className="ml-1"
                        />
                      )}
                    </div>
                  )}

                  <div className="ml-8">
                    {/* Message text — with @mention highlighting */}
                    {msg.text && (
                      <p className="text-sm text-gray-800 leading-relaxed">
                        {msg.mentioned_user_ids.length > 0
                          ? renderTextWithMentions(msg.text, msg.mentioned_user_ids, client?.userID || '')
                          : msg.text}
                      </p>
                    )}

                    {/* WhatsApp Analysis Card */}
                    {msg.wa_analysis && msg.wa_analysis.type === 'wa_analysis' && (
                      <WhatsAppAnalysisCard payload={msg.wa_analysis} />
                    )}

                    {/* CT.5 — Chat task card */}
                    {msg.chat_task_card && msg.chat_task_card.type === 'chat-task-card' && (
                      <ChatTaskCard
                        payload={msg.chat_task_card}
                        viewerProfileId={client?.userID || null}
                        viewerRole={(client?.user as Record<string, unknown> | undefined)?.rounds_role as string || null}
                      />
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
            {/* Deleted Messages Accordion — fetched from our DB */}
            {deletedRecords.length > 0 && (
              <div className="mt-4 border-t border-dashed border-gray-200 pt-3">
                <button
                  onClick={() => setShowDeletedAccordion(!showDeletedAccordion)}
                  className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-2"
                >
                  {showDeletedAccordion ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Trash2 size={12} />
                  <span>Deleted Messages ({deletedRecords.length})</span>
                </button>
                {showDeletedAccordion && (
                  <div className="space-y-1.5 pl-1">
                    {deletedRecords.map(dm => {
                      const delTime = new Date(dm.deleted_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                      const delDate = new Date(dm.deleted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                      const reasonLabels: Record<string, string> = {
                        mistake: 'Sent by mistake',
                        change_of_plans: 'Change of plans',
                        duplicate: 'Duplicate',
                        testing_debug: 'Testing/debug',
                        other: 'Other',
                      };
                      return (
                        <div key={dm.message_id} className="bg-gray-100/60 border border-gray-200 rounded-lg px-3 py-2 opacity-60">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-medium text-gray-500">
                              {dm.is_system_message ? '🤖 Rounds System' : dm.original_user_name}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 line-through leading-relaxed">
                            {dm.original_text}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-400">
                            <Trash2 size={10} />
                            <span>
                              Deleted by {dm.deleted_by_name || 'Unknown'} on {delDate} at {delTime}
                            </span>
                            {dm.reason && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span>{reasonLabels[dm.reason] || dm.reason}</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
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
          onDeleted={async () => {
            setDeleteTarget(null);
            // Refresh messages from channel state, exclude tombstones
            const topLevel = channel.state.messages.filter(
              (m) => !m.parent_id && !m.deleted_at && (m as Record<string, unknown>).type !== 'deleted'
            );
            setMessages(topLevel.map(toDisplayMessage));
            // Refresh deleted records from our DB for the accordion
            try {
              const channelFullId = `${channel.type}:${channel.id}`;
              const res = await fetch(`/api/chat/delete-message?channel_id=${encodeURIComponent(channelFullId)}`);
              if (!res.ok) throw new Error(`Request failed: ${res.status}`);
              const data = await res.json();
              if (data.success) setDeletedRecords(data.data || []);
            } catch { /* non-fatal */ }
          }}
        />
      )}

      {/* CT.6 — Create-task modal. Mounted at component root so it overlays everything. */}
      {channel && client?.userID && (() => {
        const cd = (channel.data as Record<string, unknown> | undefined) || undefined;
        const ptid = cd?.patient_thread_id as string | undefined;
        const ptName = cd?.patient_name as string | undefined;
        const ptUhid = cd?.uhid as string | undefined;
        const presetPatient = ptid
          ? { id: ptid, name: ptName ?? null, uhid: ptUhid ?? null }
          : null;
        return (
          <CreateTaskModal
            isOpen={showCreateTaskModal}
            channelId={channel.id || ''}
            channelType={channel.type}
            presetPatient={presetPatient}
            viewerProfileId={client.userID || ''}
            onClose={() => setShowCreateTaskModal(false)}
            onCreated={() => {
              setShowCreateTaskModal(false);
              trackFeature('chat_task_created', { channel_type: channel.type });
            }}
          />
        );
      })()}

      {/* Composer */}
      <div className="px-3 py-2 bg-white border-t border-gray-200">
        {(uploading || (isWAChannel && waUploading)) && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className={`w-4 h-4 border-2 rounded-full animate-spin ${
              isWAChannel ? 'border-green-200 border-t-green-600' : 'border-even-blue/20 border-t-even-blue'
            }`} />
            <span className="text-xs text-gray-500">
              {isWAChannel ? 'Analyzing WhatsApp chat...' : 'Uploading file...'}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            accept={isWAChannel ? '.txt' : 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'}
          />
          {/* In WA channel: only super_admin sees paperclip (routes to analysis). Others: normal upload. */}
          {(!isWAChannel || isSuperAdmin) && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || waUploading}
            className={`p-2 transition-colors flex-shrink-0 disabled:opacity-50 ${
              isWAChannel
                ? 'text-green-500 hover:text-green-700'
                : 'text-gray-400 hover:text-gray-600'
            }`}
            title={isWAChannel ? 'Upload WhatsApp chat export (.txt)' : 'Attach file'}
          >
            {isWAChannel ? <Upload size={18} /> : <Paperclip size={18} />}
          </button>
          )}
          {/* CT.6 — Open chat-task creation modal. Hidden in WA Insights channel. */}
          {!isWAChannel && (
            <button
              onClick={() => setShowCreateTaskModal(true)}
              className="p-2 text-gray-400 hover:text-even-blue hover:bg-blue-50 rounded transition-colors flex-shrink-0 flex items-center gap-1"
              title="Create task"
            >
              <Plus size={18} />
              <span className="text-xs font-medium hidden sm:inline">Task</span>
            </button>
          )}
          <div className="flex-1 relative">
            {/* Slash command menu */}
            {showSlashMenu && channel && (
              <SlashCommandMenu
                channel={channel}
                slashQuery={slashQuery}
                advancingStage={advancingStage}
                onSelectForm={(formType, patientId) => {
                  setShowSlashMenu(false);
                  setMessageText('');
                  const params = new URLSearchParams();
                  params.set('type', formType);
                  if (patientId) params.set('patient', patientId);
                  if (channel.type) params.set('channel_type', channel.type);
                  if (channel.id) params.set('channel_id', channel.id);
                  router.push(`/forms/new?${params.toString()}`);
                }}
                onAdvanceStage={async (patientId, newStage) => {
                  setShowSlashMenu(false);
                  setMessageText('');
                  setAdvancingStage(true);
                  try {
                    const res = await fetch(`/api/patients/${patientId}/stage`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ stage: newStage }),
                    });
                    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                    const data = await res.json();
                    if (!data.success) {
                      alert(`Stage change failed: ${data.error}`);
                    } else {
                      trackFeature('patient_stage_advance', { new_stage: newStage });
                    }
                  } catch (err) {
                    alert(`Stage change error: ${err}`);
                  } finally {
                    setAdvancingStage(false);
                  }
                }}
                onDischargeAction={async (patientId, action, step) => {
                  setShowSlashMenu(false);
                  setMessageText('');
                  try {
                    if (action === 'start') {
                      const res = await fetch(`/api/patients/${patientId}/discharge`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                      });
                      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                      const data = await res.json();
                      if (!data.success) alert(`Discharge start failed: ${data.error}`);
                    } else if (action === 'step' && step) {
                      const res = await fetch(`/api/patients/${patientId}/discharge`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ step }),
                      });
                      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                      const data = await res.json();
                      if (!data.success) alert(`Milestone update failed: ${data.error}`);
                    }
                  } catch (err) {
                    alert(`Discharge action error: ${err}`);
                  }
                }}
                onClaimAction={async (patientId, eventType, description, amount, portalReference) => {
                  setShowSlashMenu(false);
                  setMessageText('');
                  try {
                    if (eventType === '__create') {
                      // Create/load claim
                      const res = await fetch(`/api/patients/${patientId}/claim`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                      });
                      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                      const data = await res.json();
                      if (!data.success) alert(`Claim creation failed: ${data.error}`);
                    } else {
                      // Log a claim event — prompt for description if not provided
                      const desc = description || prompt(`Enter details for this event:`);
                      if (!desc) return;
                      const amt = amount ?? (
                        ['pre_auth_submitted', 'pre_auth_approved', 'pre_auth_partial',
                         'enhancement_submitted', 'enhancement_approved',
                         'final_bill_prepared', 'final_submitted', 'final_approved'].includes(eventType)
                          ? Number(prompt('Amount (₹):') || '0') || undefined
                          : undefined
                      );
                      const ref = portalReference ?? (
                        ['pre_auth_submitted'].includes(eventType)
                          ? prompt('Claim/reference number (optional):') || undefined
                          : undefined
                      );
                      const res = await fetch(`/api/patients/${patientId}/claim`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          eventType,
                          description: desc,
                          amount: amt,
                          portalReference: ref,
                        }),
                      });
                      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                      const data = await res.json();
                      if (!data.success) alert(`Claim event failed: ${data.error}`);
                    }
                  } catch (err) {
                    alert(`Claim action error: ${err}`);
                  }
                }}
                onArchive={async (patientId) => {
                  setShowSlashMenu(false);
                  setMessageText('');
                  if (!confirm('Archive this patient? They will be moved to the post-discharge archive.')) return;
                  try {
                    const res = await fetch('/api/patients/archive', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        patientThreadId: patientId,
                        archiveType: 'post_discharge',
                      }),
                    });
                    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                    const data = await res.json();
                    if (!data.success) {
                      alert(`Archive failed: ${data.error}`);
                    }
                  } catch (err) {
                    alert(`Archive error: ${err}`);
                  }
                }}
                onClose={() => {
                  setShowSlashMenu(false);
                  setMessageText('');
                }}
              />
            )}
            {/* @Mention autocomplete dropdown */}
            {mentionQuery !== null && filteredMentionMembers.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto z-20">
                <div className="px-3 py-1.5 border-b border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Mention someone</p>
                </div>
                {filteredMentionMembers.map((member, idx) => (
                  <button
                    key={member.id}
                    onClick={() => insertMention(member)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                      idx === mentionIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-full bg-even-blue flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-even-navy truncate">{member.name}</div>
                      {member.role && (
                        <div className="text-[10px] text-gray-400">{member.role.replace(/_/g, ' ')}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={messageText}
              onChange={(e) => {
                handleTextChange(e.target.value, e.target.selectionStart || 0);
              }}
              onKeyDown={(e) => {
                // Mention autocomplete keyboard nav
                if (mentionQuery !== null && filteredMentionMembers.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((prev) => Math.min(prev + 1, filteredMentionMembers.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex((prev) => Math.max(prev - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    insertMention(filteredMentionMembers[mentionIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionQuery(null);
                    return;
                  }
                }
                if (showSlashMenu && e.key === 'Escape') {
                  setShowSlashMenu(false);
                  setMessageText('');
                  e.preventDefault();
                  return;
                }
                handleKeyDown(e);
              }}
              placeholder={`Message #${channelName.toLowerCase()} — type @ to mention, / for commands`}
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
// Shows stage transitions, discharge milestones, forms, and actions
// in patient thread channels. Only forms in non-patient channels.
function SlashCommandMenu({
  channel,
  slashQuery,
  advancingStage,
  onSelectForm,
  onAdvanceStage,
  onDischargeAction,
  onClaimAction,
  onArchive,
  onClose,
}: {
  channel: Channel;
  slashQuery?: string;
  advancingStage: boolean;
  onSelectForm: (formType: FormType, patientId?: string) => void;
  onAdvanceStage: (patientId: string, newStage: string) => void;
  onDischargeAction: (patientId: string, action: 'start' | 'step', step?: DischargeMilestoneStep) => void;
  onClaimAction: (patientId: string, eventType: ClaimEventType | '__create', description?: string, amount?: number, portalReference?: string) => void;
  onArchive: (patientId: string) => void;
  onClose: () => void;
}) {
  const channelData = channel.data as Record<string, unknown> | undefined;
  const currentStage = (channelData?.current_stage as PatientStage) || null;
  const patientId = (channelData?.patient_thread_id as string) || undefined;
  const isPatientThread = channel.type === 'patient-thread';

  // Discharge milestone steps available from current stage
  const isDischargeStage = currentStage === 'discharge' || currentStage === 'post_op' || currentStage === 'medical_management';
  const dischargeSteps: { step: DischargeMilestoneStep; label: string; emoji: string }[] = isPatientThread && isDischargeStage ? [
    { step: 'pharmacy_clearance', label: 'Clear Pharmacy', emoji: '💊' },
    { step: 'lab_clearance', label: 'Clear Labs', emoji: '🔬' },
    { step: 'discharge_summary', label: 'Summary Finalized', emoji: '📝' },
    { step: 'billing_closure', label: 'Close Billing', emoji: '💰' },
    { step: 'final_bill_submitted', label: 'Submit to Insurer', emoji: '📤' },
    { step: 'final_approval', label: 'Log Approval', emoji: '✅' },
    { step: 'patient_settled', label: 'Patient Settled', emoji: '🧾' },
    { step: 'patient_departed', label: 'Patient Departed', emoji: '🚪' },
  ] : [];

  // Get valid next stages for this patient
  const nextStages: PatientStage[] = isPatientThread && currentStage
    ? (VALID_STAGE_TRANSITIONS[currentStage] || [])
    : [];

  // Build form list: stage-specific + any-stage
  const forms: FormType[] = [];
  if (isPatientThread && currentStage) {
    const stageForms = FORMS_BY_STAGE[currentStage] || [];
    const anyForms = FORMS_BY_STAGE['any'] || [];
    forms.push(...stageForms, ...anyForms);
  } else {
    const anyForms = FORMS_BY_STAGE['any'] || [];
    forms.push(...anyForms);
  }

  // Extra forms (not in current stage)
  const allForms = Object.keys(FORM_TYPE_LABELS) as FormType[];
  const extraForms = isPatientThread ? allForms.filter((f) => !forms.includes(f)) : [];

  // Filter forms if a slash query is present
  const filterFormsByQuery = (formList: FormType[], query?: string): FormType[] => {
    if (!query) return formList;
    const lowerQuery = query.toLowerCase();
    return formList.filter((formType) => {
      const label = FORM_TYPE_LABELS[formType].toLowerCase();
      const formTypeStr = formType.toLowerCase();
      // Match both the form type name and display label
      return label.includes(lowerQuery) || formTypeStr.includes(lowerQuery);
    });
  };

  const filteredForms = filterFormsByQuery(forms, slashQuery);
  const filteredExtraForms = filterFormsByQuery(extraForms, slashQuery);

  // Stage transition icon/color logic
  const getStageIcon = (target: PatientStage): string => {
    if (!currentStage) return '→';
    const currentIdx = Object.keys(PATIENT_STAGE_LABELS).indexOf(currentStage);
    const targetIdx = Object.keys(PATIENT_STAGE_LABELS).indexOf(target);
    return targetIdx > currentIdx ? '→' : '←';
  };

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-80 overflow-y-auto z-20">
      {/* Stage Transitions */}
      {isPatientThread && nextStages.length > 0 && patientId && (
        <>
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500">
              Move Patient {currentStage ? `from ${PATIENT_STAGE_LABELS[currentStage]}` : ''}
            </p>
          </div>
          <div className="py-1">
            {nextStages.map((stage) => (
              <button
                key={stage}
                onClick={() => onAdvanceStage(patientId, stage)}
                disabled={advancingStage}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-blue-50 text-left transition-colors disabled:opacity-50"
              >
                <span className="text-base shrink-0">{getStageIcon(stage)}</span>
                <span className="text-sm font-medium text-even-navy">
                  {PATIENT_STAGE_LABELS[stage]}
                </span>
                <span className="ml-auto text-[10px] text-blue-500 font-medium">
                  Stage
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Discharge Milestones */}
      {isPatientThread && patientId && dischargeSteps.length > 0 && (
        <>
          <div className="px-3 py-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500">
              Discharge Milestones
            </p>
          </div>
          <div className="py-1">
            {dischargeSteps.map(({ step, label, emoji }) => (
              <button
                key={step}
                onClick={() => onDischargeAction(patientId, 'step', step)}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-green-50 text-left transition-colors"
              >
                <span className="text-base shrink-0">{emoji}</span>
                <span className="text-sm font-medium text-even-navy">{label}</span>
                <span className="ml-auto text-[10px] text-green-600 font-medium">
                  Discharge
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Insurance Claim Actions */}
      {isPatientThread && patientId && (
        <>
          <div className="px-3 py-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500">
              Insurance Claim
            </p>
          </div>
          <div className="py-1">
            <button
              onClick={() => onClaimAction(patientId, '__create')}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-blue-50 text-left transition-colors"
            >
              <span className="text-base shrink-0">🏥</span>
              <span className="text-sm font-medium text-even-navy">Start / View Claim</span>
              <span className="ml-auto text-[10px] text-blue-500 font-medium">Claim</span>
            </button>
            <button
              onClick={async () => {
                const sumStr = prompt('Sum Insured (₹):');
                if (!sumStr) return;
                const sumInsured = Number(sumStr);
                if (!sumInsured || sumInsured <= 0) { alert('Invalid sum insured'); return; }
                const roomCategory = prompt('Room category (general / semi_private / private / suite / icu / nicu):');
                if (!roomCategory) return;
                try {
                  const res = await fetch('/api/billing/roomcalc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sumInsured, roomCategory }),
                  });
                  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                  const data = await res.json();
                  if (data.success) {
                    alert(data.data.message.replace(/\*\*/g, ''));
                  } else {
                    alert(`Error: ${data.error}`);
                  }
                } catch (err) {
                  alert(`Room calc error: ${err}`);
                }
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-blue-50 text-left transition-colors"
            >
              <span className="text-base shrink-0">🏠</span>
              <span className="text-sm font-medium text-even-navy">Room Rent Calculator</span>
              <span className="ml-auto text-[10px] text-blue-500 font-medium">Quick Calc</span>
            </button>
            {[
              { eventType: 'pre_auth_submitted' as ClaimEventType, label: 'Log Pre-Auth Submission', emoji: '📤' },
              { eventType: 'pre_auth_queried' as ClaimEventType, label: 'Log Insurer Query', emoji: '❓' },
              { eventType: 'pre_auth_query_responded' as ClaimEventType, label: 'Log Query Response', emoji: '💬' },
              { eventType: 'pre_auth_approved' as ClaimEventType, label: 'Log Pre-Auth Approval', emoji: '✅' },
              { eventType: 'pre_auth_denied' as ClaimEventType, label: 'Log Pre-Auth Denial', emoji: '❌' },
              { eventType: 'enhancement_submitted' as ClaimEventType, label: 'Submit Enhancement', emoji: '📤' },
              { eventType: 'enhancement_approved' as ClaimEventType, label: 'Log Enhancement Approval', emoji: '✅' },
              { eventType: 'final_submitted' as ClaimEventType, label: 'Submit Final Bill', emoji: '📤' },
              { eventType: 'final_approved' as ClaimEventType, label: 'Log Final Approval', emoji: '🟢' },
              { eventType: 'final_rejected' as ClaimEventType, label: 'Log Rejection', emoji: '🔴' },
              { eventType: 'note_added' as ClaimEventType, label: 'Add Claim Note', emoji: '📝' },
            ].map(({ eventType: evtType, label, emoji }) => (
              <button
                key={evtType}
                onClick={() => onClaimAction(patientId, evtType)}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-amber-50 text-left transition-colors"
              >
                <span className="text-base shrink-0">{emoji}</span>
                <span className="text-sm font-medium text-even-navy">{label}</span>
                <span className="ml-auto text-[10px] text-amber-600 font-medium">Claim</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Forms */}
      {filteredForms.length > 0 && (
        <>
          <div className="px-3 py-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500">
              {slashQuery && `Matching: `}
              {isPatientThread && currentStage
                ? `Forms for ${PATIENT_STAGE_LABELS[currentStage]}`
                : 'Available Forms'}
            </p>
          </div>
          <div className="py-1">
            {filteredForms.map((formType) => (
              <button
                key={formType}
                onClick={() => onSelectForm(formType, patientId)}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left transition-colors"
              >
                <ClipboardList size={14} className="text-even-blue shrink-0" />
                <span className="text-sm text-even-navy">
                  {FORM_TYPE_LABELS[formType]}
                </span>
                <span className="ml-auto text-[10px] text-purple-500 font-medium">
                  Form
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Extra forms for patient threads */}
      {filteredExtraForms.length > 0 && (
        <>
          <div className="px-3 py-1.5 border-t border-gray-100">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
              Other Forms
            </p>
          </div>
          <div className="py-1">
            {filteredExtraForms.map((formType) => (
              <button
                key={formType}
                onClick={() => onSelectForm(formType, patientId)}
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

      {/* Actions section */}
      {isPatientThread && patientId && (
        <>
          <div className="px-3 py-1.5 border-t border-gray-100">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
              Actions
            </p>
          </div>
          <div className="py-1">
            {/* Start Discharge — only when in a stage that can reach discharge */}
            {currentStage && ['admitted', 'medical_management', 'post_op', 'post_op_care', 'long_term_followup'].includes(currentStage) && (
              <button
                onClick={() => onDischargeAction(patientId, 'start')}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-green-50 text-left transition-colors"
              >
                <span className="text-base shrink-0">🏁</span>
                <span className="text-sm font-medium text-green-700">Start Discharge</span>
                <span className="ml-auto text-[10px] text-green-600 font-medium">
                  Milestone
                </span>
              </button>
            )}
            {/* Enhancement actions — for admitted insurance patients */}
            {currentStage && ['admitted', 'medical_management', 'pre_op', 'post_op', 'post_op_care'].includes(currentStage) && (
              <>
                <button
                  onClick={async () => {
                    const diagnosis = prompt('Current diagnosis:');
                    if (!diagnosis) return;
                    const treatment = prompt('Ongoing treatment:');
                    if (!treatment) return;
                    const reason = prompt('Reason for cost extension:');
                    if (!reason) return;
                    const estimate = Number(prompt('Revised cost estimate (₹):') || '0');
                    if (!estimate) return;
                    try {
                      const res = await fetch(`/api/patients/${patientId}/enhance`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          currentDiagnosis: diagnosis,
                          ongoingTreatment: treatment,
                          reasonForExtension: reason,
                          revisedEstimate: estimate,
                        }),
                      });
                      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                      const data = await res.json();
                      if (!data.success) alert(`Enhancement failed: ${data.error}`);
                    } catch (err) {
                      alert(`Enhancement error: ${err}`);
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-amber-50 text-left transition-colors"
                >
                  <span className="text-base shrink-0">👨‍⚕️</span>
                  <span className="text-sm font-medium text-amber-700">Submit Case Summary (Enhancement)</span>
                  <span className="ml-auto text-[10px] text-amber-600 font-medium">
                    Doctor
                  </span>
                </button>
                <button
                  onClick={async () => {
                    const billStr = prompt('Current running bill amount (₹):');
                    if (!billStr) return;
                    const runningBill = Number(billStr);
                    if (!runningBill || runningBill < 0) { alert('Invalid amount'); return; }
                    try {
                      const res = await fetch(`/api/patients/${patientId}/enhance`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ runningBill }),
                      });
                      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                      const data = await res.json();
                      if (data.success) {
                        const msg = data.data?.needsEnhancement
                          ? `Bill updated to ₹${runningBill.toLocaleString('en-IN')} — Enhancement alert fired!`
                          : `Bill updated to ₹${runningBill.toLocaleString('en-IN')}`;
                        alert(msg);
                      } else {
                        alert(`Update failed: ${data.error}`);
                      }
                    } catch (err) {
                      alert(`Update error: ${err}`);
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-amber-50 text-left transition-colors"
                >
                  <span className="text-base shrink-0">💰</span>
                  <span className="text-sm font-medium text-amber-700">Update Running Bill</span>
                  <span className="ml-auto text-[10px] text-amber-600 font-medium">
                    Billing
                  </span>
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/billing/check-enhancements', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ patientThreadId: patientId }),
                      });
                      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                      const data = await res.json();
                      if (data.success) {
                        alert(data.message);
                      } else {
                        alert(`Check failed: ${data.error}`);
                      }
                    } catch (err) {
                      alert(`Check error: ${err}`);
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-amber-50 text-left transition-colors"
                >
                  <span className="text-base shrink-0">🔔</span>
                  <span className="text-sm font-medium text-amber-700">Check Enhancement Need</span>
                  <span className="ml-auto text-[10px] text-amber-600 font-medium">
                    Alert
                  </span>
                </button>
              </>
            )}
            <button
              onClick={() => onArchive(patientId)}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-red-50 text-left transition-colors"
            >
              <Trash2 size={14} className="text-red-400 shrink-0" />
              <span className="text-sm text-red-600">Archive Patient</span>
            </button>
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
