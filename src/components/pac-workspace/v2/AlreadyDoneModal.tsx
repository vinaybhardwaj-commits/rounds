'use client';

// =============================================================================
// AlreadyDoneModal — capture done_at + done_where + value/notes (PCW2.4b)
//
// Per PRD §8.3:
//   - done_at: required (YYYY-MM-DD)
//   - done_where: 'ehrc' | 'external' (radio; default external)
//   - value/finding: optional but encouraged (string for v1; PCW2.5 will
//     wire structured numeric input + Layer 3 cutoff fire)
//   - notes: optional
//   - Upload report: deferred to v1.x (file upload not in PCW2.4)
// =============================================================================

import { useState } from 'react';
import { X } from 'lucide-react';
import type { SuggestionData } from './SuggestionCard';

interface Props {
  caseId: string;
  suggestion: SuggestionData;
  onClose: () => void;
  onSubmitted: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AlreadyDoneModal({
  caseId,
  suggestion,
  onClose,
  onSubmitted,
}: Props) {
  const [doneAt, setDoneAt] = useState<string>(todayIso());
  const [doneWhere, setDoneWhere] = useState<'ehrc' | 'external'>('external');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClearance = (suggestion.proposed_payload as { kind?: string } | null)?.kind === 'clearance';
  const valueLabel = isClearance ? 'Clearance findings (optional)' : 'Value / finding (optional)';

  const canSubmit = !submitting && /^\d{4}-\d{2}-\d{2}$/.test(doneAt);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const resultValue = value.trim() ? { text: value.trim() } : undefined;
      const res = await fetch(
        `/api/pac-workspace/${caseId}/suggestions/${suggestion.id}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'already_done',
            done_at: doneAt,
            done_where: doneWhere,
            result_value: resultValue,
            notes: notes.trim() || null,
          }),
        }
      );
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
            Mark as already done
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
          <div className="text-xs text-gray-600">
            <span className="font-mono">{suggestion.rule_id}</span>
            {suggestion.reason_text && (
              <div className="mt-0.5 text-gray-500">{suggestion.reason_text}</div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">
              Done on <span className="text-rose-600">*</span>
            </label>
            <input
              type="date"
              value={doneAt}
              onChange={(e) => setDoneAt(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-gray-700">Done where</legend>
            <div className="mt-1 flex gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="done_where"
                  value="ehrc"
                  checked={doneWhere === 'ehrc'}
                  onChange={() => setDoneWhere('ehrc')}
                />
                At EHRC
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="done_where"
                  value="external"
                  checked={doneWhere === 'external'}
                  onChange={() => setDoneWhere('external')}
                />
                External facility
              </label>
            </div>
          </fieldset>

          <div>
            <label className="block text-xs font-medium text-gray-700">
              {valueLabel}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
              placeholder={
                isClearance ? 'e.g. Cleared with conditions: continue ACEi' : 'e.g. 7.2%'
              }
            />
            <p className="mt-0.5 text-[10px] text-gray-500">
              Structured value entry + Layer 3 cutoff flagging lands in PCW2.5.
              For now this is captured as free text on the section row.
            </p>
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
            File upload deferred to v1.x. For now, attach reports via the
            section row (Orders / Clearances) once the action is recorded.
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
            {submitting ? 'Saving…' : 'Mark complete'}
          </button>
        </footer>
      </div>
    </div>
  );
}
