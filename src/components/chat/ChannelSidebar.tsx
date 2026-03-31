'use client';

// ============================================
// ChannelSidebar — left panel showing channels
// grouped by type: Department, Cross-Functional,
// Direct Messages, Patient Threads
// Step 2.4: Added last message preview, "New
// Message" button, global search trigger.
// ============================================

import React, { useState, useCallback, useEffect } from 'react';
import {
  Hash,
  Users,
  MessageCircle,
  Megaphone,
  ChevronDown,
  ChevronRight,
  Search,
  Settings,
  X,
  UserCircle,
  Activity,
  PenSquare,
  Archive,
  Trash2,
  AtSign,
} from 'lucide-react';
import type { Channel } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';

// --- Types ---

interface ChannelGroup {
  label: string;
  type: string;
  icon: React.ElementType;
  channels: Channel[];
  defaultOpen: boolean;
}

interface ChannelSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeChannelId: string | null;
  onSelectChannel: (channel: Channel) => void;
  isAdmin?: boolean;
  onNewMessage: () => void;
  onGlobalSearch: () => void;
  onUnreadCountChange?: (count: number) => void;
}

// --- Channel type → icon mapping ---
const CHANNEL_ICONS: Record<string, React.ElementType> = {
  department: Hash,
  'cross-functional': Users,
  'patient-thread': Activity,
  direct: MessageCircle,
  'ops-broadcast': Megaphone,
};

// --- Helpers ---

function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function getLastMessagePreview(channel: Channel): { text: string; time: string } {
  const msgs = channel.state?.messages;
  if (!msgs || msgs.length === 0) return { text: '', time: '' };
  // Skip deleted tombstones — find the most recent non-deleted message
  // Belt-and-suspenders: check both deleted_at AND type !== 'deleted'
  let last = msgs[msgs.length - 1];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as Record<string, unknown>;
    if (!msgs[i].deleted_at && m.type !== 'deleted') {
      last = msgs[i];
      break;
    }
    // If all messages are deleted, fall back to empty
    if (i === 0) return { text: '', time: '' };
  }
  const senderName = last.user?.name || last.user?.id || '';
  const text = last.text
    ? `${senderName ? senderName.split(' ')[0] + ': ' : ''}${last.text}`
    : last.attachments?.length
    ? `${senderName ? senderName.split(' ')[0] + ': ' : ''}[Attachment]`
    : '';
  const truncated = text.length > 40 ? text.substring(0, 40) + '...' : text;
  const time = formatRelativeTime(last.created_at as string);
  return { text: truncated, time };
}

// --- Component ---

