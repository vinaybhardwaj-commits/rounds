'use client';

// =============================================================================
// OTBookingModal (26 Apr 2026 — V's OT calendar redesign)
//
// Full booking card. Driven by 13 fields (the columns from V's existing OT
// schedule Excel sheet, plus OT# + date + serial# pickers and a patient
// banner). On save, posts to /api/cases/[id]/ot-booking which:
//   - sets all the booking fields on surgical_cases
//   - transitions case state → 'scheduled' if currently in a schedulable-from set
//   - auto-advances patient stage to pre_op when applicable
//
// Two modes:
//   - 'create'  — creating a fresh booking for a patient picked from the list
//                 (case_id required; the calling page POSTs to /api/cases first
//                 if needed, then opens this modal with the resulting caseId)
//   - 'edit'    — re-opening a calendar-cell booking; preFilled prop carries
//                 the existing values
//
// Field vocabulary lifted from the Excel:
//   anae_type           : Block | GA | LA | SA | Other
//   equipment_status    : Ready | CSSD | Outside | Other
//   consumables_status  : Ready | Sourcing | Other
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';

const ANAE_OPTIONS = ['GA', 'SA', 'LA', 'Block', 'Other'] as const;
const EQUIP_OPTIONS = ['Ready', 'CSSD', 'Outside', 'Other'] as const;
const CONS_OPTIONS = ['Ready', 'Sourcing', 'Other'] as const;

export interface BookingValues {
  planned_surgery_date?: string;
  ot_room?: number;
  case_serial_in_slot?: number;
  planned_start_time?: string;
  planned_procedure?: string;
  surgeon_name?: string;
  assist_surgeon_name?: string;
  anaesthetist_name?: string;
  anae_type?: string;
  equipment_status?: string;
  consumables_status?: string;
  ot_remarks?: string;
}

export interface OTBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Case row to update. If creating fresh, the caller creates the case first. */
  caseId: string;
  /** For the patient banner. */
  patientName: string | null;
  hospitalSlug: string | null;
  patientStage: string | null;
  pacStatus: string | null;
  /** Pre-filled defaults. Used in both create + edit modes. */
  preFilled: BookingValues;
  /** Available OT rooms (1..N). */
  otRoomCount?: number;
  /** Existing serial# in the current slot — used to suggest 'next' on serial select. */
  existingSerialsInSlot?: number[];
  /** Mode label (just for chrome). */
  mode?: 'create' | 'edit';
  /** Called after a successful save. */
  onSaved?: () => void;
}

export default function OTBookingModal({
  isOpen, onClose, caseId, patientName, hospitalSlug, patientStage, pacStatus,
  preFilled, otRoomCount = 3, existingSerialsInSlot = [], mode = 'create', onSaved,
}: OTBookingModalProps) {
  const [v, setV] = useState<BookingValues>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state on open.
  useEffect(() => {
    if (!isOpen) return;
    setV({ ...preFilled });
    setError(null);
  }, [isOpen, preFilled]);

  // Suggested next serial in the chosen slot (max existing + 1, or 1 if empty).
  const suggestedSerial = useMemo(() => {
    if (existingSerialsInSlot.length === 0) return 1;
    return Math.max(...existingSerialsInSlot) + 1;
  }, [existingSerialsInSlot]);

  const serialOptions = useMemo(() => {
    const opts = new Set<number>([1, 2, 3, 4, 5]);
    existingSerialsInSlot.forEach((s) => opts.add(s));
    opts.add(suggestedSerial);
    return [...opts].sort((a, b) => a - b);
  }, [existingSerialsInSlot, suggestedSerial]);

  const set = <K extends keyof BookingValues>(k: K, val: BookingValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    // Slot triplet required.
    if (!v.planned_surgery_date) return false;
    if (!v.ot_room) return false;
    if (!v.case_serial_in_slot) return false;
    return true;
  }, [submitting, v]);

  const save = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/ot-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const headerLabel = mode === 'edit' ? 'Edit OT booking' : 'Book OT slot';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{headerLabel}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {patientName || 'Patient'}{hospitalSlug ? ` · ${hospitalSlug.toUpperCase()}` : ''}
              {patientStage ? ` · ${patientStage.replace(/_/g, ' ')}` : ''}
              {pacStatus && pacStatus !== 'no_case' ? ` · ${pacStatus.replace(/_/g, ' ')}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Slot triplet — date / OT / serial */}
          <section>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Slot</label>
            <div className="mt-1 grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-gray-500">Date</label>
                <input
                  type="date"
                  value={v.planned_surgery_date || ''}
                  onChange={(e) => set('planned_surgery_date', e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500">OT #</label>
                <select
                  value={v.ot_room || ''}
                  onChange={(e) => set('ot_room', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— Select OT —</option>
                  {Array.from({ length: otRoomCount }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>OT-{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500">Serial in slot</label>
                <select
                  value={v.case_serial_in_slot || ''}
                  onChange={(e) => set('case_serial_in_slot', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— Pick —</option>
                  {serialOptions.map((s) => {
                    const taken = existingSerialsInSlot.includes(s) && s !== preFilled.case_serial_in_slot;
                    return (
                      <option key={s} value={s} disabled={taken}>
                        {ordinal(s)}{taken ? ' (taken)' : s === suggestedSerial ? ' · suggested' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          </section>

          {/* Start time + procedure */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Start time</label>
              <input
                type="time"
                value={v.planned_start_time || ''}
                onChange={(e) => set('planned_start_time', e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Procedure (full name)</label>
              <input
                type="text"
                value={v.planned_procedure || ''}
                onChange={(e) => set('planned_procedure', e.target.value)}
                placeholder="e.g. Right total knee replacement"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* People */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Surgeon</label>
              <input
                type="text"
                value={v.surgeon_name || ''}
                onChange={(e) => set('surgeon_name', e.target.value)}
                placeholder="Lead surgeon"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Assist surgeon</label>
              <input
                type="text"
                value={v.assist_surgeon_name || ''}
                onChange={(e) => set('assist_surgeon_name', e.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Anaesthesia type</label>
              <select
                value={v.anae_type || ''}
                onChange={(e) => set('anae_type', e.target.value || undefined)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select —</option>
                {ANAE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Anaesthetist</label>
              <input
                type="text"
                value={v.anaesthetist_name || ''}
                onChange={(e) => set('anaesthetist_name', e.target.value)}
                placeholder="e.g. Dr Manu &amp; Team"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* Equipment + Consumables */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Equipment (CSSD)</label>
              <select
                value={v.equipment_status || ''}
                onChange={(e) => set('equipment_status', e.target.value || undefined)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select —</option>
                {EQUIP_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Consumables</label>
              <select
                value={v.consumables_status || ''}
                onChange={(e) => set('consumables_status', e.target.value || undefined)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select —</option>
                {CONS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </section>

          {/* Remarks */}
          <section>
            <label className="block text-[11px] font-semibold uppercase text-gray-600">Remarks</label>
            <textarea
              value={v.ot_remarks || ''}
              onChange={(e) => set('ot_remarks', e.target.value)}
              rows={2}
              placeholder="Any notes for the OT team"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </section>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> {submitting ? 'Saving…' : (mode === 'edit' ? 'Save changes' : 'Save booking')}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}
