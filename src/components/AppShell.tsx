'use client';

// ============================================
// AppShell — the main app wrapper with bottom tab bar.
// Replaces the old ChatPage (which only showed chat).
// Manages tab switching between Patients, Chat, Tasks, Me.
// Step 6.2: UX Redesign
// ============================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
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

  // Channel to auto-navigate to in Chat tab
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  // Track tab history for back button handling (non-default tabs only)
  const tabHistoryRef = useRef<TabId[]>(['patients']);

  // Handle browser back button: navigate through tab history instead of leaving the app
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const previousTab = event.state?.tab;
      if (previousTab && previousTab !== activeTab) {
        setActiveTab(previousTab);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab]);

  // Push browser history state when tab changes (but only for non-default tabs)
  useEffect(() => {
    // Only push history for non-default tabs to prevent navigating away from SPA on back
    if (activeTab !== 'patients') {
      window.history.pushState({ tab: activeTab }, '', window.location.href);
    }
  }, [activeTab]);

  // Clear pending channel after ChatShell picks it up
  const handleChannelNavigated = useCallback(() => {
    setPendingChannelId(null);
  }, []);

  // When patient is tapped, switch to chat tab and navigate to their channel
  const handleNavigateToChannel = useCallback((channelId: string) => {
    if (!channelId) return; // skip if no channel (old patients without GetStream channel)
    setPendingChannelId(channelId);
    setActiveTab('chat');
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
            <ChatShell
              isAdmin={isAdmin}
              pendingChannelId={pendingChannelId}
              onChannelNavigated={handleChannelNavigated}
            />
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