export function ChannelSidebar({
  isOpen,
  onClose,
  activeChannelId,
  onSelectChannel,
  isAdmin = false,
  onNewMessage,
  onGlobalSearch,
  onUnreadCountChange,
}: ChannelSidebarProps) {
  const { client } = useChatContext();
  const [channelGroups, setChannelGroups] = useState<ChannelGroup[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(['direct', 'ops-broadcast', 'archived-post-dc', 'archived-removed'])
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch and group channels
  const loadChannels = useCallback(async () => {
    if (!client) return;

    setLoading(true);
    try {
      const filter = { members: { $in: [client.userID!] } };
      const sort = [{ last_message_at: -1 as const }];
      const channels = await client.queryChannels(filter, sort, {
        watch: true,
        state: true,
        limit: 100,
      });

      const groups: Record<string, Channel[]> = {};
      const archivedPostDC: Channel[] = [];
      const archivedRemoved: Channel[] = [];

      for (const ch of channels) {
        const type = ch.type || 'messaging';
        const chData = ch.data as Record<string, unknown> | undefined;
        const isArchived = chData?.archived === true;
        const archiveType = chData?.archive_type as string | undefined;

        // Split patient-thread channels into active vs archived
        if (type === 'patient-thread' && isArchived) {
          if (archiveType === 'removed') {
            archivedRemoved.push(ch);
          } else {
            archivedPostDC.push(ch);
          }
          continue;
        }

        if (!groups[type]) groups[type] = [];
        groups[type].push(ch);
      }

      const orderedTypes = [
        { type: 'department', label: 'Departments', icon: Hash, defaultOpen: true },
        { type: 'cross-functional', label: 'Cross-Functional', icon: Users, defaultOpen: true },
        { type: 'patient-thread', label: 'Patient Threads', icon: Activity, defaultOpen: true },
        { type: 'direct', label: 'Direct Messages', icon: MessageCircle, defaultOpen: false },
        { type: 'ops-broadcast', label: 'Broadcast', icon: Megaphone, defaultOpen: false },
      ];

      const result: ChannelGroup[] = orderedTypes
        .filter((t) => groups[t.type]?.length)
        .map((t) => ({
          label: t.label,
          type: t.type,
          icon: t.icon,
          channels: groups[t.type],
          defaultOpen: t.defaultOpen,
        }));

      // Add archived accordions at the end (collapsed by default)
      if (archivedPostDC.length > 0) {
        result.push({
          label: `Post-Discharge (${archivedPostDC.length})`,
          type: 'archived-post-dc',
          icon: Archive,
          channels: archivedPostDC,
          defaultOpen: false,
        });
      }
      if (archivedRemoved.length > 0) {
        result.push({
          label: `Removed (${archivedRemoved.length})`,
          type: 'archived-removed',
          icon: Trash2,
          channels: archivedRemoved,
          defaultOpen: false,
        });
      }

      setChannelGroups(result);

      // Compute unread count from ACTIVE channels only (exclude archived)
      const activeChannels = Object.values(groups).flat();
      let activeUnread = 0;
      for (const ch of activeChannels) {
        activeUnread += ch.countUnread?.() || 0;
      }
      onUnreadCountChange?.(activeUnread);

      // Auto-mark archived channels as read so they don't pollute GetStream's global count
      const allArchived = [...archivedPostDC, ...archivedRemoved];
      for (const ch of allArchived) {
        if ((ch.countUnread?.() || 0) > 0) {
          ch.markRead().catch(() => {});
        }
      }
    } catch (error) {
      console.error('Failed to load channels:', error);
    } finally {
      setLoading(false);
    }
  }, [client, onUnreadCountChange]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Listen for new channels / channel updates / new messages
  useEffect(() => {
    if (!client) return;

    const handleEvent = () => {
      loadChannels();
    };

    client.on('channel.updated', handleEvent);
    client.on('notification.added_to_channel', handleEvent);
    client.on('notification.removed_from_channel', handleEvent);
    client.on('message.new', handleEvent);
    client.on('notification.mark_read', handleEvent);

    return () => {
      client.off('channel.updated', handleEvent);
      client.off('notification.added_to_channel', handleEvent);
      client.off('notification.removed_from_channel', handleEvent);
      client.off('message.new', handleEvent);
      client.off('notification.mark_read', handleEvent);
    };
  }, [client, loadChannels]);

  const toggleGroup = (groupType: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupType)) {
        next.delete(groupType);
      } else {
        next.add(groupType);
      }
      return next;
    });
  };

  // Filter channels by search
  const filteredGroups = channelGroups
    .map((group) => ({
      ...group,
      channels: searchQuery
        ? group.channels.filter((ch) => {
            const name = (ch.data?.name as string) || ch.id || '';
            return name.toLowerCase().includes(searchQuery.toLowerCase());
          })
        : group.channels,
    }))
    .filter((group) => group.channels.length > 0);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 bottom-0 w-72 bg-even-navy text-white z-50
          flex flex-col
          transform transition-transform duration-200
          lg:relative lg:translate-x-0 lg:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-even-blue rounded-lg flex items-center justify-center">
              <span className="text-xs font-bold">R</span>
            </div>
            <span className="font-semibold text-sm">Rounds</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onNewMessage}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
              title="New message"
            >
              <PenSquare size={15} className="text-white/60" />
            </button>
            {isAdmin && (
              <a
                href="/admin"
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                title="Admin"
              >
                <Settings size={16} className="text-white/60" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-white/10 lg:hidden"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search — now triggers global search overlay */}
        <div className="px-3 py-2">
          <button
            onClick={onGlobalSearch}
            className="w-full flex items-center gap-2 bg-white/10 text-sm text-white/40 rounded-md px-3 py-1.5 hover:bg-white/15 transition-colors text-left"
          >
            <Search size={14} />
            <span>Search messages...</span>
          </button>
        </div>

        {/* Local channel filter */}
        {channelGroups.length > 10 && (
          <div className="px-3 pb-1">
            <input
              type="text"
              placeholder="Filter channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 text-xs text-white placeholder:text-white/30 rounded-md px-2.5 py-1 outline-none focus:bg-white/10 transition-colors"
            />
          </div>
        )}

        {/* Channel Groups */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center text-white/40 text-sm py-8">
              {searchQuery ? 'No channels match your search' : 'No channels yet'}
            </div>
          ) : (
            filteredGroups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.type);
              const GroupIcon = group.icon;

              return (
                <div key={group.type} className="mt-2">
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(group.type)}
                    className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] uppercase tracking-widest text-white/40 font-semibold hover:text-white/60 transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                    <GroupIcon size={12} />
                    <span>{group.label}</span>
                    <span className="ml-auto text-white/20">{group.channels.length}</span>
                  </button>

                  {/* Channels */}
                  {!isCollapsed && (
                    <div className="space-y-0.5 mt-0.5">
                      {group.channels.map((channel) => {
                        const channelName =
                          (channel.data?.name as string) || channel.id || 'Unnamed';
                        const isActive = channel.cid === activeChannelId;
                        const ChannelIcon =
                          CHANNEL_ICONS[channel.type] || Hash;
                        const unreadCount = channel.countUnread?.() || 0;
                        const mentionCount = (channel as unknown as { countUnreadMentions?: () => number }).countUnreadMentions?.() || 0;
                        const { text: lastMsg, time: lastTime } =
                          getLastMessagePreview(channel);
                        const isArchivedChannel = group.type.startsWith('archived-');

                        return (
                          <button
                            key={channel.cid}
                            onClick={() => onSelectChannel(channel)}
                            className={`
                              flex items-start gap-2 w-full px-2.5 py-1.5 rounded-md text-sm transition-colors
                              ${
                                isActive
                                  ? 'bg-even-blue text-white'
                                  : mentionCount > 0
                                  ? 'bg-blue-600/20 text-white border-l-2 border-l-blue-400 hover:bg-blue-600/30'
                                  : isArchivedChannel
                                  ? 'text-white/30 hover:bg-white/5 hover:text-white/50'
                                  : unreadCount > 0
                                  ? 'text-white font-medium hover:bg-white/10'
                                  : 'text-white/70 hover:bg-white/10 hover:text-white'
                              }
                            `}
                          >
                            <ChannelIcon
                              size={15}
                              className="flex-shrink-0 mt-0.5"
                            />
                            <div className="flex-1 min-w-0 text-left">
                              <div className="flex items-center gap-1">
                                <span
                                  className={`truncate flex-1 ${
                                    unreadCount > 0 ? 'font-semibold' : ''
                                  }`}
                                >
                                  {channelName}
                                </span>
                                {lastTime && (
                                  <span
                                    className={`text-[10px] flex-shrink-0 ${
                                      isActive ? 'text-white/60' : 'text-white/30'
                                    }`}
                                  >
                                    {lastTime}
                                  </span>
                                )}
                              </div>
                              {lastMsg && (
                                <p
                                  className={`text-[11px] truncate mt-0.5 ${
                                    isActive
                                      ? 'text-white/60'
                                      : unreadCount > 0
                                      ? 'text-white/50'
                                      : 'text-white/25'
                                  }`}
                                >
                                  {lastMsg}
                                </p>
                              )}
                            </div>
                            {mentionCount > 0 ? (
                              <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center bg-blue-500 text-white text-[10px] font-bold rounded-full px-1 mt-0.5 gap-0.5">
                                <AtSign size={8} /> {mentionCount > 99 ? '99+' : mentionCount}
                              </span>
                            ) : unreadCount > 0 ? (
                              <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center bg-even-pink text-white text-[10px] font-bold rounded-full px-1 mt-0.5">
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* User footer */}
        <div className="px-3 py-2 border-t border-white/10">
          <div className="flex items-center gap-2">
            <UserCircle size={20} className="text-white/40 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/60 truncate">
                {client?.user?.name || 'Loading...'}
              </div>
            </div>
            <a
              href="/api/auth/logout"
              className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
            >
              Log out
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
