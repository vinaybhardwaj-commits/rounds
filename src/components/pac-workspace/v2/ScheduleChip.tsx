'use client';

// =============================================================================
// ScheduleChip — PCW2.7b
//
// Inline display of a scheduled pac_appointment with reschedule + cancel
// affordances. Renders one of three states:
//   1. No appointment → "Schedule" CTA (parent calls onSchedule)
//   2. Scheduled → "📅 4 May 14:00 · Dr Suresh · OPD" + Reschedule + Cancel
//   3. Completed → "✓ Done 4 May 14:00" (read-only)
// =============================================================================

import { useState } from 'react';
import { Calendar, CalendarCheck2, MoreHorizontal } from 'lucide-react';
import type { PacAppointmentRow } from '@/lib/pac-workspace/types';

interface Props {
  caseId: string;
  appointment: PacAppointmentRow | null;
  canWrite: boolean;
  onSchedule: () => void;
  onReschedule: (a: PacAppointmentRow) => void;
  onChanged: () => void;
}

const MODALITY_LABEL: Record<string, string> = {
  in_person_opd: 'OPD',
  bedside: 'Bedside',
  telephonic: 'Phone',
  video: 'Video',
  paper: 'Paper',
  walk_in: 'Walk-in',
};

function formatScheduled(iso: string | null): string {
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

export function ScheduleChip({
  caseId,
  appointment,
  canWrite,
  onSchedule,
  onReschedule,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!appointment) {
    return (
      <button
        type="button"
        onClick={onSchedule}
        disabled={!canWrite}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Calendar size={12} /> Schedule
      </button>
    );
  }

  const isCompleted = appointment.status === 'completed';
  const summary = formatScheduled(appointment.scheduled_at);
  const provider = appointment.provider_name?.trim();
  const modality = appointment.modality
    ? MODALITY_LABEL[appointment.modality] ?? appointment.modality
    : null;

  async function action(actionType: 'complete' | 'cancel', payload?: Record<string, unknown>) {
    if (!canWrite || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pac-workspace/${caseId}/appointments/${appointment!.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: actionType, ...payload }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <div
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
          isCompleted
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-indigo-200 bg-indigo-50 text-indigo-800'
        }`}
      >
        {isCompleted ? <CalendarCheck2 size={12} /> : <Calendar size={12} />}
        <span className="font-mono">{summary}</span>
        {provider && <span className="text-gray-700">· {provider}</span>}
        {modality && <span className="text-gray-500">· {modality}</span>}
        {isCompleted && (
          <span className="ml-1 inline-flex items-center rounded bg-emerald-200/60 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800">
            Done
          </span>
        )}
      </div>
      {!isCompleted && canWrite && (
        <div className="flex items-center gap-2 text-[10px]">
          <button
            type="button"
            onClick={() => onReschedule(appointment)}
            disabled={busy}
            className="text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            Reschedule
          </button>
          <span className="text-gray-300">·</span>
          <button
            type="button"
            onClick={() => action('complete')}
            disabled={busy}
            className="text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
          >
            Mark done
          </button>
          <span className="text-gray-300">·</span>
          <button
            type="button"
            onClick={() => {
              const reason = window.prompt('Cancel reason (optional):') ?? '';
              action('cancel', { cancelled_reason: reason || null });
            }}
            disabled={busy}
            className="text-rose-600 hover:text-rose-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <div className="text-[10px] text-rose-700">{error}</div>
      )}
    </div>
  );
}
