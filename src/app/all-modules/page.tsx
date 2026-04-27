'use client';

// =============================================================================
// /all-modules — Glass Mode escape hatch (GLASS.8)
//
// Per PRD §7.1: every authenticated EHRC user lands here from the bottom-of-
// sidebar entry to see every clinical module/page they can reach. Curated role-
// tailored landing pages (nurse-home, doctor-views, etc.) stay; this page is
// the "I want to find that other thing" backstop.
//
// Layout: domain-grouped grid of cards. Each card → the module's primary page.
// Hospital tenancy is preserved on every destination — visibility here doesn't
// override the destination page's tenancy SQL clauses.
//
// Telemetry: glass.all_modules_open fired on mount (page loaded).
// =============================================================================

import Link from 'next/link';
import React, { useEffect } from 'react';
import {
  Users, Calendar, ClipboardList, ClipboardCheck, MessageSquare, Stethoscope,
  Wrench, FileText, Activity, Boxes, BarChart3, ShieldCheck, Lock,
} from 'lucide-react';
import { trackFeature } from '@/lib/session-tracker';

interface ModuleCard {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  /** super_admin only — gets a small lock badge on the card */
  superAdminOnly?: boolean;
}

interface ModuleGroup {
  group: string;
  cards: ModuleCard[];
}

// Domain-grouped catalog. Per PRD §7.1: Patient, Case, OT, PAC, Equipment,
// Forms, Tasks, Chat, Reports. Reports/Admin tagged superAdminOnly so users
// know they need admin to actually use them, but still see they exist.
const MODULES: ModuleGroup[] = [
  {
    group: 'Patient',
    cards: [
      { label: 'Patients', description: 'Browse + search active patients', href: '/?tab=patients', icon: Users },
      { label: 'Drafts', description: 'Resume an in-progress form', href: '/drafts', icon: FileText },
    ],
  },
  {
    group: 'Operating Theatre',
    cards: [
      { label: 'OT Calendar', description: 'Daily OT slot grid + bookings', href: '/ot-calendar', icon: Calendar },
      { label: 'Anaesthetist Queue', description: 'Pending PAC publications', href: '/anaesthetist-queue', icon: Stethoscope },
      { label: 'Equipment Kanban', description: 'Kit + equipment request board', href: '/equipment-kanban', icon: Wrench },
    ],
  },
  {
    group: 'Forms & Tasks',
    cards: [
      { label: 'Forms', description: 'All form types + recent submissions', href: '/?tab=forms', icon: ClipboardList },
      { label: 'Tasks', description: 'Coordinator task queue', href: '/?tab=tasks', icon: ClipboardCheck },
    ],
  },
  {
    group: 'Communications',
    cards: [
      { label: 'Chat', description: 'Per-patient + cross-functional channels', href: '/?tab=chat', icon: MessageSquare },
    ],
  },
  {
    group: 'Reports & Admin',
    cards: [
      { label: 'Admin Dashboard', description: 'Adoption, sessions, analytics', href: '/admin', icon: BarChart3, superAdminOnly: true },
      { label: 'API Performance', description: 'Per-route latency + errors', href: '/admin/api-performance', icon: Activity, superAdminOnly: true },
      { label: 'Audit Log', description: 'Every clinical mutation, 7y retention', href: '/admin/audit-log', icon: ShieldCheck, superAdminOnly: true },
      { label: 'Database Explorer', description: 'Read-only SELECT queries', href: '/admin/database', icon: Boxes, superAdminOnly: true },
    ],
  },
];

export default function AllModulesPage() {
  useEffect(() => {
    trackFeature('glass.all_modules_open');
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 pb-24">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🔓</span>
          <h1 className="text-xl font-semibold text-gray-900">All Modules</h1>
        </div>
        <p className="text-sm text-gray-600">
          Every clinical module in Rounds. Hospital tenancy stays — you only see
          your hospital&apos;s data on each destination. Pages tagged with a lock
          icon need super_admin access to do anything.
        </p>
      </header>

      <div className="space-y-6">
        {MODULES.map(group => (
          <section key={group.group}>
            <h2 className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">
              {group.group}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.cards.map(card => {
                const Icon = card.icon;
                return (
                  <Link
                    key={card.href}
                    href={card.href}
                    className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 hover:border-even-blue hover:shadow-sm transition-all"
                  >
                    <div className="shrink-0 rounded-md bg-gray-50 group-hover:bg-blue-50 p-2 text-gray-600 group-hover:text-even-blue transition-colors">
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900 truncate">{card.label}</span>
                        {card.superAdminOnly && (
                          <Lock size={11} className="text-gray-400" aria-label="Super admin only" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{card.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-8 text-center">
        Glass mode — every authenticated user can access every clinical module.
        Every action is logged to the audit trail (see Audit Log above) for 7 years.
      </p>
    </main>
  );
}
