'use client';

// =============================================================================
// DeadlineStrip — PCW2.8
//
// Top-of-workspace status bar showing OT date / PAC visit / clearance
// deadlines with green/amber/red status. Mounted by PACWorkspaceView when
// v2 flag is on, between the patient pin and the Smart Suggestions inbox.
//
// Per PRD §15.3:
//   "Deadline strip shows OT (5 May 09:30), PAC visit by 4 May 21:00 (green),
//   clearance by 4 May 09:30 (amber if not yet scheduled, green after)."
// =============================================================================

import { Clock } from 'lucide-react';
import type {
  PacAppointmentRow,
  PacClearanceRow,
} from '@/lib/pac-workspace/types';
import {
  computeDeadlines,
  formatDeadline,
  type DeadlineEntry,
  type DeadlineStatus,
} from '@/lib/pac-workspace/deadlines';

interface Props {
  otDate: string | null;
  appointments: PacAppointmentRow[];
  clearances: PacClearanceRow[];
}

const STATUS_TEXT: Record<DeadlineStatus, string> = {
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-rose-700',
  na: 'text-gray-500',
};

const STATUS_BG: Record<DeadlineStatus, string> = {
  green: 'bg-emerald-50 border-emerald-200',
  amber: 'bg-amber-50 border-amber-200',
  red: 'bg-rose-50 border-rose-200',
  na: 'bg-gray-50 border-gray-200',
};

const STATUS_DOT: Record<DeadlineStatus, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  na: 'bg-gray-300',
};

function EntryCell({ entry }: { entry: DeadlineEntry }) {
  return (
    <div className={`flex-1 min-w-0 rounded-md border ${STATUS_BG[entry.status]} px-2.5 py-1.5`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[entry.status]}`} aria-hidden />
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-600">
          {entry.label}
        </span>
      </div>
      <div className={`mt-0.5 text-xs font-mono ${STATUS_TEXT[entry.status]}`}>
        {entry.scheduledAt
          ? formatDeadline(entry.scheduledAt)
          : entry.deadlineAt
            ? `by ${formatDeadline(entry.deadlineAt)}`
            : 'TBD'}
      </div>
      {entry.note && (
        <div className="text-[10px] text-gray-500 mt-0.5">{entry.note}</div>
      )}
    </div>
  );
}

export function DeadlineStrip({ otDate, appointments, clearances }: Props) {
  const summary = computeDeadlines({ otDate, appointments, clearances });

  // No surgery planned + no clearances → don't render the strip at all.
  if (
    summary.ot.status === 'na' &&
    summary.clearances.length === 0
  ) {
    return null;
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
      <header className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-700">
        <Clock size={13} className="text-gray-500" />
        Deadlines
        <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-medium ${STATUS_TEXT[summary.worstStatus]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[summary.worstStatus]}`} aria-hidden />
          {summary.worstStatus === 'green' && 'On track'}
          {summary.worstStatus === 'amber' && 'Watch'}
          {summary.worstStatus === 'red' && 'At risk'}
          {summary.worstStatus === 'na' && 'No date'}
        </span>
      </header>
      <div className="flex flex-wrap gap-2">
        <EntryCell entry={summary.ot} />
        <EntryCell entry={summary.pacVisit} />
        {summary.clearances.map((c) => (
          <EntryCell key={c.clearanceId} entry={c} />
        ))}
      </div>
    </section>
  );
}
