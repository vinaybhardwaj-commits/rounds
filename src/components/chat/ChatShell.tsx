'use client';

// ============================================
// ChatShell — the main chat interface wrapper.
// Manages: sidebar open/close state, active
// channel selection, mobile responsive layout.
// ============================================

import React, { useState, useCallback } from 'react';
import type { Channel } from 'stream-chat';
import { useChatContext } from '@/providers/ChatProvider';
import { ChannelSidebar } from './ChannelSidebar';
import { MessageArea } from './MessageArea';

interface ChatShellProps {
  isAdmin?: boolean;
}

export function ChatShell({ isAdmin = false }: ChatShellProps) {
  const { client, connecting, error } = useChatContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);

  const handleSelectChannel = useCallback(
    (channel: Channel) => {
      setActiveChannel(channel);
      setSidebarOpen(false); // Close sidebar on mobile after selection
    },
    []
  );

  // Loading state
  if (connecting) {
    return (
      <div className="flex items-center justify-center h-screen bg-even-white">
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
      <div className="flex items-center justify-center h-screen bg-even-white">
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

  return (
    <div className="flex h-screen overflow-hidden bg-even-white">
      {/* Sidebar */}
      <ChannelSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeChannelId={activeChannel?.cid ?? null}
        onSelectChannel={handleSelectChannel}
        isAdmin={isAdmin}
      />

      {/* Main content */}
      <MessageArea
        channel={activeChannel}
        onOpenSidebar={() => setSidebarOpen(true)}
      />
    </div>
  );
}
