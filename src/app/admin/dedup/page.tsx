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

import React, { useState, useEffect, useCallback } from 'react';
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
        {tab === 'log' && <ActivityLogTab active={tab === 'log'} />}
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
// Stub tab (5.3)
// -----------------------------------------------------------------------------

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
