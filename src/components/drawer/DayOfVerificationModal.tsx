'use client';

// ============================================
// Rounds — DayOfVerificationModal (Sprint 3 Day 11)
//
// Per PRD §7.9: the RMO's day-of verification — structured checklist of
// pre-op items + free-text issues, transitions the case to state ⑨ (verified).
//
// Default checklist is intentionally short for Sprint 3; Sprint 4 can
// externalize into a template per hospital/procedure type. The modal collects
// whatever the caller provides and lets the server treat it as an opaque
// JSONB record.
// ============================================

import { useState, useEffect } from 'react';

export interface DayOfVerificationModalProps {
  caseId: string;
  patientName: string | null;
  caseCode: string | null;
  plannedProcedure: string | null;
  currentState: string;
  isOpen: boolean;
  onClose: () => void;
  onVerified?: (result: {
    verification_id: string;
    verified_at: string;
    transition: { from: string; to: string };
  }) => void;
}

// Default checklist from PRD §7.9 intent — can be overridden per hospital later.
const DEFAULT_CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'patient_identity_confirmed', label: 'Patient identity confirmed (wristband + verbal)' },
  { key: 'consent_signed', label: 'Consent form signed and filed' },
  { key: 'site_marked', label: 'Surgical site marked' },
  { key: 'fasting_status', label: 'NPO status confirmed' },
  { key: 'allergies_reviewed', label: 'Allergies reviewed' },
  { key: 'preop_labs_seen', label: 'Pre-op labs available and reviewed' },
  { key: 'cross_match_available', label: 'Cross-match / blood arrangement (if indicated)' },
  { key: 'implants_ready', label: 'Implants / special equipment ready (if indicated)' },
  { key: 'anaesthesia_plan_confirmed', label: 'Anaesthesia plan confirmed with anaesthetist' },
];

export default function DayOfVerificationModal({
  caseId,
  patientName,
  caseCode,
  plannedProcedure,
  currentState,
  isOpen,
  onClose,
  onVerified,
}: DayOfVerificationModalProps) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [issues, setIssues] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Reset on open
    const init: Record<string, boolean> = {};
    for (const it of DEFAULT_CHECKLIST_ITEMS) init[it.key] = false;
    setChecklist(init);
    setIssues('');
    setError(null);
  }, [isOpen, caseId]);

  if (!isOpen) return null;

  const checkedCount = Object.values(checklist).filter(Boolean).length;
  const total = DEFAULT_CHECKLIST_ITEMS.length;
  const allChecked = checkedCount === total;

  const toggle = (key: string) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checklist,
          issues_flagged: issues.trim() ? issues.trim() : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error || `HTTP ${res.status}`);
      onVerified?.({
        verification_id: body.data.verification.id,
        verified_at: body.data.verification.verified_at,
        transition: body.data.transition,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="border-b border-gray-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Day-of verification</h2>
              <p className="mt-0.5 text-xs text-gray-600">
                {patientName || '(no patient name)'} · {caseCode || ''} · current: <code>{currentState}</code>
              </p>
              {plannedProcedure && (
                <p className="mt-0.5 text-xs text-gray-500 truncate">{plannedProcedure}</p>
              )}
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center justify-between text-xs text-gray-600">
            <span>Checklist ({checkedCount}/{total} complete)</span>
            {allChecked ? (
              <span className="font-medium text-emerald-700">All items confirmed</span>
            ) : (
              <span className="font-medium text-amber-700">Partial — unchecked items will be recorded as false</span>
            )}
          </div>
          <ul className="space-y-1 rounded-md border border-gray-200 bg-gray-50 p-2">
            {DEFAULT_CHECKLIST_ITEMS.map((it) => (
              <li key={it.key}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-white">
                  <input
                    type="checkbox"
                    checked={!!checklist[it.key]}
                    onChange={() => toggle(it.key)}
                    className="mt-0.5"
                  />
                  <span className="flex-1 text-gray-900">{it.label}</span>
                </label>
              </li>
            ))}
          </ul>

          <section className="mt-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Issues flagged <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <textarea
              value={issues}
              onChange={(e) => setIssues(e.target.value)}
              rows={3}
              placeholder="Anything the OT team should know — missing docs, new findings, family concerns"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </section>

          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <span className="text-xs text-gray-500">
            {allChecked ? '' : 'You can still verify with unchecked items; they\'ll be recorded as not-done.'}
          </span>
          <div className="flex gap-2">
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
              disabled={submitting}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Verifying…' : 'Confirm verification'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
