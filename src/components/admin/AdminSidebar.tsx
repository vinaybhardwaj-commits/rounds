'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ChevronLeft,
  LayoutDashboard,
  TrendingUp,
  Users,
  FileText,
  MessageSquare,
  HelpCircle,
  Brain,
  AlertTriangle,
  Gauge,
  Database,
  UserCog,
  UserCheck,
  Building2,
  Calendar,
  Activity,
  ClipboardList,
  Link2,
  GitMerge,
  Grid3x3,
  ShieldCheck,
  Network,
} from 'lucide-react';

interface AdminSidebarProps {
  activeSection?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  userRole?: string;
  badges?: {
    approvals?: number;
    escalations?: number;
    dedup?: number;
  };
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  requiresRole?: string;
  group: string;
}

const iconSize = 18;

const navItems: NavItem[] = [
  // INTELLIGENCE
  { group: 'INTELLIGENCE', label: 'Dashboard', href: '/admin', icon: <LayoutDashboard size={iconSize} /> },
  { group: 'INTELLIGENCE', label: 'Adoption', href: '/admin/adoption', icon: <TrendingUp size={iconSize} /> },
  { group: 'INTELLIGENCE', label: 'User Sessions', href: '/admin/sessions', icon: <Users size={iconSize} /> },
  { group: 'INTELLIGENCE', label: 'Form Analytics', href: '/admin/forms', icon: <FileText size={iconSize} /> },
  { group: 'INTELLIGENCE', label: 'Chat Analytics', href: '/admin/chat', icon: <MessageSquare size={iconSize} /> },
  { group: 'INTELLIGENCE', label: 'Help Analytics', href: '/admin/help', icon: <HelpCircle size={iconSize} /> },

  // SYSTEM
  {
    group: 'SYSTEM',
    label: 'LLM Observatory',
    href: '/admin/llm',
    icon: <Brain size={iconSize} />,
    requiresRole: 'super_admin',
  },
  { group: 'SYSTEM', label: 'Error Forensics', href: '/admin/errors', icon: <AlertTriangle size={iconSize} /> },
  { group: 'SYSTEM', label: 'API Performance', href: '/admin/api-performance', icon: <Gauge size={iconSize} /> },
  {
    group: 'SYSTEM',
    label: 'Database Explorer',
    href: '/admin/database',
    icon: <Database size={iconSize} />,
    requiresRole: 'super_admin',
  },
  {
    group: 'SYSTEM',
    label: 'Audit Log',
    href: '/admin/audit-log',
    icon: <ShieldCheck size={iconSize} />,
    requiresRole: 'super_admin',
  },

  // OPERATIONS
  { group: 'OPERATIONS', label: 'User Management', href: '/admin/users', icon: <UserCog size={iconSize} /> },
  { group: 'OPERATIONS', label: 'Approvals', href: '/admin/approvals', icon: <UserCheck size={iconSize} />, badge: 0 },
  { group: 'OPERATIONS', label: 'Departments', href: '/admin/departments', icon: <Building2 size={iconSize} /> },
  { group: 'OPERATIONS', label: 'Doctor Affiliations', href: '/admin/doctor-affiliations', icon: <Network size={iconSize} /> },
  { group: 'OPERATIONS', label: 'Duty Roster', href: '/admin/duty-roster', icon: <Calendar size={iconSize} /> },
  { group: 'OPERATIONS', label: 'Escalation Log', href: '/admin/escalations', icon: <AlertTriangle size={iconSize} />, badge: 0 },
  { group: 'OPERATIONS', label: 'Patient Changelog', href: '/admin/changelog', icon: <ClipboardList size={iconSize} /> },
  {
    group: 'OPERATIONS',
    label: 'Dedup Hub',
    href: '/admin/dedup',
    icon: <GitMerge size={iconSize} />,
    badge: 0,
    requiresRole: 'super_admin',
  },
  { group: 'OPERATIONS', label: 'WhatsApp Analysis', href: '/admin/wa-analysis', icon: <MessageSquare size={iconSize} /> },
  { group: 'OPERATIONS', label: 'Chat System Setup', href: '/admin/chat-system', icon: <MessageSquare size={iconSize} /> },
  { group: 'OPERATIONS', label: 'LeadSquared Integration', href: '/admin/leadsquared', icon: <Link2 size={iconSize} /> },
  {
    group: 'OPERATIONS',
    label: 'Migrations',
    href: '/admin/migrate-page',
    icon: <Database size={iconSize} />,
    requiresRole: 'super_admin',
  },
];

/**
 * Collapsible sidebar with grouped navigation for the Operations Intelligence Center.
 * Shows role-based items, badge counts, and smooth expand/collapse transitions.
 */
