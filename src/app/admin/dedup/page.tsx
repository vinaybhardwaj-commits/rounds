'use client';

/**
 * /admin/dedup — Dedup Hub
 *
 * R.3 + R.4 Phase 5.1/5.2/5.3. Three-tab admin surface for reviewing,
 * merging, and auditing patient-thread duplicates.
 *
 *   Review Queue — pending dedup_candidates, side-by-side with Merge / Not a dup actions.
 *                  Supports ?override=<candidate_id> deep link from Exceptions.
 *   Activity Log — paginated dedup_log with CSV export.
 *   Exceptions   — candidates blocked by LSQ conflict / UHID collision /
 *                  stage regression / idempotency conflict. Override flow
 *                  redirects back into Review Queue with override pre-checked.
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  GitMerge,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  History,
  ListFilter,
  ShieldAlert,
  Download,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Filter,
  ArrowRight,
  Shield,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';

type TabKey = 'queue' | 'log' | 'exceptions';

interface ExceptionFlagsClient {
  lsq_conflict: boolean;
  uhid_collision: boolean;
  stage_regression: boolean;
  idempotency_conflict: boolean;
}

interface ThreadSide {
  id: string;
  patient_name: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  city: string | null;
  uhid: string | null;
  source_type: string | null;
  lsq_lead_id: string | null;
  current_stage: string | null;
  archived_at: string | null;
  merged_into_id?: string | null;
  created_at: string | null;
}

interface Candidate {
  id: string;
  similarity: number;
  match_type: string;
  match_fields: Record<string, unknown> | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  recommended_winner_id: string;
  newer: ThreadSide;
  existing: ThreadSide;
}

function fmt(v: string | null | undefined) {
  return v == null || v === '' ? <span className="text-gray-300">—</span> : v;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return v;
  }
}

export default function DedupHubPage() {
  // useSearchParams requires a Suspense boundary in Next.js App Router
  return (
    <Suspense
      fallback={
        <AdminLayout
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Dedup Hub' },
          ]}
        >
          <div className="px-4 sm:px-6 py-6 text-gray-500">Loading…</div>
        </AdminLayout>
      }
    >
      <DedupHubPageInner />
    </Suspense>
  );
}

function DedupHubPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initial tab from URL (?tab=queue|log|exceptions), default to 'queue'
  const urlTab = searchParams.get('tab') as TabKey | null;
  const urlOverride = searchParams.get('override'); // candidate_id to highlight + pre-check override
  const initialTab: TabKey =
    urlTab === 'queue' || urlTab === 'log' || urlTab === 'exceptions' ? urlTab : 'queue';

  const [tab, setTab] = useState<TabKey>(initialTab);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedWinner, setSelectedWinner] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // Phase 5.3 — override state keyed by candidate_id. Entries are only
  // populated for candidates the user has opted into overriding (either via
  // the Exceptions deep link or by manually checking the box in the Review Queue).
  const [overrideChecked, setOverrideChecked] = useState<Record<string, boolean>>({});
  // Block reason flags fetched from /api/admin/dedup/exceptions?candidate_id=...
  const [blockReasons, setBlockReasons] = useState<Record<string, ExceptionFlagsClient | null>>({});

  const navigateToOverride = useCallback(
    (candidateId: string) => {
      setTab('queue');
      setOverrideChecked((prev) => ({ ...prev, [candidateId]: true }));
      // Update URL without full reload so refresh preserves the state
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('tab', 'queue');
      sp.set('override', candidateId);
      router.replace(`/admin/dedup?${sp.toString()}`);
    },
    [router, searchParams]
  );

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/dedup/candidates?status=pending');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load');
      const list = (data.data?.candidates || []) as Candidate[];
      setCandidates(list);
      // Default each selection to the recommended winner
      const initial: Record<string, string> = {};
      for (const c of list) {
        initial[c.id] = c.recommended_winner_id;
      }
      setSelectedWinner((prev) => ({ ...initial, ...prev }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'queue') loadQueue();
  }, [tab, loadQueue]);

  // Phase 5.3 — If the page was opened via the Exceptions deep link
  // (?override=<candidate_id>), pre-check the override box and fetch the
  // block reasons so the Review Queue row can show the red banner.
  useEffect(() => {
    if (!urlOverride) return;
    setOverrideChecked((prev) => ({ ...prev, [urlOverride]: true }));
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/dedup/exceptions?candidate_id=${encodeURIComponent(urlOverride)}`
        );
        const data = await res.json();
        if (!cancelled && data.success && data.data?.exception?.flags) {
          setBlockReasons((prev) => ({ ...prev, [urlOverride]: data.data.exception.flags }));
        }
      } catch {
        // Non-fatal — banner just won't show. Override checkbox still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlOverride]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const doMerge = async (c: Candidate) => {
    const winnerId = selectedWinner[c.id] || c.recommended_winner_id;
    const loserId = winnerId === c.newer.id ? c.existing.id : c.newer.id;
    if (!winnerId || !loserId || winnerId === loserId) return;

    const isOverride = !!overrideChecked[c.id];
    const flags = blockReasons[c.id] || null;
    const userReason = reasons[c.id] || '';

    // If override is checked, prepend "override: " to the reason so the
    // merge helper's conflict guard recognises it (see src/lib/dedup.ts,
    // line ~496: "overrideConflict = ... .includes('override')").
    const finalReason = isOverride
      ? userReason
        ? `override: ${userReason}`
        : 'override: admin-forced via Exceptions tab'
      : userReason || undefined;

    // If override is checked, require an extra confirmation that lists the
    // block reasons the admin is about to bypass.
    let confirmMessage = `Merge thread ${loserId.slice(0, 8)} into ${winnerId.slice(0, 8)}?\n\nThis will archive the loser, re-parent all its data to the winner, and post a final system message in the loser's chat channel.`;
    if (isOverride) {
      const reasonList: string[] = [];
      if (flags?.lsq_conflict) reasonList.push('LSQ lead conflict');
      if (flags?.uhid_collision) reasonList.push('UHID collision');
      if (flags?.stage_regression) reasonList.push('Stage regression');
      if (flags?.idempotency_conflict) reasonList.push('Idempotency conflict');
      confirmMessage =
        `OVERRIDE MERGE — you are about to bypass the following guardrails:\n\n` +
        (reasonList.length ? reasonList.map((r) => `  • ${r}`).join('\n') : '  • (no active flags — override is safe)') +
        `\n\n` +
        confirmMessage;
    }

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    setBusyId(c.id);
    try {
      const res = await fetch('/api/admin/dedup/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnerId,
          loserId,
          reason: finalReason,
          candidateId: c.id,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Merge failed');
      setToast({
        type: 'success',
        message: `Merged ${data.data.mergedFields?.length || 0} fields, moved ${Object.values(
          data.data.fkCounts || {}
        ).reduce((a: number, b: unknown) => a + Number(b), 0)} FK rows. Channel: ${data.data.channelAction || 'n/a'}${isOverride ? ' (override)' : ''}`,
      });
      // Clear override + banner state for this candidate — the exception
      // has been resolved and should disappear on next Exceptions tab view.
      setOverrideChecked((prev) => {
        const next = { ...prev };
        delete next[c.id];
        return next;
      });
      setBlockReasons((prev) => {
        const next = { ...prev };
        delete next[c.id];
        return next;
      });
      await loadQueue();
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Merge failed',
      });
    } finally {
      setBusyId(null);
    }
  };

  const doDismiss = async (c: Candidate) => {
    const confirmed = window.confirm(
      `Mark as NOT a duplicate?\n\nThis will close the candidate and clear the duplicate flag on the newer thread (if no other candidates remain).`
    );
    if (!confirmed) return;

    setBusyId(c.id);
    try {
      const res = await fetch('/api/admin/dedup/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: c.id,
          resolution: 'distinct',
          reason: reasons[c.id] || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Dismiss failed');
      setToast({
        type: 'success',
        message: `Dismissed as distinct${data.data.clearedFlag ? ' (flag cleared)' : ''}`,
      });
      await loadQueue();
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Dismiss failed',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminLayout
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Dedup Hub' },
      ]}
    >
      <div className="px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy flex items-center gap-2">
              <GitMerge size={24} />
              Dedup Hub
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Review, merge, and audit possible patient duplicates.
            </p>
          </div>
          <button
            onClick={() => loadQueue()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
          {[
            { key: 'queue' as const, label: 'Review Queue', icon: <ListFilter size={16} />, count: candidates.length },
            { key: 'log' as const, label: 'Activity Log', icon: <History size={16} /> },
            { key: 'exceptions' as const, label: 'Exceptions', icon: <ShieldAlert size={16} /> },
          ].map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-even-blue text-even-blue'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg flex items-start gap-2 text-sm ${
              toast.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : (
              <XCircle size={16} className="mt-0.5 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        )}

        {/* Tab content */}
        {tab === 'queue' && (
          <ReviewQueueTab
            candidates={candidates}
            loading={loading}
            error={error}
            busyId={busyId}
            selectedWinner={selectedWinner}
            setSelectedWinner={setSelectedWinner}
            reasons={reasons}
            setReasons={setReasons}
            overrideChecked={overrideChecked}
            setOverrideChecked={setOverrideChecked}
            blockReasons={blockReasons}
            highlightCandidateId={urlOverride}
            onMerge={doMerge}
            onDismiss={doDismiss}
          />
        )}
        {tab === 'log' && <ActivityLogTab active={tab === 'log'} />}
        {tab === 'exceptions' && (
          <ExceptionsTab
            active={tab === 'exceptions'}
            onReviewAndOverride={navigateToOverride}
          />
        )}
      </div>
    </AdminLayout>
  );
}

