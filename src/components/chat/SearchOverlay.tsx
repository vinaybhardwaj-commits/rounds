'use client';

// ============================================
// SearchOverlay — global message search
// Uses GetStream client.search() to find
// messages across all channels the user
// is a member of.
// ============================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Search, MessageSquare, Hash, Users, Activity, Megaphone } from 'lucide-react';
import { useChatContext } from '@/providers/ChatProvider';
import type { Channel } from 'stream-chat';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToChannel: (channel: Channel, messageId?: string) => void;
}

interface SearchResult {
  messageId: string;
  text: string;
  userName: string;
  userId: string;
  createdAt: string;
  channelId: string;
  channelName: string;
  channelType: string;
  channelCid: string;
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  department: Hash,
  'cross-functional': Users,
  'patient-thread': Activity,
  direct: MessageSquare,
  'ops-broadcast': Megaphone,
};

export function SearchOverlay({
  isOpen,
  onClose,
  onNavigateToChannel,
}: SearchOverlayProps) {
  const { client } = useChatContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setResults([]);
      setSearched(false);
    }
  }, [isOpen]);

  const searchMessages = useCallback(
    async (searchQuery: string) => {
      if (!client || searchQuery.trim().length < 2) {
        setResults([]);
        setSearched(false);
        return;
      }

      setLoading(true);
      setSearched(true);
      try {
        const response = await client.search(
          { members: { $in: [client.userID!] } },
          searchQuery,
          { limit: 20, offset: 0 }
        );

        const mapped: SearchResult[] = response.results.map((r) => {
          const msg = r.message;
          const ch = msg.channel;
          return {
            messageId: msg.id,
            text: msg.text || '',
            userName: msg.user?.name || msg.user?.id || 'Unknown',
            userId: msg.user?.id || '',
            createdAt: msg.created_at || '',
            channelId: ch?.id || '',
            channelName: (ch?.name as string) || (
              ch?.type === 'direct'
                ? `DM with ${msg.user?.name || 'someone'}`
                : ch?.id || 'Channel'
            ),
            channelType: ch?.type || 'messaging',
            channelCid: ch?.cid || '',
          };
        });

        setResults(mapped);
      } catch (err) {
        console.error('Message search failed:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchMessages(value), 350);
  };

  const handleResultClick = async (result: SearchResult) => {
    if (!client) return;

    try {
      const channel = client.channel(result.channelType, result.channelId);
      await channel.watch();
      onNavigateToChannel(channel, result.messageId);
      onClose();
    } catch (err) {
      console.error('Failed to navigate to channel:', err);
    }
  };

  // Highlight matching text
  const highlightMatch = (text: string, searchQuery: string) => {
    if (!searchQuery.trim()) return text;
    const truncated = text.length > 150 ? text.substring(0, 150) + '...' : text;
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = truncated.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    }
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />

      <div className="fixed inset-x-4 top-[8%] max-w-lg mx-auto bg-white rounded-xl shadow-2xl z-[61] flex flex-col max-h-[75vh]">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search messages..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="flex-1 text-sm text-gray-800 placeholder:text-gray-400 outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
          >
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin" />
            </div>
          ) : searched && results.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-8">
              No messages found
            </div>
          ) : !searched ? (
            <div className="text-center text-gray-400 text-sm py-8">
              Type at least 2 characters to search
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {results.map((result) => {
                const ChannelIcon = CHANNEL_ICONS[result.channelType] || Hash;
                return (
                  <button
                    key={result.messageId}
                    onClick={() => handleResultClick(result)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    {/* Channel label */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <ChannelIcon size={12} className="text-gray-400" />
                      <span className="text-[11px] text-gray-400 truncate">
                        {result.channelName}
                      </span>
                      <span className="text-[10px] text-gray-300 ml-auto flex-shrink-0">
                        {formatTime(result.createdAt)}
                      </span>
                    </div>

                    {/* Sender */}
                    <span className="text-xs font-semibold text-gray-600">
                      {result.userName}
                    </span>

                    {/* Message preview */}
                    <p className="text-sm text-gray-700 mt-0.5 line-clamp-2">
                      {highlightMatch(result.text, query)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
