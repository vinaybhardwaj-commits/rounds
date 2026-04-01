'use client';

// ============================================
// NewMessageDialog — start a new DM or create
// a group chat. DMs search users from GetStream.
// Group chats (admin only) create cross-functional
// channels visible to all staff.
// ============================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Search, MessageCircle, UserCircle, Users, Plus, Loader2 } from 'lucide-react';
import { useChatContext } from '@/providers/ChatProvider';
import type { Channel } from 'stream-chat';

interface NewMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onChannelCreated: (channel: Channel) => void;
  isAdmin?: boolean;
}

interface UserResult {
  id: string;
  name: string;
  email?: string;
  rounds_role?: string;
  department_id?: string;
  online?: boolean;
  image?: string;
}

type DialogTab = 'dm' | 'group';

export function NewMessageDialog({
  isOpen,
  onClose,
  onChannelCreated,
  isAdmin = false,
}: NewMessageDialogProps) {
  const { client } = useChatContext();
  const [tab, setTab] = useState<DialogTab>('dm');

  // DM state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Group chat state
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setResults([]);
      setTab('dm');
      setGroupName('');
      setGroupDescription('');
      setGroupError(null);
    }
  }, [isOpen]);

  // Search users with debounce
  const searchUsers = useCallback(
    async (searchQuery: string) => {
      if (!client || !searchQuery.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const response = await client.queryUsers(
          {
            $or: [
              { name: { $autocomplete: searchQuery } },
              { id: { $autocomplete: searchQuery } },
            ],
            id: { $ne: client.userID! },
          },
          { name: 1 },
          { limit: 15 }
        );

        setResults(
          response.users.map((u) => ({
            id: u.id,
            name: (u.name as string) || u.id,
            email: u.email as string | undefined,
            rounds_role: u.rounds_role as string | undefined,
            department_id: u.department_id as string | undefined,
            online: u.online,
            image: u.image as string | undefined,
          }))
        );
      } catch (err) {
        console.error('User search failed:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  // Debounced search
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchUsers(value), 250);
  };

  // Create or open DM channel
  const startDM = async (targetUser: UserResult) => {
    if (!client) return;

    setCreating(targetUser.id);
    try {
      const channel = client.channel('direct', {
        members: [client.userID!, targetUser.id],
      });
      await channel.watch();

      onChannelCreated(channel);
      onClose();
    } catch (err) {
      console.error('Failed to create DM channel:', err);
    } finally {
      setCreating(null);
    }
  };

  // Create group chat via admin API
  const createGroupChat = async () => {
    if (!groupName.trim()) return;

    setCreatingGroup(true);
    setGroupError(null);
    try {
      const res = await fetch('/api/admin/getstream/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (data.success && client) {
        // Open the newly created channel
        const channel = client.channel('cross-functional', data.data.channel_id);
        await channel.watch();
        onChannelCreated(channel);
        onClose();
      } else {
        setGroupError(data.error || 'Failed to create group');
      }
    } catch (err) {
      setGroupError(`Error: ${err}`);
    } finally {
      setCreatingGroup(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[60]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-x-4 top-[10%] max-w-md mx-auto bg-white rounded-xl shadow-2xl z-[61] flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-even-blue" />
            <h3 className="text-sm font-semibold text-even-navy">
              New Chat
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
          >
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-gray-100 px-4">
          <button
            onClick={() => setTab('dm')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'dm'
                ? 'border-even-blue text-even-blue'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <MessageCircle size={14} />
            Direct Message
          </button>
          {isAdmin && (
            <button
              onClick={() => setTab('group')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'group'
                  ? 'border-even-blue text-even-blue'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Users size={14} />
              Group Chat
            </button>
          )}
        </div>

        {/* DM Tab */}
        {tab === 'dm' && (
          <>
            {/* Search input */}
            <div className="px-4 py-2 border-b border-gray-100">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search by name..."
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  className="w-full bg-gray-50 text-sm text-gray-800 placeholder:text-gray-400 rounded-lg pl-8 pr-3 py-2 outline-none focus:bg-white focus:ring-1 focus:ring-even-blue/30 transition-colors"
                />
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin" />
                </div>
              ) : query && results.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8">
                  No users found
                </div>
              ) : !query ? (
                <div className="text-center text-gray-400 text-sm py-8">
                  Type a name to search
                </div>
              ) : (
                <div className="py-1">
                  {results.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => startDM(user)}
                      disabled={creating === user.id}
                      className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      {user.image ? (
                        <img
                          src={user.image}
                          alt={user.name}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                          <UserCircle size={20} className="text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {user.name}
                          </span>
                          {user.online && (
                            <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        {user.rounds_role && (
                          <span className="text-[11px] text-gray-400 capitalize">
                            {user.rounds_role.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      {creating === user.id && (
                        <div className="w-4 h-4 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Group Chat Tab */}
        {tab === 'group' && (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              Create a group chat visible to all staff. Great for committees, project teams, or coordination channels.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Group Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g., Quality Committee"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-even-blue/30 focus:border-even-blue outline-none transition-colors"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="e.g., Weekly quality review discussions"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-even-blue/30 focus:border-even-blue outline-none transition-colors"
              />
            </div>

            {groupError && (
              <div className="p-2 bg-red-50 text-red-700 text-sm rounded-lg">
                {groupError}
              </div>
            )}

            <button
              onClick={createGroupChat}
              disabled={creatingGroup || !groupName.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-even-blue text-white rounded-lg hover:bg-even-navy transition-colors disabled:opacity-50 text-sm font-medium"
            >
              {creatingGroup ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              {creatingGroup ? 'Creating...' : 'Create Group Chat'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