// -----------------------------------------------------------------------------
// Review Queue Tab
// -----------------------------------------------------------------------------

interface ReviewQueueTabProps {
  candidates: Candidate[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  selectedWinner: Record<string, string>;
  setSelectedWinner: (v: Record<string, string>) => void;
  reasons: Record<string, string>;
  setReasons: (v: Record<string, string>) => void;
  overrideChecked: Record<string, boolean>;
  setOverrideChecked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  blockReasons: Record<string, ExceptionFlagsClient | null>;
  highlightCandidateId: string | null;
  onMerge: (c: Candidate) => void;
  onDismiss: (c: Candidate) => void;
}

function ReviewQueueTab({
  candidates,
  loading,
  error,
  busyId,
  selectedWinner,
  setSelectedWinner,
  reasons,
  setReasons,
  overrideChecked,
  setOverrideChecked,
  blockReasons,
  highlightCandidateId,
  onMerge,
  onDismiss,
}: ReviewQueueTabProps) {
  // Scroll the highlighted candidate (from Exceptions deep link) into view
  // once candidates are loaded.
  useEffect(() => {
    if (!highlightCandidateId) return;
    const el = document.getElementById(`candidate-${highlightCandidateId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightCandidateId, candidates]);
  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
        Loading candidates…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 rounded-lg bg-red-50 text-red-800 border border-red-200 flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!candidates.length) {
    return (
      <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
        <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
        <h3 className="text-lg font-semibold text-gray-800">Queue is clear</h3>
        <p className="text-sm text-gray-500 mt-1">
          No pending duplicate candidates. New flags will appear here as soon as
          a fuzzy name match is detected during intake.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {candidates.map((c) => {
        const currentWinner = selectedWinner[c.id] || c.recommended_winner_id;
        const loserSide = currentWinner === c.newer.id ? c.existing : c.newer;
        const winnerSide = currentWinner === c.newer.id ? c.newer : c.existing;
        const busy = busyId === c.id;
        const isOverride = !!overrideChecked[c.id];
        const flags = blockReasons[c.id] || null;
        const isHighlighted = highlightCandidateId === c.id;
        const blockReasonList: Array<{ key: string; label: string; detail: string }> = [];
        if (flags?.lsq_conflict)
          blockReasonList.push({
            key: 'lsq_conflict',
            label: 'LSQ lead conflict',
            detail: 'Both threads have distinct LeadSquared lead ids — merging silently folds two leads into one row.',
          });
        if (flags?.uhid_collision)
          blockReasonList.push({
            key: 'uhid_collision',
            label: 'UHID collision',
            detail: 'Both threads carry different UHIDs — confirm they are the same patient recorded twice.',
          });
        if (flags?.stage_regression)
          blockReasonList.push({
            key: 'stage_regression',
            label: 'Stage regression',
            detail: 'Thread stages differ by ≥2 ranks — verify these are really the same patient, not two different journeys.',
          });
        if (flags?.idempotency_conflict)
          blockReasonList.push({
            key: 'idempotency_conflict',
            label: 'Idempotency conflict',
            detail: 'One of the threads is already merged or archived — this candidate is stale and likely needs dismiss, not merge.',
          });

        return (
          <div
            key={c.id}
            id={`candidate-${c.id}`}
            className={`bg-white border rounded-lg shadow-sm overflow-hidden transition-all ${
              isHighlighted ? 'border-red-400 ring-2 ring-red-300' : 'border-gray-200'
            }`}
          >
            {/* Header row */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-semibold">
                  {c.match_type.replace(/_/g, ' ')} · {(c.similarity * 100).toFixed(0)}%
                </span>
                <span className="text-gray-500 text-xs">
                  Flagged {fmtDate(c.created_at)}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                Candidate ID: <span className="font-mono">{c.id.slice(0, 8)}</span>
              </div>
            </div>

            {/* Phase 5.3 — Block-reason banner (only when override state + flags present) */}
            {isOverride && blockReasonList.length > 0 && (
              <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                <div className="flex items-start gap-2">
                  <Shield size={16} className="mt-0.5 shrink-0 text-red-600" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-800">
                      This merge is blocked by {blockReasonList.length} guardrail{blockReasonList.length > 1 ? 's' : ''}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {blockReasonList.map((b) => (
                        <li key={b.key} className="text-xs text-red-700">
                          <span className="font-semibold">{b.label}:</span> {b.detail}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-red-600">
                      Check the override box below to bypass these guardrails. This action is audit-logged.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
              {[c.newer, c.existing].map((side, idx) => {
                const isSelected = currentWinner === side.id;
                const label = idx === 0 ? 'Newer' : 'Existing';
                return (
                  <div
                    key={side.id}
                    className={`p-4 border-gray-200 ${
                      idx === 0 ? 'border-b md:border-b-0 md:border-r' : ''
                    } ${isSelected ? 'bg-green-50' : 'bg-white'}`}
                  >
                    <label className="flex items-start gap-2 cursor-pointer mb-3">
                      <input
                        type="radio"
                        name={`winner-${c.id}`}
                        checked={isSelected}
                        onChange={() =>
                          setSelectedWinner({ ...selectedWinner, [c.id]: side.id })
                        }
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {label}
                          </span>
                          {isSelected && (
                            <span className="text-xs font-semibold text-green-700">
                              ✓ WINNER
                            </span>
                          )}
                          {side.id === c.recommended_winner_id && !isSelected && (
                            <span className="text-xs text-gray-400">recommended</span>
                          )}
                        </div>
                        <div className="font-semibold text-gray-900 truncate">
                          {side.patient_name || '—'}
                        </div>
                      </div>
                    </label>

                    <dl className="text-xs text-gray-700 space-y-1">
                      <Row label="Phone" value={fmt(side.phone)} />
                      <Row label="WhatsApp" value={fmt(side.whatsapp_number)} />
                      <Row label="City" value={fmt(side.city)} />
                      <Row label="UHID" value={fmt(side.uhid)} />
                      <Row
                        label="Source"
                        value={
                          <span>
                            {fmt(side.source_type)}
                            {side.lsq_lead_id && (
                              <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-blue-100 text-blue-800">
                                LSQ
                              </span>
                            )}
                          </span>
                        }
                      />
                      <Row label="Stage" value={fmt(side.current_stage)} />
                      <Row label="Created" value={fmtDate(side.created_at)} />
                    </dl>
                  </div>
                );
              })}
            </div>

            {/* Action row */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={reasons[c.id] || ''}
                  onChange={(e) => setReasons({ ...reasons, [c.id]: e.target.value })}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-even-blue/30 focus:border-even-blue"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onDismiss(c)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    <XCircle size={14} />
                    Not a dup
                  </button>
                  <button
                    type="button"
                    onClick={() => onMerge(c)}
                    disabled={busy}
                    className={`inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
                      isOverride
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-even-blue hover:bg-even-blue/90'
                    }`}
                    title={`Merge loser ${loserSide.id.slice(0, 8)} into winner ${winnerSide.id.slice(0, 8)}`}
                  >
                    <GitMerge size={14} />
                    {busy ? 'Merging…' : isOverride ? 'Override & Merge' : 'Merge'}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isOverride}
                  onChange={(e) =>
                    setOverrideChecked((prev) => ({ ...prev, [c.id]: e.target.checked }))
                  }
                  className="h-3.5 w-3.5"
                />
                <Shield size={12} className={isOverride ? 'text-red-600' : 'text-gray-400'} />
                <span className={isOverride ? 'text-red-700 font-semibold' : ''}>
                  Override guardrails for this merge (LSQ conflict / UHID collision / stage regression / idempotency)
                </span>
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-16 text-gray-400 shrink-0">{label}</dt>
      <dd className="flex-1 min-w-0 truncate">{value}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Activity Log Tab (Phase 5.2)
// -----------------------------------------------------------------------------

interface ThreadRef {
  id: string;
  patient_name: string | null;
  uhid: string | null;
  phone: string | null;
  current_stage: string | null;
  archived_at: string | null;
  merged_into_id: string | null;
}

interface ActivityEntry {
  id: string;
  action: 'merge' | 'split' | 'ignore' | 'link' | 'flag' | 'create' | string;
  source_thread_id: string | null;
  target_thread_id: string | null;
  match_layer: number | null;
  similarity: number | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  endpoint: string | null;
  created_at: string;
  source: ThreadRef | null;
  target: ThreadRef | null;
}

interface ActivityFilters {
  fromDate: string; // yyyy-mm-dd
  toDate: string; // yyyy-mm-dd
  actions: Set<string>;
  endpoint: string;
  actor: string;
  patient: string;
}

const ALL_ACTIONS: Array<ActivityEntry['action']> = [
  'merge',
  'split',
  'ignore',
  'link',
  'flag',
  'create',
];

function defaultFilters(): ActivityFilters {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
    actions: new Set(), // empty = all
    endpoint: '',
    actor: '',
    patient: '',
  };
}

function buildActivityQueryString(
  filters: ActivityFilters,
  extra?: { limit?: number; offset?: number }
): string {
  const sp = new URLSearchParams();
  if (filters.fromDate) sp.set('from', new Date(filters.fromDate + 'T00:00:00').toISOString());
  if (filters.toDate) {
    // exclusive upper bound — end of the selected day
    const toEnd = new Date(filters.toDate + 'T00:00:00');
    toEnd.setDate(toEnd.getDate() + 1);
    sp.set('to', toEnd.toISOString());
  }
  if (filters.actions.size > 0) sp.set('actions', Array.from(filters.actions).join(','));
  if (filters.endpoint.trim()) sp.set('endpoint', filters.endpoint.trim());
  if (filters.actor.trim()) sp.set('actor', filters.actor.trim());
  if (filters.patient.trim()) sp.set('patient', filters.patient.trim());
  if (extra?.limit != null) sp.set('limit', String(extra.limit));
  if (extra?.offset != null) sp.set('offset', String(extra.offset));
  return sp.toString();
}

const ACTION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  merge: { bg: 'bg-green-100', text: 'text-green-800', label: 'Merge' },
  split: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Distinct' },
  ignore: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Ignore' },
  link: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Link' },
  flag: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Flag' },
  create: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Create' },
};

function ActionBadge({ action }: { action: string }) {
  const s = ACTION_STYLES[action] || ACTION_STYLES.ignore;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

interface ActivityLogTabProps {
  active: boolean;
}

function ActivityLogTab({ active }: ActivityLogTabProps) {
  const [filters, setFilters] = useState<ActivityFilters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<ActivityFilters>(defaultFilters);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [actionCounts, setActionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const PAGE_SIZE = 100;

  const loadLog = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = buildActivityQueryString(filters, { limit: PAGE_SIZE, offset: nextOffset });
        const res = await fetch(`/api/admin/dedup/activity?${qs}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load activity log');
        setEntries(data.data?.entries || []);
        setTotal(data.data?.total || 0);
        setHasMore(Boolean(data.data?.has_more));
        setActionCounts(data.data?.action_counts || {});
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    if (active) loadLog(0);
  }, [active, loadLog]);

  const applyFilters = () => {
    setFilters(draftFilters);
    // loadLog will fire via useEffect on filters change
  };

  const resetFilters = () => {
    const d = defaultFilters();
    setDraftFilters(d);
    setFilters(d);
  };

  const toggleAction = (action: string) => {
    setDraftFilters((d) => {
      const next = new Set(d.actions);
      if (next.has(action)) next.delete(action);
      else next.add(action);
      return { ...d, actions: next };
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const qs = buildActivityQueryString(filters);
      const res = await fetch(`/api/admin/dedup/activity/export?${qs}`);
      if (!res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          throw new Error(json.error || `Export failed (${res.status})`);
        } catch {
          throw new Error(`Export failed (${res.status})`);
        }
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dedup-activity-${filters.fromDate}_to_${filters.toDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Filter size={14} />
          Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col text-xs text-gray-600">
            From
            <input
              type="date"
              value={draftFilters.fromDate}
              onChange={(e) => setDraftFilters((d) => ({ ...d, fromDate: e.target.value }))}
              className="mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            To
            <input
              type="date"
              value={draftFilters.toDate}
              onChange={(e) => setDraftFilters((d) => ({ ...d, toDate: e.target.value }))}
              className="mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            Endpoint contains
            <input
              type="text"
              placeholder="e.g. /api/lsq/sync"
              value={draftFilters.endpoint}
              onChange={(e) => setDraftFilters((d) => ({ ...d, endpoint: e.target.value }))}
              className="mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            Actor contains
            <input
              type="text"
              placeholder="e.g. vinay"
              value={draftFilters.actor}
              onChange={(e) => setDraftFilters((d) => ({ ...d, actor: e.target.value }))}
              className="mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-600 sm:col-span-2">
            Patient name contains (either side)
            <input
              type="text"
              placeholder="e.g. ravi kumar"
              value={draftFilters.patient}
              onChange={(e) => setDraftFilters((d) => ({ ...d, patient: e.target.value }))}
              className="mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
            />
          </label>
        </div>

        {/* Action filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">Actions:</span>
          {ALL_ACTIONS.map((a) => {
            const selected = draftFilters.actions.has(a);
            const count = actionCounts[a] ?? 0;
            return (
              <button
                key={a}
                onClick={() => toggleAction(a)}
                type="button"
                className={`px-2 py-1 text-xs font-medium rounded-full border transition-colors ${
                  selected
                    ? 'bg-even-blue text-white border-even-blue'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {ACTION_STYLES[a]?.label || a}
                {count > 0 && (
                  <span className={`ml-1 ${selected ? 'text-blue-100' : 'text-gray-400'}`}>
                    ({count})
                  </span>
                )}
              </button>
            );
          })}
          {draftFilters.actions.size === 0 && (
            <span className="text-xs text-gray-400">(all)</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
          <div className="text-xs text-gray-500">
            Showing <strong>{entries.length}</strong> of <strong>{total}</strong> entries
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetFilters}
              type="button"
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              Reset
            </button>
            <button
              onClick={applyFilters}
              type="button"
              className="px-3 py-1.5 text-xs font-medium text-white bg-even-blue rounded hover:opacity-90"
            >
              Apply
            </button>
            <button
              onClick={exportCsv}
              disabled={exporting || loading || total === 0}
              type="button"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              <Download size={12} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 text-red-800 border border-red-200 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && entries.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
          Loading activity log…
        </div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && !error && (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg text-gray-500">
          <History size={32} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm">No dedup activity matches these filters.</p>
        </div>
      )}

      {/* Entries table (desktop) / cards (mobile) */}
      {entries.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="hidden lg:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Action</th>
                  <th className="text-left px-3 py-2">Patients</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Endpoint / Actor</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const isOpen = expanded.has(e.id);
                  const winnerId = e.action === 'merge' ? e.target?.id : null;
                  const winnerHref = winnerId ? `/patients/${winnerId}` : null;
                  return (
                    <React.Fragment key={e.id}>
                      <tr
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggleExpand(e.id)}
                      >
                        <td className="p-2 text-gray-400">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                          {fmtDate(e.created_at)}
                        </td>
                        <td className="px-3 py-2">
                          <ActionBadge action={e.action} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs">
                            {e.source?.patient_name || e.target?.patient_name || <span className="text-gray-400">(system)</span>}
                          </div>
                          {(e.source?.uhid || e.target?.uhid) && (
                            <div className="text-xs text-gray-500">
                              UHID: {e.source?.uhid || e.target?.uhid}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-xs truncate">
                          {e.reason || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          <div className="truncate max-w-[160px]">{e.endpoint || '—'}</div>
                          <div className="truncate max-w-[160px]">{e.actor_name || <span className="text-gray-300">system</span>}</div>
                        </td>
                        <td className="px-3 py-2">
                          {winnerHref && (
                            <a
                              href={winnerHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(ev) => ev.stopPropagation()}
                              className="inline-flex items-center text-even-blue hover:underline"
                              title="Open winner thread in new tab"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/70">
                          <td></td>
                          <td colSpan={6} className="px-3 py-3">
                            <ActivityDetail entry={e} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-gray-100">
            {entries.map((e) => {
              const isOpen = expanded.has(e.id);
              const winnerId = e.action === 'merge' ? e.target?.id : null;
              const winnerHref = winnerId ? `/patients/${winnerId}` : null;
              return (
                <div key={e.id} className="p-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(e.id)}
                    className="w-full flex items-start gap-2 text-left"
                  >
                    <span className="mt-1 text-gray-400">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ActionBadge action={e.action} />
                        <span className="text-xs text-gray-500">{fmtDate(e.created_at)}</span>
                      </div>
                      <div className="text-sm text-gray-800 mt-1 truncate">
                        {e.source?.patient_name || e.target?.patient_name || <span className="text-gray-400">(system)</span>}
                      </div>
                      {e.reason && (
                        <div className="text-xs text-gray-500 mt-0.5 truncate">{e.reason}</div>
                      )}
                    </div>
                    {winnerHref && (
                      <a
                        href={winnerHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                        className="text-even-blue"
                        title="Open winner thread in new tab"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </button>
                  {isOpen && <div className="mt-3 pl-6"><ActivityDetail entry={e} /></div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {entries.length > 0 && total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-gray-600">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => loadLog(Math.max(0, offset - PAGE_SIZE))}
            className="px-3 py-1.5 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            ← Previous
          </button>
          <span>
            Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            type="button"
            disabled={!hasMore || loading}
            onClick={() => loadLog(offset + PAGE_SIZE)}
            className="px-3 py-1.5 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function ActivityDetail({ entry }: { entry: ActivityEntry }) {
  const winnerId = entry.action === 'merge' ? entry.target?.id : null;
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {entry.source && (
          <div className="bg-white border border-gray-200 rounded p-2">
            <div className="text-gray-500 mb-1 font-semibold">
              Source {entry.action === 'merge' ? '(loser)' : ''}
            </div>
            <div className="text-gray-800 font-medium">{fmt(entry.source.patient_name)}</div>
            <div className="text-gray-500">UHID: {fmt(entry.source.uhid)}</div>
            <div className="text-gray-500">Phone: {fmt(entry.source.phone)}</div>
            <div className="text-gray-500">Stage: {fmt(entry.source.current_stage)}</div>
            {entry.source.merged_into_id && (
              <div className="text-purple-600 mt-1">
                Merged into: {entry.source.merged_into_id.slice(0, 8)}…
              </div>
            )}
          </div>
        )}
        {entry.target && (
          <div className="bg-white border border-gray-200 rounded p-2">
            <div className="text-gray-500 mb-1 font-semibold">
              Target {entry.action === 'merge' ? '(winner)' : ''}
            </div>
            <div className="text-gray-800 font-medium">{fmt(entry.target.patient_name)}</div>
            <div className="text-gray-500">UHID: {fmt(entry.target.uhid)}</div>
            <div className="text-gray-500">Phone: {fmt(entry.target.phone)}</div>
            <div className="text-gray-500">Stage: {fmt(entry.target.current_stage)}</div>
            {winnerId && (
              <a
                href={`/patients/${winnerId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-even-blue hover:underline mt-1"
              >
                Open winner thread <ExternalLink size={10} />
              </a>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
        <div>
          <span className="text-gray-400">Endpoint:</span> {fmt(entry.endpoint)}
        </div>
        <div>
          <span className="text-gray-400">Actor:</span> {fmt(entry.actor_name)}
        </div>
        <div>
          <span className="text-gray-400">Match layer:</span> {entry.match_layer ?? '—'}
        </div>
        <div>
          <span className="text-gray-400">Similarity:</span>{' '}
          {entry.similarity != null ? entry.similarity.toFixed(3) : '—'}
        </div>
      </div>
      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            Metadata JSON
          </summary>
          <pre className="mt-1 p-2 bg-gray-900 text-gray-100 rounded overflow-x-auto text-[10px] leading-tight">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Exceptions Tab (Phase 5.3)
// -----------------------------------------------------------------------------

interface ExceptionEntry {
  id: string;
  similarity: number;
  match_type: string;
  status: string;
  created_at: string;
  recommended_winner_id: string;
  newer: ThreadSide;
  existing: ThreadSide;
  flags: ExceptionFlagsClient;
}

const EXCEPTION_TYPE_META: Record<
  keyof ExceptionFlagsClient,
  { label: string; short: string; bg: string; text: string; description: string }
> = {
  lsq_conflict: {
    label: 'LSQ lead conflict',
    short: 'LSQ',
    bg: 'bg-orange-100',
    text: 'text-orange-800',
    description: 'Both threads have distinct LeadSquared lead ids',
  },
  uhid_collision: {
    label: 'UHID collision',
    short: 'UHID',
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    description: 'Both threads carry different UHIDs',
  },
  stage_regression: {
    label: 'Stage regression',
    short: 'STAGE',
    bg: 'bg-yellow-100',
    text: 'text-yellow-800',
    description: 'Thread stages differ by ≥2 ranks',
  },
  idempotency_conflict: {
    label: 'Idempotency conflict',
    short: 'IDEMPOTENT',
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    description: 'One thread is already merged or archived',
  },
};

const ALL_EXCEPTION_TYPES: Array<keyof ExceptionFlagsClient> = [
  'lsq_conflict',
  'uhid_collision',
  'stage_regression',
  'idempotency_conflict',
];

function ExceptionBadge({ type }: { type: keyof ExceptionFlagsClient }) {
  const m = EXCEPTION_TYPE_META[type];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded ${m.bg} ${m.text}`}
      title={m.description}
    >
      {m.short}
    </span>
  );
}

interface ExceptionsTabProps {
  active: boolean;
  onReviewAndOverride: (candidateId: string) => void;
}

function ExceptionsTab({ active, onReviewAndOverride }: ExceptionsTabProps) {
  const [exceptions, setExceptions] = useState<ExceptionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<keyof ExceptionFlagsClient>>(new Set());
  const [patientFilter, setPatientFilter] = useState('');
  const [draftPatient, setDraftPatient] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (typeFilter.size > 0) sp.set('types', Array.from(typeFilter).join(','));
      if (patientFilter.trim()) sp.set('patient', patientFilter.trim());
      sp.set('limit', '200');
      const res = await fetch(`/api/admin/dedup/exceptions?${sp.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load exceptions');
      setExceptions(data.data?.exceptions || []);
      setTotal(data.data?.total || 0);
      setCounts(data.data?.counts || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, patientFilter]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const toggleType = (t: keyof ExceptionFlagsClient) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyPatientFilter = () => {
    setPatientFilter(draftPatient);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Filter size={14} />
          Filter exceptions
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_EXCEPTION_TYPES.map((t) => {
            const active = typeFilter.has(t);
            const count = counts[t] || 0;
            const meta = EXCEPTION_TYPE_META[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  active
                    ? `${meta.bg} ${meta.text} border-current`
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
                title={meta.description}
              >
                {meta.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[1.25rem] px-1 text-[10px] font-bold rounded ${
                    active ? 'bg-white/60' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="text"
            placeholder="Filter by patient name…"
            value={draftPatient}
            onChange={(e) => setDraftPatient(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyPatientFilter();
            }}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-even-blue/30 focus:border-even-blue"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyPatientFilter}
              className="px-3 py-2 text-sm font-medium text-white bg-even-blue rounded-lg hover:bg-even-blue/90"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftPatient('');
                setPatientFilter('');
                setTypeFilter(new Set());
              }}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="text-center py-12 text-gray-500">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
          Loading exceptions…
        </div>
      )}

      {error && !loading && (
        <div className="px-4 py-3 rounded-lg bg-red-50 text-red-800 border border-red-200 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && exceptions.length === 0 && (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
          <h3 className="text-lg font-semibold text-gray-800">No exceptions</h3>
          <p className="text-sm text-gray-500 mt-1">
            All pending dedup candidates are clean. Guardrail-blocked merges will appear here
            with an override path into the Review Queue.
          </p>
        </div>
      )}

      {!loading && !error && exceptions.length > 0 && (
        <>
          <div className="text-xs text-gray-500">
            Showing {exceptions.length} of {total} exception{total === 1 ? '' : 's'}
            {(typeFilter.size > 0 || patientFilter) && ' (filtered)'}
          </div>

          <div className="space-y-3">
            {exceptions.map((e) => {
              const activeFlags = ALL_EXCEPTION_TYPES.filter((t) => e.flags[t]);
              const isExpanded = expanded.has(e.id);
              const winnerSide =
                e.recommended_winner_id === e.newer.id ? e.newer : e.existing;
              const loserSide =
                e.recommended_winner_id === e.newer.id ? e.existing : e.newer;
              return (
                <div
                  key={e.id}
                  className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
                >
                  {/* Header */}
                  <div className="px-4 py-3 bg-red-50/40 border-b border-gray-200">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex items-center flex-wrap gap-2">
                        <ShieldAlert size={16} className="text-red-600 shrink-0" />
                        <span className="font-semibold text-gray-900 text-sm">
                          {winnerSide.patient_name || '—'}
                          <span className="text-gray-400 font-normal"> vs </span>
                          {loserSide.patient_name || '—'}
                        </span>
                        {activeFlags.map((t) => (
                          <ExceptionBadge key={t} type={t} />
                        ))}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>
                          {(e.similarity * 100).toFixed(0)}% · {e.match_type.replace(/_/g, ' ')}
                        </span>
                        <span className="font-mono">{e.id.slice(0, 8)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Summary row + expand */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(e.id)}
                    className="w-full px-4 py-2 text-left text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100"
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>
                      Flagged {fmtDate(e.created_at)} · {activeFlags.length} guardrail
                      {activeFlags.length > 1 ? 's' : ''} · click to see details
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="p-4 bg-gray-50 border-b border-gray-100">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="bg-white border border-gray-200 rounded p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                            Newer ({e.newer.id.slice(0, 8)})
                          </div>
                          <ExceptionSideDetails side={e.newer} />
                        </div>
                        <div className="bg-white border border-gray-200 rounded p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                            Existing ({e.existing.id.slice(0, 8)})
                          </div>
                          <ExceptionSideDetails side={e.existing} />
                        </div>
                      </div>
                      <div className="mt-3 space-y-1">
                        {activeFlags.map((t) => (
                          <div key={t} className="text-xs text-gray-700">
                            <span className="font-semibold">{EXCEPTION_TYPE_META[t].label}:</span>{' '}
                            {EXCEPTION_TYPE_META[t].description}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white">
                    <div className="text-xs text-gray-500">
                      Recommended winner: {winnerSide.patient_name || '—'}
                    </div>
                    <button
                      type="button"
                      onClick={() => onReviewAndOverride(e.id)}
                      className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
                    >
                      Review &amp; Override
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ExceptionSideDetails({ side }: { side: ThreadSide }) {
  return (
    <dl className="space-y-1 text-gray-700">
      <Row label="Name" value={fmt(side.patient_name)} />
      <Row label="Phone" value={fmt(side.phone)} />
      <Row label="UHID" value={fmt(side.uhid)} />
      <Row label="LSQ" value={fmt(side.lsq_lead_id)} />
      <Row label="Stage" value={fmt(side.current_stage)} />
      <Row
        label="Source"
        value={
          <span>
            {fmt(side.source_type)}
            {side.archived_at && (
              <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-gray-200 text-gray-700">
                ARCHIVED
              </span>
            )}
          </span>
        }
      />
      <Row label="Created" value={fmtDate(side.created_at)} />
    </dl>
  );
}
