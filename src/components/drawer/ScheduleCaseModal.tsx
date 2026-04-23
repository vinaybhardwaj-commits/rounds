'use client';

// ============================================
// Rounds — ScheduleCaseModal (Sprint 2 Day 8.B)
//
// Modal that POSTs to /api/cases/:id/schedule. Opened from the Week-Ahead
// OT Calendar when the user clicks an empty cell or an unscheduled case.
//
// Required fields: planned_surgery_date + ot_room (pre-filled from the cell
// clicked). Optional: surgeon_id, anaesthetist_id, kit checkboxes.
//
// Kits are fetched from /api/equipment-kits?hospital_slug=X so Rajeshwari
// only sees kits from the case's hospital.
// ============================================

import { useEffect, useState } from 'react';

interface Kit {
  id: string;
  code: string;
  label: string;
  description: string | null;
}

export interface ScheduleCaseModalProps {
  caseId: string;
  patientName: string | null;
  hospitalSlug: string;
  currentState: string;
  prefill?: { date?: string; ot_room?: number };
  isOpen: boolean;
  onClose: () => void;
  onScheduled?: (result: {
    transition: { from: string; to: string };
    scheduled: { planned_surgery_date: string; ot_room: number };
    kits_attached: { id: string; code: string; label: string }[];
  }) => void;
}

export default function ScheduleCaseModal({
  caseId,
  patientName,
  hospitalSlug,
  currentState,
  prefill,
  isOpen,
  onClose,
  onScheduled,
}: ScheduleCaseModalProps) {
  const [date, setDate] = useState('');
  const [otRoom, setOtRoom] = useState<number>(1);
  const [surgeonId, setSurgeonId] = useState('');
  const [anaesthetistId, setAnaesthetistId] = useState('');
  const [kits, setKits] = useState<Kit[]>([]);
  const [kitsLoading, setKitsLoading] = useState(false);
  const [checkedKits, setCheckedKits] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDate(prefill?.date ?? '');
    setOtRoom(prefill?.ot_room ?? 1);
    setSurgeonId('');
    setAnaesthetistId('');
    setCheckedKits(new Set());
    setSubmitError(null);
  }, [isOpen, prefill?.date, prefill?.ot_room, caseId]);

  useEffect(() => {
    if (!isOpen) return;
    setKitsLoading(true);
    fetch(`/api/equipment-kits?hospital_slug=${encodeURIComponent(hospitalSlug)}`)
      .then((r) => r.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data)) {
          setKits(body.data);
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setKitsLoading(false));
  }, [isOpen, hospitalSlug]);

  if (!isOpen) return null;

  const toggleKit = (id: string) => {
    setCheckedKits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!date || !otRoom) {
      setSubmitError('Date and OT room are required');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: Record<string, unknown> = {
        planned_surgery_date: date,
        ot_room: otRoom,
      };
      if (surgeonId.trim()) payload.surgeon_id = surgeonId.trim();
      if (anaesthetistId.trim()) payload.anaesthetist_id = anaesthetistId.trim();
      if (checkedKits.size > 0) payload.attach_kit_ids = [...checkedKits];

      const res = await fetch(`/api/cases/${caseId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error || `HTTP ${res.status}`);
      onScheduled?.(body.data);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="border-b border-gray-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Schedule case</h2>
              <p className="mt-0.5 text-xs text-gray-600">
                {patientName || '(no patient name)'} · {hospitalSlug.toUpperCase()} ·
                current: <code>{currentState}</code>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">OT room *</label>
              <select
                value={otRoom}
                onChange={(e) => setOtRoom(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={1}>OT-1</option>
                <option value={2}>OT-2</option>
                <option value={3}>OT-3</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Surgeon (profile UUID)</label>
            <input
              type="text"
              value={surgeonId}
              onChange={(e) => setSurgeonId(e.target.value)}
              placeholder="optional"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Anaesthetist (profile UUID)</label>
            <input
              type="text"
              value={anaesthetistId}
              onChange={(e) => setAnaesthetistId(e.target.value)}
              placeholder="optional"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Attach equipment kits</label>
            {kitsLoading ? (
              <p className="mt-1 text-xs text-gray-500">Loading kits…</p>
            ) : kits.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500">No active kits for {hospitalSlug.toUpperCase()}.</p>
            ) : (
              <div className="mt-1 space-y-1 rounded-md border border-gray-200 bg-gray-50 p-2 max-h-40 overflow-y-auto">
                {kits.map((k) => (
                  <label
                    key={k.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={checkedKits.has(k.id)}
                      onChange={() => toggleKit(k.id)}
                      className="mt-0.5"
                    />
                    <span className="flex-1">
                      <span className="font-medium text-gray-900">{k.label}</span>
                      <span className="ml-1 font-mono text-xs text-gray-500">{k.code}</span>
                      {k.description && (
                        <span className="block text-xs text-gray-500">{k.description}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {submitError}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !date}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Scheduling…' : currentState === 'scheduled' ? 'Reschedule' : 'Schedule'}
          </button>
        </footer>
      </div>
    </div>
  );
}
