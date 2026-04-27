'use client';

// ============================================
// ChannelSidebar — left panel showing channels
// grouped by type: Department, Cross-Functional,
// Direct Messages, Patient Threads
// Step 2.4: Added last message preview, "New
// Message" button, global search trigger.
// ============================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Hash,
  Users,
  MessageCircle,
  MessageSquare,
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
  'whatsapp-analysis': MessageSquare,
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
    new Set(['ops-broadcast', 'archived-post-dc', 'archived-removed'])
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  // Ref flag: only show the full-screen spinner on the INITIAL load.
  // Without this, any GetStream event (mark_read, message.new, etc.) refetches
  // the sidebar and briefly flashes the spinner — collapsing the scrollable
  // container and resetting scrollTop to 0.
  const hasLoadedOnceRef = useRef(false);
  // Debounce timer for event-driven refreshes so a burst of GetStream events
  // (e.g. 5 message.new in quick succession) collapses into a single reload.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-type cache of the last successful channel list. When a queryChannels
  // call errors (rate limit / network / auth), we reuse the last-known
  // channels for that type instead of wiping them to []. Layer 1 of the
  // error-handling refactor — supersedes the coarse 'preserve everything if
  // all-empty' guard with surgical per-type preservation.
  // 26 Apr 2026 — hide the WhatsApp Insights chat room from everyone until V's
  // smarter implementation is ready. The backend (/api/wa-analysis/*), the
  // admin redesign page (/admin/wa-analysis), the upload pipeline, and any
  // existing channels/messages stay intact — this only suppresses the entry
  // in the user-facing channel sidebar. Flip
  // NEXT_PUBLIC_FEATURE_WA_INSIGHTS_ENABLED=true to bring it back without
  // touching code.
  const WA_INSIGHTS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_WA_INSIGHTS_ENABLED === 'true';

  const lastKnownChannelsRef = useRef<Record<string, Channel[]>>({
    department: [],
    'cross-functional': [],
    'patient-thread': [],
    direct: [],
    'ops-broadcast': [],
    'whatsapp-analysis': [],
  });
  // 25 Apr 2026 (L14 fix): track which archived channels we've already
  // auto-marked-read so a burst of debounced reloads doesn't re-issue
  // markRead() on the same channel. GetStream treats mark-read as
  // idempotent but each call is still a network roundtrip.
  const markedReadArchivedRef = useRef<Set<string>>(new Set());

  // Fetch and group channels — query each type separately so department
  // and cross-functional channels aren't crowded out by patient threads
  const loadChannels = useCallback(async () => {
    if (!client) return;

    if (!hasLoadedOnceRef.current) setLoading(true);
    try {
      const userId = client.userID!;
      const sort = [{ last_message_at: -1 as const }];
      const opts = { watch: true, state: true };

      // Layer 1 error handling: each query returns a discriminated result
      // carrying either the channels or a classified error. On error we
      // fall back to the last-known channels for that type (preserved in
      // lastKnownChannelsRef) so a transient failure of one type doesn't
      // wipe that type's group from the sidebar.
      type SafeResult =
        | { ok: true; type: string; channels: Channel[] }
        | { ok: false; type: string; error: 'rate_limit' | 'auth' | 'network' | 'unknown'; message: string };

      const safeQuery = async (type: string, limit: number): Promise<SafeResult> => {
        try {
          const channels = await client.queryChannels(
            { type, members: { $in: [userId] } }, sort, { ...opts, limit }
          );
          return { ok: true, type, channels };
        } catch (e) {
          const err = e as { status?: number; code?: number; message?: string };
          let kind: 'rate_limit' | 'auth' | 'network' | 'unknown' = 'unknown';
          if (err.status === 429) kind = 'rate_limit';
          else if (err.status === 401 || err.status === 403) kind = 'auth';
          else if (err.status === undefined) kind = 'network';
          return { ok: false, type, error: kind, message: err.message || 'Unknown' };
        }
      };

      const results = await Promise.all([
        safeQuery('department', 30),
        safeQuery('cross-functional', 20),
        safeQuery('patient-thread', 200),
        safeQuery('direct', 30),
        safeQuery('ops-broadcast', 5),
        // 26 Apr 2026 — see WA_INSIGHTS_ENABLED comment above. When OFF we
        // return an empty success result so the rest of the merge logic
        // doesn't have to special-case the missing index.
        WA_INSIGHTS_ENABLED
          ? safeQuery('whatsapp-analysis', 5)
          : Promise.resolve({ ok: true, type: 'whatsapp-analysis', channels: [] } as const),
      ]);

      // Partial merge — for each type, use fresh channels if the query
      // succeeded, otherwise last-known. Cache successful results.
      const pick = (idx: number, typeKey: string): Channel[] => {
        const r = results[idx];
        if (r.ok) {
          lastKnownChannelsRef.current[typeKey] = r.channels;
          return r.channels;
        }
        return lastKnownChannelsRef.current[typeKey] || [];
      };
      const deptChannels = pick(0, 'department');
      const cfChannels = pick(1, 'cross-functional');
      const ptChannels = pick(2, 'patient-thread');
      const directChannels = pick(3, 'direct');
      const broadcastChannels = pick(4, 'ops-broadcast');
      const waChannels = pick(5, 'whatsapp-analysis');

      // Surgical warn: log exactly which types failed + what kind. First
      // error message included for quick debugging.
      const failed = results.filter(
        (r): r is Extract<SafeResult, { ok: false }> => !r.ok
      );
      if (failed.length > 0) {
        const summary = failed.map((f) => `${f.type}=${f.error}`).join(', ');
        console.warn(
          `[ChannelSidebar] ${failed.length}/6 queries errored: ${summary}. ` +
          'Preserved last-known channels for errored types. ' +
          (failed[0].message ? `First error: ${failed[0].message}` : '')
        );
      }

      const groups: Record<string, Channel[]> = {};
      const archivedPostDC: Channel[] = [];
      const archivedRemoved: Channel[] = [];

      // Assign non-patient channels directly.
      // Sprint 2 Day 9: split department channels into per-hospital sub-groups
      // by channel.data.hospital_slug (stamped at seed time). Channels without
      // the field (pre-Sprint-2 or un-reseeded) fall into a generic bucket.
      if (deptChannels.length > 0) {
        for (const ch of deptChannels) {
          const chData = ch.data as Record<string, unknown> | undefined;
          const slug = (chData?.hospital_slug as string) || '_unassigned';
          const key = slug === '_unassigned' ? 'department' : `department:${slug}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push(ch);
        }
      }
      if (cfChannels.length > 0) groups['cross-functional'] = cfChannels;
      if (directChannels.length > 0) groups['direct'] = directChannels;
      // MH.5 — split ops-broadcast channels by data.hospital_slug into
      // per-hospital "broadcast:{slug}" buckets (same pattern as departments
      // from Sprint 2 Day 9). Channels without a hospital_slug (legacy
      // 'hospital-broadcast') stay in the generic 'ops-broadcast' bucket.
      if (broadcastChannels.length > 0) {
        for (const ch of broadcastChannels) {
          const chData = ch.data as Record<string, unknown> | undefined;
          const slug = (chData?.hospital_slug as string) || '_unassigned';
          const key = slug === '_unassigned' ? 'ops-broadcast' : `broadcast:${slug}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push(ch);
        }
      }
      if (waChannels.length > 0) groups['whatsapp-analysis'] = waChannels;

      // Split patient threads into active vs archived
      for (const ch of ptChannels) {
        const chData = ch.data as Record<string, unknown> | undefined;
        const isArchived = chData?.archived === true;
        const archiveType = chData?.archive_type as string | undefined;

        if (isArchived) {
          if (archiveType === 'removed') {
            archivedRemoved.push(ch);
          } else {
            archivedPostDC.push(ch);
          }
          continue;
        }

        if (!groups['patient-thread']) groups['patient-thread'] = [];
        groups['patient-thread'].push(ch);
      }

      // Build per-hospital department rows sorted by hospital slug (stable).
      const hospitalDeptTypes = Object.keys(groups)
        .filter((k) => k.startsWith('department:'))
        .sort()
        .map((k) => {
          const slug = k.slice('department:'.length);
          return {
            type: k,
            label: `${slug.toUpperCase()} · Departments`,
            icon: Hash,
            defaultOpen: true,
          };
        });
      // MH.5 — same shape for per-hospital broadcasts. Defaults closed since
      // broadcasts are read-only ops announcements, not active workflows.
      const hospitalBroadcastTypes = Object.keys(groups)
        .filter((k) => k.startsWith('broadcast:'))
        .sort()
        .map((k) => {
          const slug = k.slice('broadcast:'.length);
          return {
            type: k,
            label: `${slug.toUpperCase()} · Broadcast`,
            icon: Megaphone,
            defaultOpen: false,
          };
        });
      const orderedTypes = [
        // 26 Apr 2026 — only render the group when the feature flag is ON.
        // When OFF, the array filter below will trivially drop the entry
        // because waChannels is empty, but adding an explicit gate keeps
        // intent obvious for the next reader.
        ...(WA_INSIGHTS_ENABLED
          ? [{ type: 'whatsapp-analysis', label: 'WhatsApp Insights', icon: MessageSquare, defaultOpen: true }]
          : []),
        ...hospitalDeptTypes,
        // Fallback bucket for any un-suffixed department channels (shouldn't
        // happen after Sprint 2 Day 9 re-seed but keeps old channels visible).
        { type: 'department', label: 'Departments (unassigned)', icon: Hash, defaultOpen: false },
        { type: 'direct', label: 'Direct Messages', icon: MessageCircle, defaultOpen: true },
        { type: 'cross-functional', label: 'Cross-Functional', icon: Users, defaultOpen: true },
        { type: 'patient-thread', label: 'Patient Threads', icon: Activity, defaultOpen: true },
        // MH.5 — per-hospital broadcasts (one row per accessible hospital).
        // Falls back to the generic 'ops-broadcast' bucket below for the
        // legacy un-suffixed 'hospital-broadcast' channel until that's retired.
        ...hospitalBroadcastTypes,
        { type: 'ops-broadcast', label: 'Broadcast (legacy)', icon: Megaphone, defaultOpen: false },
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

      // Per-type preservation (above) already filled in last-known channels
      // for any errored queries, so 'result' reflects the best available
      // view — fresh where we could, preserved where we had to. Errors
      // are already logged surgically; safe to set unconditionally.
      setChannelGroups(result);

      // Compute unread count from ACTIVE channels only (exclude archived)
      const activeChannels = Object.values(groups).flat();
      let activeUnread = 0;
      for (const ch of activeChannels) {
        activeUnread += ch.countUnread?.() || 0;
      }
      onUnreadCountChange?.(activeUnread);

      // Auto-mark archived channels as read so they don't pollute GetStream's global count.
      // Dedup: only mark channels we haven't already marked this session.
      const allArchived = [...archivedPostDC, ...archivedRemoved];
      for (const ch of allArchived) {
        const cid = ch.id || ch.cid;
        if (!cid) continue;
        if (markedReadArchivedRef.current.has(cid)) continue;
        if ((ch.countUnread?.() || 0) > 0) {
          ch.markRead().catch(() => {});
          markedReadArchivedRef.current.add(cid);
        } else {
          // No unread now — record so we don't re-check on every reload either.
          markedReadArchivedRef.current.add(cid);
        }
      }
    } catch (error) {
      console.error('Failed to load channels:', error);
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  }, [client, onUnreadCountChange]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Listen for new channels / channel updates / new messages
  useEffect(() => {
    if (!client) return;

    // Debounce: burst of events (5x message.new in <1s is common during
    // active hours) collapses into a single refetch.
    const handleEvent = () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        loadChannels();
      }, 250);
    };

    client.on('channel.updated', handleEvent);
    client.on('notification.added_to_channel', handleEvent);
    client.on('notification.removed_from_channel', handleEvent);
    client.on('message.new', handleEvent);
    client.on('notification.mark_read', handleEvent);

    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
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
            <div className="text-center py-12 px-4">
              <p className="text-white/50 text-sm font-medium">
                {searchQuery ? 'No channels match your search' : 'No channels yet'}
              </p>
              <p className="text-white/30 text-xs mt-1.5">
                {searchQuery
                  ? 'Try a different name or keyword'
                  : 'Channels are created when departments are set up or patients are admitted. Ask your admin if this looks wrong.'}
              </p>
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
                        // For DM channels, resolve the other member's name instead of showing raw channel ID
                        const channelName = (() => {
                          if (channel.data?.name) return channel.data.name as string;
                          if (channel.type === 'direct' && client?.userID) {
                            const members = Object.values(channel.state?.members || {});
                            const otherMember = members.find((m) => m.user_id !== client.userID);
                            if (otherMember?.user?.name) return otherMember.user.name;
                          }
                          const rawId = channel.id || 'Unnamed';
                          return rawId.startsWith('!members-') ? 'Direct Message' : rawId;
                        })();
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
