'use client';

// ============================================
// Rounds — Version History Drawer (Sprint 1 Day 5)
// Right-side drawer listing prior versions of a form submission chain.
// Works for any form_type in VERSIONED_FORM_TYPES (Day 5 extended this from
// financial_counseling-only to all 4 handoff-family forms).
//
// Props:
//   patientThreadId  — scoping key for the chain
//   formType         — one of VERSIONED_FORM_TYPES
//   currentFormId    — optional; highlights the currently-open submission
//   open             — drawer open state
//   onClose          — close handler
//
// Pulls from GET /api/forms?form_type=X&patient_thread_id=Y which already
// exists. No new endpoint needed for Day 5.
// ============================================

import { useEffect, useState, useMemo } from 'react';

interface SubmissionVersion {
  id: string;
  form_type: string;
  form_version: number;
  version_number: number | null;
  parent_submission_id: string | null;
  change_reason: string | null;
  submitted_by: string;
  submitter_name?: string | null;
  form_data: Record<string, unknown>;
  created_at: string;
  status: string;
}

const FINANCIAL_FIELDS = new Set([
  'estimated_total_cost',
  'insurance_coverage_amount',
  'copay_patient_responsibility',
  'deposit_required',
  'deposit_collected_amount',
  'coupon_code',
  'discount_pct',
  'package_name',
  'payment_mode',
]);

export default function VersionHistoryDrawer({
  patientThreadId,
  formType,
  currentFormId,
  open,
  onClose,
}: {
  patientThreadId: string;
  formType: string;
  currentFormId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<SubmissionVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `/api/forms?form_type=${encodeURIComponent(formType)}&patient_thread_id=${encodeURIComponent(patientThreadId)}`;
    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.success && Array.isArray(body.data)) {
          // Sort by created_at ascending so version_number grows naturally
          const sorted = [...body.data].sort(
            (a: SubmissionVersion, b: SubmissionVersion) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          setVersions(sorted);
        } else {
          setError(body?.error || 'Failed to load versions');
        }
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, patientThreadId, formType]);

  // Build a diff map: for each version, which fields differ from the previous?
  const diffMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (let i = 1; i < versions.length; i++) {
      const prev = versions[i - 1]!;
      const curr = versions[i]!;
      const changed = new Set<string>();
      const keys = new Set([...Object.keys(prev.form_data || {}), ...Object.keys(curr.form_data || {})]);
      for (const k of keys) {
        const a = prev.form_data?.[k];
        const b = curr.form_data?.[k];
        if (JSON.stringify(a) !== JSON.stringify(b)) changed.add(k);
      }
      m.set(curr.id, changed);
    }
    return m;
  }, [versions]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />
      {/* drawer */}
      <aside className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Version history</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="p-4">
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
          {error && <p className="text-sm text-red-600">Error: {error}</p>}
          {!loading && !error && versions.length === 0 && (
            <p className="text-sm text-gray-500">No prior versions.</p>
          )}

          <ol className="space-y-3">
            {versions.map((v, i) => {
              const isCurrent = v.id === currentFormId;
              const changed = diffMap.get(v.id);
              const hasFinancialChange =
                changed && [...changed].some((k) => FINANCIAL_FIELDS.has(k));
              const isExpanded = expandedId === v.id;
              return (
                <li
                  key={v.id}
                  className={`rounded-lg border p-3 ${isCurrent ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-gray-900">v{v.version_number ?? i + 1}</span>
                      {isCurrent && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white">current</span>}
                      {hasFinancialChange && (
                        <span
                          title="Financial field changed"
                          className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-400"
                        />
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {new Date(v.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-600">
                    by {v.submitter_name || v.submitted_by}
                    {v.change_reason ? ` · “${v.change_reason}”` : ''}
                  </p>

                  {i > 0 && changed && changed.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                      className="mt-2 text-xs font-medium text-blue-700 hover:underline"
                    >
                      {isExpanded ? 'Hide diff' : `Show diff (${changed.size} field${changed.size > 1 ? 's' : ''})`}
                    </button>
                  )}

                  {isExpanded && changed && (
                    <div className="mt-2 space-y-1 rounded bg-gray-50 p-2 text-xs">
                      {[...changed].map((k) => {
                        const prev = versions[i - 1]?.form_data?.[k];
                        const curr = v.form_data?.[k];
                        const isFinancial = FINANCIAL_FIELDS.has(k);
                        return (
                          <div key={k} className="grid grid-cols-[8rem_1fr] gap-2">
                            <span className={`truncate font-mono ${isFinancial ? 'text-yellow-700' : 'text-gray-700'}`}>
                              {k}
                            </span>
                            <span className="break-words">
                              <span className="text-red-700 line-through">
                                {prev != null ? String(prev).substring(0, 120) : '—'}
                              </span>
                              <span className="mx-1 text-gray-400">→</span>
                              <span className="text-green-800">
                                {curr != null ? String(curr).substring(0, 120) : '—'}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}
