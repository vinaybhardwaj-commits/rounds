'use client';

// ============================================
// ChatPage — client entry point for the chat UI.
// Receives server-side user data as props,
// initializes ChatProvider, renders ChatShell.
// ============================================

import React from 'react';
import { ChatProvider } from '@/providers/ChatProvider';
import { ChatShell } from './ChatShell';

interface ChatPageProps {
  userId: string;
  userRole: string;
  streamToken: string | null;
}

export function ChatPage({ userId, userRole, streamToken }: ChatPageProps) {
  const isAdmin = userRole === 'super_admin' || userRole === 'department_head';

  return (
    <ChatProvider userId={userId} initialStreamToken={streamToken}>
      <ChatShell isAdmin={isAdmin} />
    </ChatProvider>
  );
}
