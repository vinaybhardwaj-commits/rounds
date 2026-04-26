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
import { FormsView } from './forms/FormsView';
import { BottomTabBar, type TabId } from './layout/BottomTabBar';
import HelpWidget from './help/HelpWidget';

interface AppShellProps {
  userId: string;
  userRole: string;
  streamToken: string | null;
}

export function AppShell({ userId, userRole, streamToken }: AppShellProps) {
  return (
    <ChatProvider userId={userId} initialStreamToken={streamToken}>
      <AppShellInner userId={userId} userRole={userRole} />
    </ChatProvider>
  );
}

// ── Inner component (inside ChatProvider so it can use useChatContext) ──
function AppShellInner({ userId, userRole }: { userId: string; userRole: string }) {
  useChatContext(); // keep ChatProvider mounted
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
  // OT pending count for Tasks badge
  const [otPendingCount, setOtPendingCount] = useState(0);
  // Which sub-tab to open in Tasks (set by OT banner click)
  const [tasksInitialTab, setTasksInitialTab] = useState<'briefing' | 'overdue' | 'escalations' | 'ot_items' | undefined>(undefined);

  // Suppress popstate handling during programmatic history changes
  const suppressPopStateRef = useRef(false);
  // Track whether we've replaced the initial history entry
  const initializedRef = useRef(false);

  // Unread count is now computed by ChannelSidebar from active (non-archived) channels only,
  // passed up via onUnreadCountChange callback through ChatShell.
  const handleUnreadCountChange = useCallback((count: number) => {
    setUnreadCount(count);
  }, []);

  // ── Overdue + OT pending counts for Tasks badge ──
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchCounts = async () => {
      try {
        const [overdueRes, otRes] = await Promise.all([
          fetch('/api/readiness/overdue', { signal: controller.signal }),
          fetch('/api/ot/readiness/mine?count_only=true', { signal: controller.signal }),
        ]);
        if (cancelled) return;
        const overdueData = await overdueRes.json();
        if (overdueData.success && Array.isArray(overdueData.data)) {
          setOverdueCount(overdueData.data.length);
        }
        const otData = await otRes.json();
        if (otData.success) {
          const c = typeof otData.data === 'number' ? otData.data : (otData.data?.count ?? 0);
          setOtPendingCount(c);
        }
      } catch {
        // Non-fatal — badge just won't show
      }
    };

    fetchCounts();
    // Refresh every 2 minutes
    const interval = setInterval(fetchCounts, 120_000);
    // Re-fetch immediately when OT items change (confirm/bulk-confirm)
    const handleOtChange = () => fetchCounts();
    window.addEventListener('ot-items-changed', handleOtChange);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('ot-items-changed', handleOtChange);
    };
  }, []);

  const badges = useMemo(() => {
    const b: Partial<Record<TabId, number>> = {};
    if (unreadCount > 0) b.chat = unreadCount;
    const tasksBadge = overdueCount + otPendingCount;
    if (tasksBadge > 0) b.tasks = tasksBadge;
    return b;
  }, [unreadCount, overdueCount, otPendingCount]);

  // ── Browser History Management ──
  // Every navigation state = { tab, patientId? } pushed to browser history.
  // Back button restores previous state instead of leaving the app.

  // Replace the initial history entry with our SPA state on mount
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      window.history.replaceState(
        { tab: 'patients', patientId: null, _rounds: true },
        '',
        window.location.href
      );
    }
  }, []);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (suppressPopStateRef.current) return;

      const state = event.state;
      if (state?._rounds) {
        // Restore SPA state from history
        suppressPopStateRef.current = true;
        if (state.tab && state.tab !== activeTab) {
          setActiveTab(state.tab);
        }
        setSelectedPatientId(state.patientId || null);
        suppressPopStateRef.current = false;
      } else {
        // No SPA state — user tried to go before the app.
        // Push them back into the app to prevent leaving.
        window.history.pushState(
          { tab: activeTab, patientId: selectedPatientId, _rounds: true },
          '',
          window.location.href
        );
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, selectedPatientId]);

  // Clear pending channel after ChatShell picks it up
  const handleChannelNavigated = useCallback(() => {
    setPendingChannelId(null);
  }, []);

  // Helper: push a new SPA state entry into browser history
  const pushNavState = useCallback((tab: TabId, patientId: string | null = null) => {
    window.history.pushState(
      { tab, patientId, _rounds: true },
      '',
      window.location.href
    );
  }, []);

  // Tab change handler — wraps setActiveTab with history push
  const handleTabChange = useCallback((tab: TabId) => {
    if (tab === activeTab) return;
    pushNavState(tab, tab === 'patients' ? selectedPatientId : null);
    setActiveTab(tab);
  }, [activeTab, selectedPatientId, pushNavState]);

  // When patient is tapped, open the detail view
  const handleOpenPatient = useCallback((patient: { id: string }) => {
    pushNavState('patients', patient.id);
    setSelectedPatientId(patient.id);
  }, [pushNavState]);

  // Close patient detail view — use browser back so history stays consistent
  const handleBackFromDetail = useCallback(() => {
    // If there's history to go back to, use it (keeps history stack clean)
    // The popstate handler will set selectedPatientId to null
    window.history.back();
  }, []);

  // From detail view: open a channel in Chat tab
  const handleOpenChannelFromDetail = useCallback((channelId: string) => {
    if (!channelId) return;
    setPendingChannelId(channelId);
    pushNavState('chat', null);
    setActiveTab('chat');
  }, [pushNavState]);

  // When patient is tapped in list (fallback: navigate directly to channel)
  const handleNavigateToChannel = useCallback((channelId: string) => {
    if (!channelId) return;
    setPendingChannelId(channelId);
    pushNavState('chat', null);
    setActiveTab('chat');
  }, [pushNavState]);

  // CT.10: listen for 'rounds:open-chat' custom events fired by CoordinatorTasksPanel's
  // 'Open in chat' button (and any future caller). Same-tree event bus, no URL plumbing.
  // Detail shape: { channelId: string, channelType: string|null, messageId: string|null }
  // For non-patient-thread channels (department/direct/broadcast), pendingChannelId
  // navigation may not resolve (ChatShell only handles patient-thread for that path);
  // we still switch to the chat tab so the user lands in the right surface.
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ channelId?: string; channelType?: string | null; messageId?: string | null }>;
      const channelId = ce.detail?.channelId;
      if (!channelId) return;
      const channelType = ce.detail?.channelType || null;
      // Only seed pendingChannelId for patient-thread (existing ChatShell support).
      if (channelType === 'patient-thread') {
        setPendingChannelId(channelId);
      }
      pushNavState('chat', null);
      setActiveTab('chat');
      // messageId-based scroll-to-message is deferred — it requires threading
      // pendingMessageId through ChatShell to MessageArea.scrollToMessageId.
    };
    window.addEventListener('rounds:open-chat', handler);
    return () => window.removeEventListener('rounds:open-chat', handler);
  }, [pushNavState]);

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-even-white">
      {/* Tab content — takes full height minus tab bar */}
      <div className="flex-1 overflow-hidden">
        {/* Patients Tab */}
        <div className={activeTab === 'patients' ? 'h-full' : 'hidden'}>
          {selectedPatientId ? (
            <PatientDetailView
              patientId={selectedPatientId}
              onBack={handleBackFromDetail}
              onOpenChannel={handleOpenChannelFromDetail}
              userRole={userRole}
              userId={userId}
            />
          ) : (
            <PatientsView
              onOpenPatient={handleOpenPatient}
              onNavigateToChannel={handleNavigateToChannel}
              onViewOTItems={() => {
                setTasksInitialTab('ot_items');
                pushNavState('tasks', null);
                setActiveTab('tasks');
              }}
            />
          )}
        </div>

        {/* Chat Tab — keep mounted so GetStream stays connected */}
        <div className={activeTab === 'chat' ? 'h-full' : 'hidden'}>
          <ChatShell
            isAdmin={isAdmin}
            pendingChannelId={pendingChannelId}
            onChannelNavigated={handleChannelNavigated}
            onUnreadCountChange={handleUnreadCountChange}
          />
        </div>

        {/* Forms Tab */}
        <div className={activeTab === 'forms' ? 'h-full' : 'hidden'}>
          <FormsView />
        </div>

        {/* Tasks Tab */}
        <div className={activeTab === 'tasks' ? 'h-full' : 'hidden'}>
          <TasksView
            userRole={userRole}
            userId={userId}
            initialTab={tasksInitialTab}
            onNavigateToPatient={(patientThreadId) => {
              pushNavState('patients', patientThreadId);
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
        onTabChange={handleTabChange}
        badges={badges}
      />

      {/* Help Widget — floating ? button, always available */}
      <HelpWidget currentPage={`/${activeTab}${selectedPatientId ? `/${selectedPatientId}` : ''}`} />
    </div>
  );
}
