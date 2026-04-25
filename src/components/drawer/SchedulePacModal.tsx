'use client';

// =============================================================================
// Rounds — SchedulePacModal (25 Apr 2026)
//
// IP Coordinator schedules a patient's PAC. The modal captures:
//   - PAC date + time (datetime-local)
//   - Optional anaesthetist (free text or user-id)
//   - Optional notes
// On submit, POSTs /api/cases/:id/transition with:
//   to_state: 'pac_scheduled'
//   extra_metadata: { pac_scheduled_at, pac_anaesthetist, notes }
// The route persists this onto case_state_events.metadata, advances state,
// and auto-closes any pending 'case:initiate_pac' tasks (the auto-task
// created on handoff submit).
//
// Renders as a centered modal. Parent controls mount via isOpen.
// =============================================================================

import { useEffect, useState } from 'react';

export interface SchedulePacModalProps {
  caseId: string;
  patientName: string | null;
  currentState: string;
  isOpen: boolean;
  onClose: () => void;
  onScheduled?: (result: { transition: { from: string; to: string } }) => void;
}

export default function SchedulePacModal({
  caseId,
  patientName,
  currentState,
  isOpen,
  onClose,
  onScheduled,
}: SchedulePacModalProps) {
  const [pacAt, setPacAt] = useState('');
  const [anaesthetist, setAnaesthetist] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form on open.
  useEffect(() => {
    if (!isOpen) return;
    setPacAt('');
    setAnaesthetist('');
    setNotes('');
    setSubmitting(false);
    setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const canSubmit = pacAt.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_state: 'pac_scheduled',
          transition_reason: 'pac_initiated_by_ip_coordinator',
          extra_metadata: {
            pac_scheduled_at: new Date(pacAt).toISOString(),
            pac_anaesthetist: anaesthetist.trim() || null,
            notes: notes.trim() || null,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Transition failed (${res.status})`);
      }
      onScheduled?.({ transition: json.transition });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl bg-white shadow-2xl"
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Schedule PAC</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {patientName ? `${patientName} · ` : ''}case state {currentState} → pac_scheduled
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="pac-at" className="block text-sm font-medium text-gray-800">
              PAC date &amp; time <span className="text-red-500">*</span>
            </label>
            <input
              id="pac-at"
              type="datetime-local"
              value={pacAt}
              onChange={(e) => setPacAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              When the PAC will happen. Patient may not be admitted yet — that's expected.
            </p>
          </div>

          <div>
            <label htmlFor="pac-anaesth" className="block text-sm font-medium text-gray-800">
              Anaesthetist <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="pac-anaesth"
              type="text"
              value={anaesthetist}
              onChange={(e) => setAnaesthetist(e.target.value)}
              placeholder="Name of the anaesthetist coordinating this PAC"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="pac-notes" className="block text-sm font-medium text-gray-800">
              Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="pac-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Labs ordered, departments looped in, anything to flag for the anaesthetist."
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Scheduling…' : 'Schedule PAC'}
          </button>
        </div>
      </div>
    </div>
  );
}
