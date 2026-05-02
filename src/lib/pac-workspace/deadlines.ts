// =============================================================================
// PAC Workspace v2 — Deadline computation (PCW2.8)
//
// Pure functions deriving deadline status for OT date, PAC visit, and
// clearances. No DB IO. Used by DeadlineStrip component.
//
// Status derivation:
//   green  — scheduled, on or before its deadline
//   amber  — not scheduled yet, deadline > 24h away (still time)
//   red    — not scheduled and < 24h away, OR scheduled past deadline
//   na     — surgery not planned yet (OT date null)
//
// Deadlines are conservative defaults; v1.x can promote to per-hospital config:
//   PAC visit deadline    = OT - 24h
//   Clearance deadline    = PAC visit - 12h (if PAC scheduled) else OT - 36h
// =============================================================================

import type {
  PacAppointmentRow,
  PacClearanceRow,
} from './types';

export type DeadlineStatus = 'green' | 'amber' | 'red' | 'na';

export interface DeadlineEntry {
  label: string;
  deadlineAt: string | null; // ISO; null when undeterminable
  scheduledAt: string | null;
  status: DeadlineStatus;
  note?: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function pickLatestActiveAppt(
  appts: PacAppointmentRow[],
  parentType: 'pac_visit' | 'clearance' | 'diagnostic',
  parentId: string | null
): PacAppointmentRow | null {
  const matching = appts.filter(
    (a) =>
      a.parent_type === parentType &&
      a.parent_id === parentId &&
      a.status !== 'cancelled' &&
      a.status !== 'rescheduled'
  );
  if (matching.length === 0) return null;
  return matching.reduce((best, a) =>
    (a.scheduled_at ?? '') > (best.scheduled_at ?? '') ? a : best
  );
}

function statusFromTimes(
  scheduled: Date | null,
  deadline: Date | null,
  now: Date
): DeadlineStatus {
  if (!deadline) return 'na';
  if (scheduled) {
    return scheduled.getTime() <= deadline.getTime() ? 'green' : 'red';
  }
  // Not scheduled.
  const hoursAway = (deadline.getTime() - now.getTime()) / ONE_HOUR_MS;
  if (hoursAway < 24) return 'red';
  return 'amber';
}

export interface ComputeDeadlinesArgs {
  otDate: string | null;
  appointments: PacAppointmentRow[];
  clearances: PacClearanceRow[];
  /** Optional override for "now" — defaults to wall-clock. */
  now?: Date;
}

export interface DeadlineSummary {
  ot: DeadlineEntry;
  pacVisit: DeadlineEntry;
  clearances: Array<DeadlineEntry & { clearanceId: string; specialty: string }>;
  /** Worst per-row status across the whole workspace. */
  worstStatus: DeadlineStatus;
}

export function computeDeadlines(args: ComputeDeadlinesArgs): DeadlineSummary {
  const now = args.now ?? new Date();
  const ot = parseDate(args.otDate);

  // OT entry — always rendered, status reflects whether the OT date itself
  // has passed. (We don't have a separate "OT scheduled" appointment; the
  // surgical_cases.planned_surgery_date IS the OT date.)
  const otEntry: DeadlineEntry = {
    label: 'OT',
    deadlineAt: args.otDate,
    scheduledAt: args.otDate,
    status: ot ? (ot.getTime() < now.getTime() ? 'red' : 'green') : 'na',
    note: ot ? undefined : 'Surgery not yet planned',
  };

  // PAC visit deadline = OT - 24h.
  const pacVisitDeadline = ot ? new Date(ot.getTime() - 24 * ONE_HOUR_MS) : null;
  const pacVisitAppt = pickLatestActiveAppt(args.appointments, 'pac_visit', null);
  const pacVisitScheduled = parseDate(pacVisitAppt?.scheduled_at ?? null);
  const pacVisitEntry: DeadlineEntry = {
    label: 'PAC visit',
    deadlineAt: pacVisitDeadline ? pacVisitDeadline.toISOString() : null,
    scheduledAt: pacVisitScheduled ? pacVisitScheduled.toISOString() : null,
    status: statusFromTimes(pacVisitScheduled, pacVisitDeadline, now),
  };

  // Clearance deadlines — for each clearance still in flight, target =
  // PAC visit (if scheduled) - 12h; else OT - 36h.
  const clearanceTarget = pacVisitScheduled
    ? new Date(pacVisitScheduled.getTime() - 12 * ONE_HOUR_MS)
    : ot
      ? new Date(ot.getTime() - 36 * ONE_HOUR_MS)
      : null;

  const liveClearances = args.clearances.filter(
    (c) => c.status !== 'cancelled' && c.status !== 'declined'
  );
  const clearanceEntries = liveClearances.map((c) => {
    const appt = pickLatestActiveAppt(args.appointments, 'clearance', c.id);
    const scheduled = parseDate(appt?.scheduled_at ?? null);
    const isCleared =
      c.status === 'cleared' || c.status === 'cleared_with_conditions';
    let status: DeadlineStatus;
    if (isCleared) {
      status = 'green';
    } else {
      status = statusFromTimes(scheduled, clearanceTarget, now);
    }
    return {
      clearanceId: c.id,
      specialty: c.specialty,
      label: c.specialty_label ?? c.specialty,
      deadlineAt: clearanceTarget ? clearanceTarget.toISOString() : null,
      scheduledAt: scheduled ? scheduled.toISOString() : null,
      status,
      note: isCleared ? 'Cleared' : undefined,
    };
  });

  // Worst status — red beats amber beats green beats na.
  const order: Record<DeadlineStatus, number> = {
    red: 3,
    amber: 2,
    green: 1,
    na: 0,
  };
  const all = [otEntry, pacVisitEntry, ...clearanceEntries];
  let worst: DeadlineStatus = 'na';
  for (const e of all) {
    if (order[e.status] > order[worst]) worst = e.status;
  }

  return {
    ot: otEntry,
    pacVisit: pacVisitEntry,
    clearances: clearanceEntries,
    worstStatus: worst,
  };
}

/** Format a deadline for short inline display: 'May 4 14:00'. */
export function formatDeadline(iso: string | null): string {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}
