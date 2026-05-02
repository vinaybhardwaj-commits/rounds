'use client';

// =============================================================================
// ResultEntryModal — PCW2.5
//
// Type-aware result-entry modal driven by the result-mapping registry.
// Renders one of 5 input shapes:
//   numeric                     → single number + unit
//   numeric_pair                → systolic / diastolic for BP
//   abnormality                 → boolean flag (was the test abnormal?)
//   free_text                   → unstructured text
//   free_text_with_abnormality  → text findings + flag
//
// On submit, POSTs { input: ResultInput, notes? } to
// /api/pac-workspace/[caseId]/orders/[orderId]/result. The server fires
// Layer 3 cutoff rules and returns the recompute summary.
// =============================================================================

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { PacOrderRow } from '@/lib/pac-workspace/types';
import {
  getResultMapping,
  FREE_TEXT_FALLBACK,
  type ResultInput,
} from '@/lib/pac-workspace/result-mapping';

interface Props {
  caseId: string;
  order: PacOrderRow;
  onClose: () => void;
  onSubmitted: () => void;
}

export function ResultEntryModal({ caseId, order, onClose, onSubmitted }: Props) {
  const mapping = useMemo(
    () => getResultMapping(order.order_type) ?? FREE_TEXT_FALLBACK,
    [order.order_type]
  );

  // Numeric state
  const [numeric, setNumeric] = useState<string>('');
  // BP pair state
  const [systolic, setSystolic] = useState<string>('');
  const [diastolic, setDiastolic] = useState<string>('');
  // Abnormality + text state
  const [abnormal, setAbnormal] = useState<boolean>(false);
  const [text, setText] = useState<string>('');
  // Notes (separate from result)
  const [notes, setNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildInput(): ResultInput | { error: string } {
    switch (mapping.inputShape) {
      case 'numeric': {
        const n = Number(numeric);
        if (numeric === '' || !Number.isFinite(n)) {
          return { error: `Enter a numeric value${mapping.unit ? ` in ${mapping.unit}` : ''}.` };
        }
        return { shape: 'numeric', value: n };
      }
      case 'numeric_pair': {
        const s = Number(systolic);
        const d = Number(diastolic);
        if (!Number.isFinite(s) || !Number.isFinite(d)) {
          return { error: 'Enter both systolic and diastolic as numbers.' };
        }
        return { shape: 'numeric_pair', systolic: s, diastolic: d };
      }
      case 'abnormality':
        return { shape: 'abnormality', abnormal };
      case 'free_text': {
        if (!text.trim()) return { error: 'Enter the result text.' };
        return { shape: 'free_text', text: text.trim() };
      }
      case 'free_text_with_abnormality':
        return { shape: 'free_text_with_abnormality', abnormal, text: text.trim() || undefined };
    }
  }

  async function handleSubmit() {
    setError(null);
    const built = buildInput();
    if ('error' in built) {
      setError(built.error);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/pac-workspace/${caseId}/orders/${order.id}/result`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: built, notes: notes.trim() || null }),
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
            Enter result — {mapping.label}
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
            <span className="font-mono">{order.order_type}</span>
            {mapping.helper && (
              <div className="mt-1 text-[11px] text-gray-500">{mapping.helper}</div>
            )}
          </div>

          {mapping.inputShape === 'numeric' && (
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Value <span className="text-rose-600">*</span>
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  value={numeric}
                  onChange={(e) => setNumeric(e.target.value)}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                  placeholder="e.g. 9.5"
                />
                {mapping.unit && (
                  <span className="text-xs text-gray-500">{mapping.unit}</span>
                )}
              </div>
            </div>
          )}

          {mapping.inputShape === 'numeric_pair' && (
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Systolic / Diastolic <span className="text-rose-600">*</span>
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  step="1"
                  value={systolic}
                  onChange={(e) => setSystolic(e.target.value)}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-xs"
                  placeholder="180"
                />
                <span className="text-gray-400">/</span>
                <input
                  type="number"
                  step="1"
                  value={diastolic}
                  onChange={(e) => setDiastolic(e.target.value)}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-xs"
                  placeholder="110"
                />
                <span className="text-xs text-gray-500">mmHg</span>
              </div>
            </div>
          )}

          {(mapping.inputShape === 'abnormality' ||
            mapping.inputShape === 'free_text_with_abnormality') && (
            <fieldset>
              <legend className="text-xs font-medium text-gray-700">
                Abnormality flag
              </legend>
              <div className="mt-1 flex gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="abnormal"
                    checked={!abnormal}
                    onChange={() => setAbnormal(false)}
                  />
                  Normal
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="abnormal"
                    checked={abnormal}
                    onChange={() => setAbnormal(true)}
                  />
                  Abnormal
                </label>
              </div>
            </fieldset>
          )}

          {(mapping.inputShape === 'free_text' ||
            mapping.inputShape === 'free_text_with_abnormality') && (
            <div>
              <label className="block text-xs font-medium text-gray-700">
                {mapping.inputShape === 'free_text' ? (
                  <>
                    Findings <span className="text-rose-600">*</span>
                  </>
                ) : (
                  'Findings'
                )}
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                placeholder="Describe findings"
              />
            </div>
          )}

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
            File upload deferred to v1.x. After save, attach lab reports / images
            via the section row link.
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
            {submitting ? 'Saving…' : 'Save result'}
          </button>
        </footer>
      </div>
    </div>
  );
}
