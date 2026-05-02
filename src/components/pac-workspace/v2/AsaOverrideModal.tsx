'use client';

// =============================================================================
// AsaOverrideModal — PCW2.9
//
// Per PRD §7.4. Coordinator override modal:
//   - ASA grade picker (1, 2, 3, 4, 5)
//   - Reason: free text (REQUIRED)
//   - Submit → PATCH /asa with {grade, reason} → recompute → close + reload
//
// Pre-filled with currentGrade. If suggestedGrade prop is passed (from
// asa_review suggestion's "Review ASA" button), pre-selects that grade.
// =============================================================================

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  caseId: string;
  currentGrade: 1 | 2 | 3 | 4 | 5 | null;
  currentSource: 'inferred' | 'coordinator' | 'anaesthetist' | null;
  /** Optional suggested grade when invoked from asa_review suggestion. */
  suggestedGrade?: 1 | 2 | 3 | 4 | 5;
  onClose: () => void;
  onSubmitted: () => void;
}

const GRADES: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
const GRADE_LABEL: Record<number, string> = {
  1: 'Healthy',
  2: 'Mild systemic disease',
  3: 'Severe systemic disease',
  4: 'Severe + life threat',
  5: 'Moribund',
};

export function AsaOverrideModal({
  caseId,
  currentGrade,
  currentSource,
  suggestedGrade,
  onClose,
  onSubmitted,
}: Props) {
  const [grade, setGrade] = useState<1 | 2 | 3 | 4 | 5>(
    suggestedGrade ?? currentGrade ?? 2
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && reason.trim().length > 0;

  async function handleSubmit() {
    setError(null);
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pac-workspace/${caseId}/asa`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, reason: reason.trim() }),
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
          <h3 className="text-sm font-semibold text-gray-900">Override provisional ASA</h3>
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
          <div className="text-xs text-gray-600">
            Current:{' '}
            <span className="font-mono">
              ASA {currentGrade ?? 'null'}
              {currentSource ? ` · ${currentSource}` : ''}
            </span>
            {suggestedGrade && (
              <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                Engine suggested ASA {suggestedGrade} (Layer 3 result-driven)
              </div>
            )}
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-gray-700">Override to</legend>
            <div className="mt-1 grid grid-cols-5 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className={`flex flex-col items-center justify-center rounded-md border px-2 py-1.5 text-xs ${
                    grade === g
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-bold'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                  title={GRADE_LABEL[g]}
                >
                  <span className="text-base font-bold">{g}</span>
                  <span className="text-[9px] text-gray-500 leading-tight text-center">
                    {GRADE_LABEL[g]}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="block text-xs font-medium text-gray-700">
              Reason <span className="text-rose-600">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
              placeholder="e.g. Patient HbA1c uncertainty, recent hospitalisation"
            />
          </div>

          <div className="text-[10px] text-gray-500">
            This override stays in effect until the anaesthetist publishes
            (PCW2.11). The engine recomputes — Layer 1 baseline orders may
            newly fire (or stop firing) based on the new grade.
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
            disabled={!canSubmit}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submitting ? 'Saving…' : `Override to ASA ${grade}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
