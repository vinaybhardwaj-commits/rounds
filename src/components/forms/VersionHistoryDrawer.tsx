'use client';

// =============================================================================
// Rounds — Version History Drawer (redesigned 25 Apr 2026)
// Single unified drawer covering EVERY form submission for a patient,
// grouped by form type. Each row is clickable → /forms/[id]. Shows the
// form name, version pill, submitter name, date+time, status badge, and
// (for v2+) a quick diff count.
//
// Open patterns:
//   - From PatientFormSubmissions header → no initialFormType; expands
//     the group with the most recent activity.
//   - From PatientFormSubmissions per-form 'All versions' → initialFormType
//     set, that group is auto-expanded, others collapsed.
//   - From FormRenderer header 'Version history' → initialFormType +
//     currentFormId set.
// =============================================================================

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FORM_TYPE_LABELS } from '@/lib/form-registry';
import { ChevronDown, ChevronRight, FileText, ArrowUpRight } from 'lucide-react';
import type { FormType } from '@/types';

interface SubmissionRow {
  id: string;
  form_type: string;
  form_version: number;
  version_number: number | null;
  parent_submission_id: string | null;
  change_reason: string | null;
  submitted_by: string;
  submitted_by_name?: string | null;  // API field — was wrongly aliased to submitter_name in v1
  submitter_name?: string | null;     // accept both for compat
  form_data: Record<string, unknown>;
  created_at: string;
  status: string;
  completion_score: number | null;  // 0..1, computed at submit time
}

interface FormGroup {
  formType: string;
  formLabel: string;
  versions: SubmissionRow[];      // sorted ascending by created_at; index 0 = oldest
  latestActivity: string;          // ISO timestamp of newest row
}

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  reviewed:  'bg-green-100 text-green-700',
  flagged:   'bg-red-100 text-red-700',
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

// Count fields whose JSON-stringified values differ between two snapshots.
// Skips computed metadata keys (underscore prefix).
function countChangedFields(prev: Record<string, unknown>, curr: Record<string, unknown>): number {
  let n = 0;
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
  for (const k of keys) {
    if (k.startsWith('_')) continue;
    if (JSON.stringify(prev?.[k]) !== JSON.stringify(curr?.[k])) n++;
  }
  return n;
}

