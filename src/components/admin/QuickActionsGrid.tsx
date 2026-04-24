'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  UserCheck, UserPlus, Upload, Shield, Calendar, Activity,
  ClipboardList, AlertTriangle, Link2, MessageSquare, Database,
  ChevronDown, ChevronUp,
} from 'lucide-react';

interface QuickActionsGridProps {
  badges?: {
    approvals?: number;
    escalations?: number;
    rosterEntries?: number;
  };
  userRole?: string;
}

interface ActionCard {
  label: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  badge?: number;
  requiresRole?: string;
}

export function QuickActionsGrid({ badges = {}, userRole = 'admin' }: QuickActionsGridProps) {
  const [expanded, setExpanded] = useState(false);

  const actions: ActionCard[] = [
    { label: 'Approvals', description: 'Review pending signups', href: '/admin/approvals', icon: <UserCheck size={16} />, iconBg: 'bg-amber-500', badge: badges.approvals },
    { label: 'Add Staff', description: 'Create staff account', href: '/admin/profiles/add', icon: <UserPlus size={16} />, iconBg: 'bg-green-500' },
    { label: 'Bulk Import', description: 'CSV import staff', href: '/admin/profiles/import', icon: <Upload size={16} />, iconBg: 'bg-even-blue' },
    { label: 'Users', description: 'Manage all users', href: '/admin/users', icon: <Shield size={16} />, iconBg: 'bg-even-blue' },
    { label: 'Duty Roster', description: 'Shift assignments', href: '/admin/duty-roster', icon: <Calendar size={16} />, iconBg: 'bg-teal-600', badge: badges.rosterEntries },
    { label: 'Changelog', description: 'Patient history', href: '/admin/changelog', icon: <ClipboardList size={16} />, iconBg: 'bg-purple-500' },
    { label: 'Escalations', description: 'Open issues', href: '/admin/escalations', icon: <AlertTriangle size={16} />, iconBg: 'bg-red-500', badge: badges.escalations },
    { label: 'LeadSquared', description: 'LSQ sync & logs', href: '/admin/leadsquared', icon: <Link2 size={16} />, iconBg: 'bg-indigo-500' },
    { label: 'Chat System', description: 'Channels setup', href: '/admin/chat-system', icon: <MessageSquare size={16} />, iconBg: 'bg-cyan-500' },
    { label: 'Migrations', description: 'Run DB migrations', href: '/admin/migrate-page', icon: <Database size={16} />, iconBg: 'bg-gray-700', requiresRole: 'super_admin' },
  ];

  const visible = actions.filter(a => !a.requiresRole || a.requiresRole === userRole);

  return (
    <div className="bg-white rounded-xl border border-gray-100">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <h3 className="text-sm font-semibold text-even-navy">Admin Tools</h3>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {visible.map(action => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-2.5 p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all"
              >
                <div className={`w-8 h-8 ${action.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white">{action.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-even-navy truncate">{action.label}</span>
                    {action.badge !== undefined && action.badge > 0 && (
                      <span className="flex-shrink-0 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center" style={{ fontSize: '10px' }}>
                        {action.badge > 99 ? '99+' : action.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 truncate block">{action.description}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
