'use client';

// ============================================
// AppShell — the main app wrapper with bottom tab bar.
// Replaces the old ChatPage (which only showed chat).
// Manages tab switching between Patients, Chat, Tasks, Me.
// Step 6.2: UX Redesign
// ============================================

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ChatProvider, useChatContext } from '@/providers/ChatProvider';
import { ChatShell } from './chat/ChatShell';
import { PatientsView } from './patients/PatientsView';
import { PatientDetailView } from './patients/PatientDetailView';
import { TasksView } from './tasks/TasksView';
import { ProfileView } from './profile/ProfileView';
import { BottomTabBar, type TabId } from './layout/BottomTabBar';

interface AppShellProps {
  userId: string;
  userRole: string;
  streamToken: string | null;
}

export function AppShell({ userId, userRole, streamToken }: AppShellProps) {
  return (
    <ChatProvider userId={userId} initialStreamToken={streamToken}>
      <AppShellInner userRole={userRole} />
    </ChatProvider>
  );
}

// ── Inner component (inside ChatProvider so it can use useChatContext) ──
function AppShellInner({ userRole }: { userRole: string }) {
  const { client } = useChatContext();
  const [activeTab, setActiveTab] = useState<TabId>('patients');
  const isAdmin = userRole === 'super_admin' || userRole === 'department_head';

  // Channel to auto-navigate to in Chat tab
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  // Patient detail view state
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  // Unread message count for Chat badge
  const [unreadCount, setUnreadCount] = useState(0);

  // Overdue count for Tasks badge
  const [overdueCount, setOverdueCount] = useState(0);

  // Track tab history for back button handling (non-default tabs only)
  const tabHistoryRef = useRef<TabId[]>(['patients']);

  // ── Unread count from GetStream ──
  useEffect(() => {
    if (!client) return;

    // Get initial unread count
    const updateUnread = () => {
      const user = client.user;
      if (user) {
        const total = (user.total_unread_count as number) || 0;
        setUnreadCount(total);
      }
    };

    updateUnread();

    // Listen for unread count changes
    const handleEvent = (event: { total_unread_count?: number }) => {
      if (typeof event.total_unread_count === 'number') {
        setUnreadCount(event.total_unread_count);
      }
    };

    client.on('notification.message_new', handleEvent);
    client.on('notification.mark_read', handleEvent);

    return () => {
      client.off('notification.message_new', handleEvent);
      client.off('notification.mark_read', handleEvent);
    };
  }, [client]);

  // Clear unread badge when switching to chat tab
  useEffect(() => {
    if (activeTab === 'chat' && client) {
      // GetStream will auto-mark as read when channel is watched
      // The badge will update via the event listener above
    }
  }, [activeTab, client]);

  // ── Overdue count for Tasks badge ──
  useEffect(() => {
    const fetchOverdue = async () => {
      try {
        const res = await fetch('/api/readiness/overdue');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setOverdueCount(data.data.length);
        }
      } catch {
        // Non-fatal — badge just won't show
      }
    };

    fetchOverdue();
    // Refresh overdue count every 2 minutes
    const interval = setInterval(fetchOverdue, 120_000);
    return () => clearInterval(interval);
  }, []);

  const badges = useMemo(() => {
    const b: Partial<Record<TabId, number>> = {};
    if (unreadCount > 0) b.chat = unreadCount;
    if (overdueCount > 0) b.tasks = overdueCount;
    return b;
  }, [unreadCount, overdueCount]);

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

  // When patient is tapped, open the detail view
  const handleOpenPatient = useCallback((patient: { id: string }) => {
    setSelectedPatientId(patient.id);
  }, []);

  // Close patient detail view
  const handleBackFromDetail = useCallback(() => {
    setSelectedPatientId(null);
  }, []);

  // From detail view: open a channel in Chat tab
  // Keep selectedPatientId so user returns to detail view when switching back to Patients tab
  const handleOpenChannelFromDetail = useCallback((channelId: string) => {
    if (!channelId) return;
    setPendingChannelId(channelId);
    setActiveTab('chat');
  }, []);

  // When patient is tapped in list (fallback: navigate directly to channel)
  const handleNavigateToChannel = useCallback((channelId: string) => {
    if (!channelId) return;
    setPendingChannelId(channelId);
    setActiveTab('chat');
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-even-white">
      {/* Tab content — takes full height minus tab bar */}
      <div className="flex-1 overflow-hidden">
        {/* Patients Tab */}
        <div className={activeTab === 'patients' ? 'h-full' : 'hidden'}>
          {selectedPatientId ? (
            <PatientDetailView
              patientId={selectedPatientId}
              onBack={handleBackFromDetail}
              onOpenChannel={handleOpenChannelFromDetail}
            />
          ) : (
            <PatientsView
              onOpenPatient={handleOpenPatient}
              onNavigateToChannel={handleNavigateToChannel}
            />
          )}
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
          <TasksView
            onNavigateToPatient={(patientThreadId) => {
              setSelectedPatientId(patientThreadId);
              setActiveTab('patients');
            }}
          />
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
        badges={badges}
      />
    </div>
  );
}
