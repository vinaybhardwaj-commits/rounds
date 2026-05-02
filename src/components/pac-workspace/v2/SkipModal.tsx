'use client';

// =============================================================================
// SkipModal — structured skip-reason modal (PCW2.4b)
//
// Per PRD §8.3:
//   REQUIRED severity → reason code mandatory; "Other" requires notes too.
//   RECOMMENDED      → code optional, free-text optional.
//   INFO             → never reached (button hidden in card).
// =============================================================================

import { useState } from 'react';
import { X } from 'lucide-react';
import type { SuggestionData } from './SuggestionCard';

const REASON_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'skip.already_external', label: 'Already done at external facility (report attached)' },
  { code: 'skip.not_clinically_applicable', label: 'Not clinically applicable to this case' },
  { code: 'skip.anaesthetist_direct_assess', label: 'Anaesthetist will assess directly without prior workup' },
  { code: 'skip.patient_declined', label: 'Patient declined / cannot be done' },
  { code: 'skip.other', label: 'Other (specify below)' },
];

interface Props {
  caseId: string;
  suggestion: SuggestionData;
  onClose: () => void;
  onSubmitted: () => void;
}

export function SkipModal({ caseId, suggestion, onClose, onSubmitted }: Props) {
  const [code, setCode] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRequired = suggestion.severity === 'required';
  const otherSelected = code === 'skip.other';

  const canSubmit =
    !submitting &&
    (!isRequired || code !== '') &&
    (!otherSelected || notes.trim().length > 0);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/pac-workspace/${caseId}/suggestions/${suggestion.id}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'skip',
            decision_reason_code: code || null,
            decision_reason_notes: notes.trim() || null,
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
            Skip {isRequired && <span className="text-rose-600">(REQUIRED)</span>}
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
            Skipping <span className="font-mono">{suggestion.rule_id}</span>.
            {isRequired && ' Reason is required for REQUIRED suggestions.'}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-gray-700">
              Why are you skipping this?
            </legend>
            {REASON_OPTIONS.map((opt) => (
              <label
                key={opt.code}
                className="flex items-start gap-2 cursor-pointer rounded p-1.5 hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="reason"
                  value={opt.code}
                  checked={code === opt.code}
                  onChange={() => setCode(opt.code)}
                  className="mt-0.5"
                />
                <span className="text-xs text-gray-700">{opt.label}</span>
              </label>
            ))}
          </fieldset>

          <div>
            <label className="block text-xs font-medium text-gray-700">
              Notes {otherSelected && <span className="text-rose-600">(required)</span>}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
              placeholder={
                otherSelected
                  ? 'Specify the reason'
                  : 'Optional context / explanation'
              }
            />
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
            className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submitting ? 'Skipping…' : 'Skip with reason'}
          </button>
        </footer>
      </div>
    </div>
  );
}