export function AdminSidebar({
  activeSection,
  collapsed: externalCollapsed,
  onToggle,
  userRole = 'admin',
  badges = { approvals: 0, escalations: 0, dedup: 0 },
}: AdminSidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;

  const toggleCollapse = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalCollapsed(!internalCollapsed);
    }
  };

  // Filter items based on user role
  const visibleItems = navItems.filter((item) => {
    if (item.requiresRole && item.requiresRole !== userRole) {
      return false;
    }
    return true;
  });

  // Group items by their group property
  const groups = Array.from(new Set(visibleItems.map((item) => item.group)));

  // Helper to get badge value
  const getBadgeValue = (label: string): number | undefined => {
    if (label === 'Approvals') return badges.approvals;
    if (label === 'Escalation Log') return badges.escalations;
    if (label === 'Dedup Hub') return badges.dedup;
    return undefined;
  };

  return (
    <>
      {/* Mobile overlay for collapsed sidebar */}
      {isCollapsed && (
        <div
          className="fixed inset-0 bg-black/20 lg:hidden z-30"
          onClick={toggleCollapse}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-12 bottom-0 bg-white border-r border-gray-200 transition-all duration-200 z-40 ${
          isCollapsed ? 'w-16' : 'w-56'
        } lg:relative lg:z-auto lg:top-0`}
      >
        {/* Toggle button */}
        <div className="h-12 flex items-center justify-end px-2 border-b border-gray-200">
          <button
            onClick={toggleCollapse}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            <ChevronLeft
              size={18}
              className={`transition-transform duration-200 ${
                isCollapsed ? 'rotate-180' : ''
              } text-gray-600`}
            />
          </button>
        </div>

        {/* Scrollable nav content */}
        <nav className="overflow-y-auto h-[calc(100vh-6rem)]">
          <div className="p-2 space-y-6">
            {groups.map((group) => {
              const groupItems = visibleItems.filter((item) => item.group === group);

              return (
                <div key={group}>
                  {/* Group header */}
                  {!isCollapsed && (
                    <div className="px-3 py-2 mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {group}
                      </h3>
                    </div>
                  )}

                  {/* Group items */}
                  <div className="space-y-1">
                    {groupItems.map((item) => {
                      const isActive = activeSection === item.label.toLowerCase().replace(/\s+/g, '-') ||
                        activeSection === item.href.split('/').pop();
                      const badgeValue = getBadgeValue(item.label);

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
                            isActive
                              ? 'bg-even-blue/10 text-even-blue'
                              : 'text-gray-700 hover:bg-gray-100'
                          }`}
                          title={isCollapsed ? item.label : undefined}
                        >
                          {/* Icon */}
                          <span className={`flex-shrink-0 transition-colors ${
                            isActive ? 'text-even-blue' : 'text-gray-500 group-hover:text-gray-700'
                          }`}>
                            {item.icon}
                          </span>

                          {/* Label and badge */}
                          {!isCollapsed && (
                            <div className="flex-1 min-w-0 flex items-center justify-between">
                              <span className="text-sm font-medium truncate">{item.label}</span>
                              {badgeValue !== undefined && badgeValue > 0 && (
                                <span className="flex-shrink-0 ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                                  {badgeValue > 99 ? '99+' : badgeValue}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Collapsed badge still shows */}
                          {isCollapsed && badgeValue !== undefined && badgeValue > 0 && (
                            <span className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 text-xs font-bold text-white bg-red-500 rounded-full ml-auto">
                              {badgeValue > 9 ? '9+' : badgeValue}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* GLASS.8 — Bottom-of-sidebar escape hatch (PRD §7.1).
                Visible to every authenticated user (NOT super_admin gated).
                Slack-style separator + lock-glyph label. */}
            {!isCollapsed && (
              <div className="pt-2 border-t border-gray-200 mt-2">
                <Link
                  href="/all-modules"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group text-gray-700 hover:bg-gray-100"
                  title="All Modules"
                >
                  <span className="flex-shrink-0 text-gray-500 group-hover:text-gray-700">
                    <Grid3x3 size={iconSize} />
                  </span>
                  <span className="text-sm font-medium truncate flex-1">🔓 All Modules</span>
                </Link>
              </div>
            )}
            {isCollapsed && (
              <div className="pt-2 border-t border-gray-200 mt-2">
                <Link
                  href="/all-modules"
                  className="flex items-center justify-center px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  title="All Modules"
                >
                  <Grid3x3 size={iconSize} />
                </Link>
              </div>
            )}
          </div>
        </nav>
      </aside>
    </>
  );
}