export default function VersionHistoryDrawer({
  patientThreadId,
  initialFormType,
  currentFormId,
  open,
  onClose,
}: {
  patientThreadId: string;
  /** When set, this group's accordion is auto-expanded. Other groups collapsed. */
  initialFormType?: string;
  /** Highlights this row across all groups (typically the form being edited). */
  currentFormId?: string;
  open: boolean;
  onClose: () => void;
  /** @deprecated old prop; ignored in unified drawer. Kept for compat with old callers. */
  formType?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Fetch ALL submissions for this patient — no form_type filter.
    fetch(`/api/forms?patient_thread_id=${encodeURIComponent(patientThreadId)}&limit=500`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.success && Array.isArray(body.data)) {
          setRows(body.data as SubmissionRow[]);
        } else {
          setError(body?.error || 'Failed to load form history');
        }
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, patientThreadId]);

  // Build groups + order them by latest activity (most recent first).
  // Within a group, sort ASC so version_number aligns with array index for diff counting.
  const groups = useMemo<FormGroup[]>(() => {
    const byType: Record<string, SubmissionRow[]> = {};
    for (const r of rows) {
      if (!byType[r.form_type]) byType[r.form_type] = [];
      byType[r.form_type].push(r);
    }
    const out: FormGroup[] = [];
    for (const [type, list] of Object.entries(byType)) {
      const asc = [...list].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      out.push({
        formType: type,
        formLabel: FORM_TYPE_LABELS[type as FormType] || type,
        versions: asc,
        latestActivity: asc[asc.length - 1]?.created_at || '',
      });
    }
    out.sort(
      (a, b) => new Date(b.latestActivity).getTime() - new Date(a.latestActivity).getTime()
    );
    return out;
  }, [rows]);

  // Initial expansion: if initialFormType matches a group, expand that one.
  // Otherwise expand the top group (most recent activity).
  useEffect(() => {
    if (!open || groups.length === 0) return;
    const hint = initialFormType && groups.find((g) => g.formType === initialFormType);
    setExpanded(new Set([hint ? hint.formType : groups[0]!.formType]));
  }, [open, groups, initialFormType]);

  const toggleGroup = (formType: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(formType)) next.delete(formType);
      else next.add(formType);
      return next;
    });
  };

  const handleRowClick = (id: string) => {
    onClose();
    router.push(`/forms/${id}`);
  };

  if (!open) return null;

  const hasAny = !loading && !error && rows.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Form history</h2>
            {hasAny && (
              <p className="text-xs text-gray-500">
                {rows.length} submission{rows.length === 1 ? '' : 's'} across {groups.length} form{groups.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="p-3">
          {loading && <p className="px-2 py-4 text-sm text-gray-500">Loading…</p>}
          {error && <p className="px-2 py-4 text-sm text-red-600">Error: {error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="px-2 py-4 text-sm text-gray-500">No forms have been submitted for this patient yet.</p>
          )}

          <div className="space-y-2">
            {groups.map((group) => {
              const isOpen = expanded.has(group.formType);
              const versionCount = group.versions.length;
              return (
                <div key={group.formType} className="rounded-lg border border-gray-200 bg-white">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.formType)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-gray-500 flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-gray-500 flex-shrink-0" />}
                      <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="text-sm font-semibold text-gray-900 truncate">{group.formLabel}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {versionCount} version{versionCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {fmtDate(group.latestActivity)}
                    </span>
                  </button>

                  {isOpen && (
                    <ol className="border-t border-gray-100 bg-gray-50/50">
                      {[...group.versions].reverse().map((row, reverseIdx) => {
                        // Compute diff against the prior version (in ascending order).
                        const ascIdx = group.versions.length - 1 - reverseIdx;
                        const prev = ascIdx > 0 ? group.versions[ascIdx - 1] : null;
                        const changed = prev ? countChangedFields(prev.form_data || {}, row.form_data || {}) : 0;
                        const isCurrent = row.id === currentFormId;
                        const submitter = row.submitted_by_name || row.submitter_name || null;
                        const versionLabel = row.version_number ?? (ascIdx + 1);
                        const statusClass = STATUS_STYLES[row.status] || STATUS_STYLES.submitted;
                        return (
                          <li
                            key={row.id}
                            className={`group flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-blue-50/40 ${isCurrent ? 'bg-blue-50/60' : ''} ${reverseIdx > 0 ? 'border-t border-gray-100' : ''}`}
                            onClick={() => handleRowClick(row.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRowClick(row.id); }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-gray-900">v{versionLabel}</span>
                                {isCurrent && (
                                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">current</span>
                                )}
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${statusClass}`}>
                                  {row.status}
                                </span>
                                {row.completion_score != null && (() => {
                                  const pct = Math.round(row.completion_score * 100);
                                  // Color: green \u2265 90, amber 50-89, red < 50.
                                  const completionClass = pct >= 90
                                    ? 'bg-green-100 text-green-700'
                                    : pct >= 50
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-red-100 text-red-700';
                                  return (
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${completionClass}`}
                                      title="How much of the form was filled at submit time"
                                    >
                                      {pct}% complete
                                    </span>
                                  );
                                })()}
                                {changed > 0 && (
                                  <span className="rounded bg-yellow-100 text-yellow-800 px-1.5 py-0.5 text-[10px] font-medium">
                                    {changed} field{changed === 1 ? '' : 's'} changed
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-gray-600 truncate">
                                by {submitter || 'Unknown'} · {fmtDate(row.created_at)}
                              </p>
                              {row.change_reason && (
                                <p className="mt-1 text-xs italic text-gray-500 truncate">
                                  &ldquo;{row.change_reason}&rdquo;
                                </p>
                              )}
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-gray-400 group-hover:text-blue-600 flex-shrink-0 mt-0.5" />
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
