'use client';

import { useState } from 'react';
import { HealthBar } from './HealthBar';
import { AdminSidebar } from './AdminSidebar';

interface AdminShellProps {
  children: React.ReactNode;
  activeSection?: string;
  userRole?: string;
  badges?: {
    approvals?: number;
    admissions?: number;
    escalations?: number;
    dedup?: number;
  };
  health?: any;
}

/**
 * Main layout wrapper for the Operations Intelligence Center.
 * Combines HealthBar (fixed top), collapsible AdminSidebar, and scrollable content area.
 *
 * Structure:
 * ┌─────────────────────────────────────────┐
 * │ HealthBar (fixed top, 48px, full-width) │
 * ├──────┬──────────────────────────────────┤
 * │      │                                  │
 * │ Side │   Content Area (children)        │
 * │ bar  │                                  │
 * │ 220px│   (scrollable, padded)           │
 * │      │                                  │
 * ├──────┴──────────────────────────────────┤
 */
export function AdminShell({
  children,
  activeSection,
  userRole = 'admin',
  badges = { approvals: 0, admissions: 0, escalations: 0, dedup: 0 },
  health,
}: AdminShellProps) {
  // Start collapsed on mobile (< 1024px)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  );

  return (
    <div className="h-screen bg-even-white overflow-hidden flex flex-col">
      {/* Fixed health bar at top */}
      <HealthBar health={health} />

      {/* Main container with sidebar and content */}
      <div className="flex-1 flex overflow-hidden pt-12">
        {/* Sidebar */}
        <AdminSidebar
          activeSection={activeSection}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          userRole={userRole}
          badges={badges}
        />

        {/* Content area — add left margin on mobile to clear fixed sidebar */}
        <main className={`flex-1 overflow-y-auto transition-all duration-200 ${
          sidebarCollapsed ? 'ml-16 lg:ml-0' : 'ml-0'
        }`}>
          <div className="p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
