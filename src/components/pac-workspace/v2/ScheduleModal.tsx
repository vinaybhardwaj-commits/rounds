'use client';

// =============================================================================
// ScheduleModal — PCW2.7b
//
// Reusable scheduling modal for pac_visit / clearance / diagnostic appointments.
// POST /api/pac-workspace/[caseId]/appointments  for create.
// PATCH /api/pac-workspace/[caseId]/appointments/[id]  with action='reschedule'
// for reschedule (uses same modal, prefilled with existing values).
// =============================================================================

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type {
  PacAppointmentRow,
  PacAppointmentParentType,
  PacAppointmentModality,
} from '@/lib/pac-workspace/types';

interface Props {
  caseId: string;
  parent_type: PacAppointmentParentType;
  parent_id?: string | null;
  parent_label: string; // e.g. "HbA1c", "Cardiology clearance", "PAC visit"
  /** When provided: rescheduling existing appointment. Modal pre-fills its fields. */
  existing?: PacAppointmentRow | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const MODALITY_OPTIONS: Array<{ value: PacAppointmentModality; label: string }> = [
  { value: 'in_person_opd', label: 'In-person OPD' },
  { value: 'bedside', label: 'Bedside' },
  { value: 'telephonic', label: 'Telephonic' },
  { value: 'video', label: 'Video' },
  { value: 'walk_in', label: 'Walk-in (lab)' },
  { value: 'paper', label: 'Paper screening' },
];

function isoToLocalDateTime(iso: string | null): string {
  if (!iso) return '';
  // ISO → "YYYY-MM-DDTHH:MM" for <input type="datetime-local">
  return iso.slice(0, 16);
}

export function ScheduleModal({
  caseId,
  parent_type,
  parent_id,
  parent_label,
  existing,
  onClose,
  onSubmitted,
}: Props) {
  const [scheduledAt, setScheduledAt] = useState<string>(
    isoToLocalDateTime(existing?.scheduled_at ?? null)
  );
  const [modality, setModality] = useState<PacAppointmentModality>(
    existing?.modality ?? (parent_type === 'diagnostic' ? 'walk_in' : 'in_person_opd')
  );
  const [providerName, setProviderName] = useState<string>(existing?.provider_name ?? '');
  const [providerSpecialty, setProviderSpecialty] = useState<string>(
    existing?.provider_specialty ?? ''
  );
  const [location, setLocation] = useState<string>(existing?.location ?? '');
  const [notes, setNotes] = useState<string>(existing?.notes ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReschedule = !!existing;

  async function handleSubmit() {
    setError(null);
    if (!scheduledAt) {
      setError('Pick a date and time.');
      return;
    }
    setSubmitting(true);
    const body = {
      ...(isReschedule
        ? { action: 'reschedule' as const }
        : { parent_type, parent_id: parent_id ?? null }),
      scheduled_at: new Date(scheduledAt).toISOString(),
      modality,
      provider_name: providerName.trim() || null,
      provider_specialty: providerSpecialty.trim() || null,
      location: location.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const url = isReschedule
        ? `/api/pac-workspace/${caseId}/appointments/${existing!.id}`
        : `/api/pac-workspace/${caseId}/appointments`;
      const res = await fetch(url, {
        method: isReschedule ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-lg">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">
            {isReschedule ? 'Reschedule' : 'Schedule'} — {parent_label}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Date &amp; time <span className="text-rose-600">*</span>
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Modality</label>
            <select
              value={modality}
              onChange={(e) => setModality(e.target.value as PacAppointmentModality)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            >
              {MODALITY_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700">Provider name</label>
              <input
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                placeholder="Dr. Manukumar"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Specialty</label>
              <input
                type="text"
                value={providerSpecialty}
                onChange={(e) => setProviderSpecialty(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                placeholder="Anaesthesia"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
              placeholder="OPD-2 or ward bedside"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
              placeholder="Optional"
            />
          </div>

          <div className="text-[10px] text-gray-500">
            Specialist availability lookup + patient SMS deferred to v1.x.
            GetStream system message on schedule lands in PCW2.8.
          </div>

          {error && (
            <div className="rounded bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submitting
              ? 'Saving…'
              : isReschedule
                ? 'Reschedule'
                : 'Schedule'}
          </button>
        </footer>
      </div>
    </div>
  );
}
