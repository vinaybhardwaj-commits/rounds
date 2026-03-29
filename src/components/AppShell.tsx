'use client';

// ============================================
// AppShell — the main app wrapper with bottom tab bar.
// Replaces the old ChatPage (which only showed chat).
// Manages tab switching between Patients, Chat, Tasks, Me.
// Step 6.2: UX Redesign
// ============================================

import React, { useState, useCallback } from 'react';
import { ChatProvider } from '@/providers/ChatProvider';
import { ChatShell } from './chat/ChatShell';
import { PatientsView } from './patients/PatientsView';
import { TasksView } from './tasks/TasksView';
import { ProfileView } from './profile/ProfileView';
import { BottomTabBar, type TabId } from './layout/BottomTabBar';

interface AppShellProps {
  userId: string;
  userRole: string;
  streamToken: string | null;
}

export function AppShell({ userId, userRole, streamToken }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabId>('patients');
  const isAdmin = userRole === 'super_admin' || userRole === 'department_head';

  // When patient is tapped, switch to chat tab and navigate to their channel
  // (for now just switch tabs — full channel navigation comes with ChatShell integration)
  const handleNavigateToChannel = useCallback((_channelId: string) => {
    setActiveTab('chat');
    // TODO: pass channelId to ChatShell to auto-select that channel
  }, []);

  return (
    <ChatProvider userId={userId} initialStreamToken={streamToken}>
      <div className="h-screen flex flex-col overflow-hidden bg-even-white">
        {/* Tab content — takes full height minus tab bar */}
        <div className="flex-1 overflow-hidden">
          {/* Patients Tab */}
          <div className={activeTab === 'patients' ? 'h-full' : 'hidden'}>
            <PatientsView onNavigateToChannel={handleNavigateToChannel} />
          </div>

          {/* Chat Tab — keep mounted so GetStream stays connected */}
          <div className={activeTab === 'chat' ? 'h-full' : 'hidden'}>
            <ChatShell isAdmin={isAdmin} />
          </div>

          {/* Tasks Tab */}
          <div className={activeTab === 'tasks' ? 'h-full' : 'hidden'}>
            <TasksView />
          </div>

          {/* Me Tab */}
          <div className={activeTab === 'me' ? 'h-full' : 'hidden'}>
            <ProfileView isAdmin={isAdmin} />
          </div>
        </div>

        {/* Bottom Tab Bar */}
        <BottomTabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
    </ChatProvider>
  );
}
