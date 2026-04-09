'use client';

/**
 * /admin/dedup — Dedup Hub
 *
 * R.3 + R.4 Phase 5.1. Three-tab admin surface for reviewing, merging, and
 * auditing patient-thread duplicates.
 *
 *   Review Queue — pending dedup_candidates, side-by-side with Merge / Not a dup actions
 *   Activity Log — (stub for 5.2) recent dedup_log entries
 *   Exceptions   — (stub for 5.3) blocked merges, LSQ lead conflicts, etc.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GitMerge,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  History,
  ListFilter,
  ShieldAlert,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';

type TabKey = 'queue' | 'log' | 'exceptions';

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
  const [tab, setTab] = useState<TabKey>('queue');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedWinner, setSelectedWinner] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

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

    const confirmed = window.confirm(
      `Merge thread ${loserId.slice(0, 8)} into ${winnerId.slice(0, 8)}?\n\nThis will archive the loser, re-parent all its data to the winner, and post a final system message in the loser's chat channel.`
    );
    if (!confirmed) return;

    setBusyId(c.id);
    try {
      const res = await fetch('/api/admin/dedup/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnerId,
          loserId,
          reason: reasons[c.id] || undefined,
          candidateId: c.id,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Merge failed');
      setToast({
        type: 'success',
        message: `Merged ${data.data.mergedFields?.length || 0} fields, moved ${Object.values(
          data.data.fkCounts || {}
        ).reduce((a: number, b: unknown) => a + Number(b), 0)} FK rows. Channel: ${data.data.channelAction || 'n/a'}`,
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
            onMerge={doMerge}
            onDismiss={doDismiss}
          />
        )}
        {tab === 'log' && <LogTabStub />}
        {tab === 'exceptions' && <ExceptionsTabStub />}
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
  onMerge,
  onDismiss,
}: ReviewQueueTabProps) {
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

        return (
          <div
            key={c.id}
            className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
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
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center gap-3">
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
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-even-blue rounded-lg hover:bg-even-blue/90 disabled:opacity-50"
                  title={`Merge loser ${loserSide.id.slice(0, 8)} into winner ${winnerSide.id.slice(0, 8)}`}
                >
                  <GitMerge size={14} />
                  {busy ? 'Merging…' : 'Merge'}
                </button>
              </div>
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
// Stub tabs (5.2 / 5.3)
// -----------------------------------------------------------------------------

function LogTabStub() {
  return (
    <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
      <History size={32} className="mx-auto text-gray-400 mb-3" />
      <h3 className="text-lg font-semibold text-gray-800">Activity Log</h3>
      <p className="text-sm text-gray-500 mt-1">
        Coming in Phase 5.2 — a filterable audit trail of every dedup decision
        (link, flag, merge, split, ignore) from the `dedup_log` table.
      </p>
    </div>
  );
}

function ExceptionsTabStub() {
  return (
    <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
      <ShieldAlert size={32} className="mx-auto text-gray-400 mb-3" />
      <h3 className="text-lg font-semibold text-gray-800">Exceptions</h3>
      <p className="text-sm text-gray-500 mt-1">
        Coming in Phase 5.3 — merges blocked by LSQ lead conflicts, stage
        regressions, or other guardrails. Action required items surface here.
      </p>
    </div>
  );
}
