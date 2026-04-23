'use client';

// ============================================
// Rounds — PacPublishModal (Sprint 2 Day 7.B)
//
// The anaesthetist's PAC publish UI. Per PRD §7.5 Model 1:
//   - 2-tap Fit: click Fit → confirm → POSTed. Fast path.
//   - 30-60s Fit-conds / Defer: click → multi-select conditions from library
//     (with ad-hoc custom label option) → notes → submit.
//   - Unfit: click → notes required → submit.
//
// Calls POST /api/cases/:id/pac/publish-outcome. Server enforces role (D7) +
// state-from guards + D8 library XOR custom purity. Client just has to send
// well-formed payloads.
//
// Renders as a centered modal overlay. Parent controls mount via `isOpen`.
// ============================================

import { useEffect, useState } from 'react';

type Outcome = 'fit' | 'fit_conds' | 'defer' | 'unfit';

interface LibraryItem {
  id: string;
  code: string;
  label: string;
  description: string | null;
  default_owner_role: string | null;
  sort_order: number;
}

export interface PacPublishModalProps {
  caseId: string;
  patientName: string | null;
  currentState: string;
  isOpen: boolean;
  onClose: () => void;
  onPublished?: (result: {
    transition: { from: string; to: string };
    pac_event_id: string | null;
    condition_cards_created: string[];
  }) => void;
}

export default function PacPublishModal({
  caseId,
  patientName,
  currentState,
  isOpen,
  onClose,
  onPublished,
}: PacPublishModalProps) {
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checkedCodes, setCheckedCodes] = useState<Set<string>>(new Set());
  const [customLabel, setCustomLabel] = useState('');
  const [customList, setCustomList] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [kxPacRecordId, setKxPacRecordId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset state whenever the modal opens fresh.
  useEffect(() => {
    if (isOpen) {
      setOutcome(null);
      setCheckedCodes(new Set());
      setCustomLabel('');
      setCustomList([]);
      setNotes('');
      setKxPacRecordId('');
      setSubmitError(null);
    }
  }, [isOpen, caseId]);

  // Load the condition library the first time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    if (library.length > 0) return;
    setLibraryLoading(true);
    setLibraryError(null);
    fetch('/api/pac-conditions')
      .then((r) => r.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data)) {
          setLibrary(body.data);
        } else {
          setLibraryError(body?.error || 'Failed to load condition library');
        }
      })
      .catch((e) => setLibraryError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLibraryLoading(false));
  }, [isOpen, library.length]);

  if (!isOpen) return null;

  const toggleCode = (code: string) => {
    setCheckedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const addCustom = () => {
    const v = customLabel.trim();
    if (v && v.length <= 200 && !customList.includes(v)) {
      setCustomList((prev) => [...prev, v]);
      setCustomLabel('');
    }
  };
  const removeCustom = (v: string) => {
    setCustomList((prev) => prev.filter((x) => x !== v));
  };

  const requiresConditions = outcome === 'fit_conds' || outcome === 'defer';
  const hasAnyCondition = checkedCodes.size > 0 || customList.length > 0;
  const canSubmit =
    outcome !== null &&
    !submitting &&
    (!requiresConditions || hasAnyCondition);

  const submit = async () => {
    if (!outcome) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: Record<string, unknown> = { outcome };
      if (outcome === 'fit_conds' || outcome === 'defer') {
        if (checkedCodes.size > 0) payload.condition_ids = [...checkedCodes];
        if (customList.length > 0) {
          payload.custom_conditions = customList.map((label) => ({ label }));
        }
      }
      if (notes.trim().length > 0) payload.notes = notes.trim();
      if (kxPacRecordId.trim().length > 0) payload.kx_pac_record_id = kxPacRecordId.trim();

      const res = await fetch(`/api/cases/${caseId}/pac/publish-outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      onPublished?.({
        transition: body.data.transition,
        pac_event_id: body.data.pac_event?.id ?? null,
        condition_cards_created: body.data.condition_cards_created ?? [],
      });
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
      aria-labelledby="pac-publish-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="border-b border-gray-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="pac-publish-title" className="text-lg font-semibold text-gray-900">
                Publish PAC outcome
              </h2>
              <p className="mt-0.5 text-xs text-gray-600">
                {patientName || '(no patient name)'} · current state: {currentState}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Outcome picker */}
          <div className="grid grid-cols-2 gap-2">
            {(['fit', 'fit_conds', 'defer', 'unfit'] as const).map((o) => {
              const selected = outcome === o;
              const color =
                o === 'fit' ? 'emerald' :
                o === 'fit_conds' ? 'amber' :
                o === 'defer' ? 'orange' : 'rose';
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(o)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    selected
                      ? `border-${color}-500 bg-${color}-50 text-${color}-900`
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {o === 'fit' && 'Fit'}
                  {o === 'fit_conds' && 'Fit (with conditions)'}
                  {o === 'defer' && 'Defer'}
                  {o === 'unfit' && 'Unfit'}
                </button>
              );
            })}
          </div>

          {/* Conditions section — only for fit_conds / defer */}
          {requiresConditions && (
            <section className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                Conditions
              </h3>
              {libraryLoading && <p className="text-xs text-gray-500">Loading library…</p>}
              {libraryError && (
                <p className="text-xs text-red-700">Library error: {libraryError}</p>
              )}
              {!libraryLoading && !libraryError && (
                <div className="space-y-1 rounded-md border border-gray-200 bg-gray-50 p-2 max-h-56 overflow-y-auto">
                  {library.map((it) => (
                    <label
                      key={it.code}
                      className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        checked={checkedCodes.has(it.code)}
                        onChange={() => toggleCode(it.code)}
                        className="mt-0.5"
                      />
                      <span className="flex-1">
                        <span className="font-medium text-gray-900">{it.label}</span>
                        {it.description && (
                          <span className="block text-xs text-gray-500">{it.description}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {/* Custom condition entry */}
              <div className="mt-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                    placeholder="Add custom condition not in library"
                    className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={addCustom}
                    disabled={!customLabel.trim()}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {customList.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {customList.map((v) => (
                      <li
                        key={v}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800"
                      >
                        {v}
                        <button
                          type="button"
                          onClick={() => removeCustom(v)}
                          className="text-blue-600 hover:text-blue-900"
                          aria-label={`Remove ${v}`}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* Notes */}
          {outcome && (
            <section className="mt-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
                Notes {outcome === 'unfit' && <span className="text-red-600">(strongly recommended)</span>}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={outcome === 'fit' ? 2 : 3}
                placeholder={
                  outcome === 'fit'
                    ? 'Optional: any observations for the OT team'
                    : 'Why this outcome; what the patient needs to work on'
                }
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </section>
          )}

          {/* KE PAC record pointer (optional) */}
          {outcome && (
            <section className="mt-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
                KE PAC record id <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                type="text"
                value={kxPacRecordId}
                onChange={(e) => setKxPacRecordId(e.target.value)}
                placeholder="Opaque pointer to KE's PAC record"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </section>
          )}

          {submitError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
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
            disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Publishing…' : outcome ? `Publish ${outcome}` : 'Publish'}
          </button>
        </footer>
      </div>
    </div>
  );
}
