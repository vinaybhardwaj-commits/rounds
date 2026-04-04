'use client';

// ============================================
// ChatShell — the main chat interface wrapper.
// Manages: sidebar open/close state, active
// channel selection, thread panel, DM dialog,
// global search overlay, mobile responsive.
// Step 2.4: Added thread, DM, search panels.
// ============================================

import React, { useState, useCallback, useEffect } from 'react';
import type { Channel, MessageResponse } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';
import { ChannelSidebar } from './ChannelSidebar';
import { MessageArea } from './MessageArea';
import { ThreadPanel } from './ThreadPanel';
import { NewMessageDialog } from './NewMessageDialog';
import { SearchOverlay } from './SearchOverlay';

interface ChatShellProps {
  isAdmin?: boolean;
  pendingChannelId?: string | null;
  onChannelNavigated?: () => void;
  onUnreadCountChange?: (count: number) => void;
}

export function ChatShell({
  isAdmin = false,
  pendingChannelId,
  onChannelNavigated,
  onUnreadCountChange,
}: ChatShellProps) {
  const { client, connecting, error } = useChatContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);

  // Thread state
  const [threadMessage, setThreadMessage] = useState<MessageResponse | null>(null);

  // Dialog state
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const handleSelectChannel = useCallback((channel: Channel) => {
    setActiveChannel(channel);
    setThreadMessage(null); // Close thread when switching channels
    setSidebarOpen(false);
  }, []);

  // Handle navigation to a specific channel from patient card
  useEffect(() => {
    if (!pendingChannelId || !client) return;

    let cancelled = false;

    const navigateToChannel = async () => {
      try {
        setChannelError(null);
        // Initialize the channel directly by type + id and watch it
        const channel = client.channel('patient-thread', pendingChannelId);
        await channel.watch();
        if (!cancelled) {
          handleSelectChannel(channel);
        }
      } catch (err) {
        console.error(`Failed to navigate to channel ${pendingChannelId}:`, err);
        setChannelError('Failed to load channel');
        // Fallback: try querying across all channel types
        try {
          const channels = await client.queryChannels(
            { type: 'patient-thread', id: { $eq: pendingChannelId } },
            {},
            { limit: 1 }
          );
          if (!cancelled && channels.length > 0) {
            handleSelectChannel(channels[0]);
            setChannelError(null);
          } else if (!cancelled) {
            setChannelError('Channel not found');
          }
        } catch (err2) {
          console.error('Fallback query also failed:', err2);
          if (!cancelled) {
            setChannelError('Failed to load channel');
          }
        }
      } finally {
        if (!cancelled) {
          onChannelNavigated?.();
        }
      }
    };

    navigateToChannel();

    return () => { cancelled = true; };
  }, [pendingChannelId, client, handleSelectChannel, onChannelNavigated]);

  const handleOpenThread = useCallback((message: MessageResponse) => {
    setThreadMessage(message);
  }, []);

  const handleCloseThread = useCallback(() => {
    setThreadMessage(null);
  }, []);

  const handleDMCreated = useCallback((channel: Channel) => {
    setActiveChannel(channel);
    setThreadMessage(null);
    setSidebarOpen(false);
  }, []);

  // Scroll-to-message state (from search navigation)
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);

  const handleSearchNavigate = useCallback(
    (channel: Channel, messageId?: string) => {
      setActiveChannel(channel);
      setThreadMessage(null);
      setSidebarOpen(false);
      if (messageId) {
        setScrollToMessageId(messageId);
      }
    },
    []
  );

  const handleScrollComplete = useCallback(() => {
    setScrollToMessageId(null);
  }, []);

  // Loading state
  if (connecting) {
    return (
      <div className="flex items-center justify-center h-full bg-even-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Connecting to Rounds...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !client) {
    return (
      <div className="flex items-center justify-center h-full bg-even-white">
        <div className="text-center max-w-sm p-6">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-red-500 text-xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-even-navy mb-1">
            Connection Failed
          </h2>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <a
            href="/api/auth/logout"
            className="text-sm text-even-blue hover:underline"
          >
            Log out and try again
          </a>
        </div>
      </div>
    );
  }

  // Channel error state
  if (channelError && !activeChannel) {
    return (
      <div className="flex items-center justify-center h-full bg-even-white">
        <div className="text-center max-w-sm p-6">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-red-500 text-xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-even-navy mb-1">
            {channelError}
          </h2>
          <p className="text-sm text-gray-500 mb-4">Unable to open this conversation right now</p>
          <button
            onClick={() => setChannelError(null)}
            className="text-sm text-even-blue hover:underline"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full overflow-hidden bg-even-white">
        {/* Sidebar */}
        <ChannelSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeChannelId={activeChannel?.cid ?? null}
          onSelectChannel={handleSelectChannel}
          isAdmin={isAdmin}
          onNewMessage={() => setNewMessageOpen(true)}
          onGlobalSearch={() => setSearchOpen(true)}
          onUnreadCountChange={onUnreadCountChange}
        />

        {/* Main content */}
        <MessageArea
          channel={activeChannel}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenThread={handleOpenThread}
          scrollToMessageId={scrollToMessageId}
          onScrollComplete={handleScrollComplete}
        />

        {/* Thread panel (desktop: side panel, mobile: overlay) */}
        {threadMessage && activeChannel && (
          <ThreadPanel
            channel={activeChannel}
            parentMessage={threadMessage}
            onClose={handleCloseThread}
          />
        )}
      </div>

      {/* Dialogs (rendered outside the flex container) */}
      <NewMessageDialog
        isOpen={newMessageOpen}
        onClose={() => setNewMessageOpen(false)}
        onChannelCreated={handleDMCreated}
        isAdmin={isAdmin}
      />

      <SearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigateToChannel={handleSearchNavigate}
      />
    </>
  );
}
