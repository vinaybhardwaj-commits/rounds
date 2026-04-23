'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, CheckCircle2, Clock, ArrowRight,
  ChevronDown, ChevronUp, Zap, Timer, Users, Activity,
  Play, Loader2, XCircle, Info
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';

// ============================================
// Types
// ============================================

interface Summary {
  lastSync: {
    id: string; sync_type: string; trigger_stage: string;
    leads_created: number; leads_updated: number; leads_skipped: number;
    errors: string | null; completed_at: string; duration_ms: number;
  } | null;
  totalLsqPatients: number;
  todayApiCalls: number;
  todayApiErrors: number;
  patientsByStage: { current_stage: string; count: string }[];
}

interface SyncRun {
  id: string; sync_type: string; trigger_stage: string | null;
  leads_found: number; leads_created: number; leads_updated: number; leads_skipped: number;
  errors: string | null; started_at: string; completed_at: string | null; duration_ms: number | null;
}

interface ApiCall {
  id: string; endpoint: string; method: string;
  request_body: string | null; response_status: number;
  response_body: string | null; error_message: string | null;
  duration_ms: number; sync_run_id: string | null;
  lead_id: string | null; call_type: string; created_at: string;
}

// ============================================
// Component
// ============================================

export default function LeadSquaredAdmin() {
  const [tab, setTab] = useState<'overview' | 'sync_runs' | 'api_calls'>('overview');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);
  const [syncTotal, setSyncTotal] = useState(0);
  const [apiTotal, setApiTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [expandedSync, setExpandedSync] = useState<string | null>(null);
  const [expandedApi, setExpandedApi] = useState<string | null>(null);
  const [filterSyncRunId, setFilterSyncRunId] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);

  // ---- Data Loading ----
  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/leadsquared?view=summary');
      const data = await res.json();
      if (data.success) setSummary(data.summary);
    } catch { /* silently fail */ }
  }, []);

  const loadSyncRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/leadsquared?view=sync_runs&limit=30');
      const data = await res.json();
      if (data.success) { setSyncRuns(data.logs); setSyncTotal(data.total); }
    } catch { /* silently fail */ }
  }, []);

  const loadApiCalls = useCallback(async () => {
    try {
      let url = '/api/admin/leadsquared?view=api_calls&limit=50';
      if (filterSyncRunId) url += `&sync_run_id=${filterSyncRunId}`;
      if (onlyErrors) url += '&only_errors=true';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) { setApiCalls(data.logs); setApiTotal(data.total); }
    } catch { /* silently fail */ }
  }, [filterSyncRunId, onlyErrors]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSummary(), loadSyncRuns(), loadApiCalls()]).finally(() => setLoading(false));
  }, [loadSummary, loadSyncRuns, loadApiCalls]);

  // ---- Manual Sync Trigger ----
  const triggerSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/leadsquared/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrichFromActivities: true }),
      });
      const data = await res.json();
      if (data.success) {
        const results = data.results || [];
        const created = results.reduce((s: number, r: { leadsCreated?: number }) => s + (r.leadsCreated || 0), 0);
        const updated = results.reduce((s: number, r: { leadsUpdated?: number }) => s + (r.leadsUpdated || 0), 0);
        const errors = results.reduce((s: number, r: { errors?: string[] }) => s + (r.errors?.length || 0), 0);
        setSyncResult(`Sync complete: ${created} created, ${updated} updated, ${errors} errors`);
      } else {
        setSyncResult(`Sync failed: ${data.error || 'Unknown error'}`);
      }
      // Refresh all data
      await Promise.all([loadSummary(), loadSyncRuns(), loadApiCalls()]);
    } catch (err) {
      setSyncResult(`Sync failed: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  // ---- Helpers ----
  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const statusBadge = (status: number) => {
    if (status === 0) return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-mono">NET ERR</span>;
    if (status >= 200 && status < 300) return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-mono">{status}</span>;
    if (status >= 400) return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-mono">{status}</span>;
    return <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-mono">{status}</span>;
  };

  const syncTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      webhook: 'bg-purple-100 text-purple-700',
      poll: 'bg-blue-100 text-blue-700',
      manual: 'bg-teal-100 text-teal-700',
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[type] || 'bg-gray-100 text-gray-700'}`}>{type}</span>;
  };

  const callTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      get_lead: 'bg-blue-50 text-blue-700',
      search_leads: 'bg-indigo-50 text-indigo-700',
      get_activities: 'bg-orange-50 text-orange-700',
      webhook_receive: 'bg-purple-50 text-purple-700',
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-mono ${colors[type] || 'bg-gray-50 text-gray-700'}`}>{type.replace('_', ' ')}</span>;
  };

  if (loading) {
    return (
      <AdminLayout breadcrumbs={[{ label: 'Admin Dashboard', href: '/admin' }, { label: 'LeadSquared' }]}>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="animate-spin text-even-blue" size={32} />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout breadcrumbs={[{ label: 'Admin Dashboard', href: '/admin' }, { label: 'LeadSquared Integration' }]}>
      <div className="p-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">LeadSquared Integration</h1>
            <p className="text-sm text-gray-500 mt-1">Sync logs, API call traceability, and patient import status</p>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-even-blue text-white rounded-lg hover:bg-even-navy transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {syncing ? 'Syncing...' : 'Manual Sync'}
          </button>
        </div>

        {/* Sync Result Banner */}
        {syncResult && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${syncResult.includes('failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {syncResult}
          </div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users size={18} className="text-even-blue" />
                <span className="text-xs text-gray-500">LSQ Patients</span>
              </div>
              <div className="text-2xl font-bold text-even-navy">{summary.totalLsqPatients}</div>
              {summary.patientsByStage.length > 0 && (
                <div className="mt-2 space-y-1">
                  {summary.patientsByStage.map(s => (
                    <div key={s.current_stage} className="flex justify-between text-xs text-gray-500">
                      <span>{s.current_stage}</span>
                      <span className="font-medium">{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={18} className="text-blue-500" />
                <span className="text-xs text-gray-500">API Calls (24h)</span>
              </div>
              <div className="text-2xl font-bold text-even-navy">{summary.todayApiCalls}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={18} className="text-red-500" />
                <span className="text-xs text-gray-500">Errors (24h)</span>
              </div>
              <div className="text-2xl font-bold text-red-600">{summary.todayApiErrors}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={18} className="text-teal-500" />
                <span className="text-xs text-gray-500">Last Sync</span>
              </div>
              <div className="text-sm font-medium text-even-navy">
                {summary.lastSync ? fmtDate(summary.lastSync.completed_at) : 'Never'}
              </div>
              {summary.lastSync && (
                <div className="mt-1 text-xs text-gray-500">
                  {summary.lastSync.leads_created} created, {summary.lastSync.leads_updated} updated
                  {summary.lastSync.duration_ms ? ` (${summary.lastSync.duration_ms}ms)` : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          {(['overview', 'sync_runs', 'api_calls'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); if (t === 'api_calls') { setFilterSyncRunId(null); setOnlyErrors(false); } }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t ? 'bg-white text-even-navy shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'overview' ? 'Overview' : t === 'sync_runs' ? `Sync Runs (${syncTotal})` : `API Calls (${apiTotal})`}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {tab === 'overview' && (
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-even-navy mb-4">How It Works</h2>
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-start gap-3">
                <Zap size={16} className="text-purple-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-gray-800">Webhook (Real-time)</span> — When a lead's stage changes to OPD WIN or IPD WIN in LeadSquared, their webhook sends a notification to Rounds. The lead is fetched, enriched with activity history, and inserted as a patient.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Timer size={16} className="text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-gray-800">Polling (Every 15 min)</span> — A Vercel cron job searches LeadSquared for all OPD WIN and IPD WIN leads and syncs any that are new or updated since the last poll.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Play size={16} className="text-teal-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-gray-800">Manual Sync</span> — Click the button above to trigger an immediate full sync. Useful after initial setup or if you suspect data is out of date.
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-2">
                <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Stage Mapping</p>
                  <p>OPD WIN leads enter Rounds at the <strong>OPD</strong> stage. IPD WIN leads enter at the <strong>Pre-Admission</strong> stage. If a lead progresses from OPD WIN to IPD WIN, their stage is automatically updated.</p>
                </div>
              </div>
            </div>

            <h3 className="text-base font-semibold text-even-navy mt-6 mb-3">Recent Sync Activity</h3>
            {syncRuns.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No sync runs yet. Click "Manual Sync" to run the first one.</p>
            ) : (
              <div className="space-y-2">
                {syncRuns.slice(0, 5).map(run => (
                  <div key={run.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-sm">
                    {syncTypeBadge(run.sync_type)}
                    <span className="text-gray-600">{run.trigger_stage || 'All'}</span>
                    <ArrowRight size={14} className="text-gray-300" />
                    <span className="text-green-600 font-medium">{run.leads_created} new</span>
                    <span className="text-blue-600">{run.leads_updated} updated</span>
                    {run.errors && JSON.parse(run.errors).length > 0 && (
                      <span className="text-red-600">{JSON.parse(run.errors).length} errors</span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">{fmtDate(run.started_at)}</span>
                    {run.duration_ms && <span className="text-xs text-gray-400">{run.duration_ms}ms</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sync Runs Tab */}
        {tab === 'sync_runs' && (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="divide-y divide-gray-100">
              {syncRuns.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No sync runs recorded yet.</div>
              ) : syncRuns.map(run => {
                const hasErrors = run.errors && JSON.parse(run.errors).length > 0;
                const isExpanded = expandedSync === run.id;
                return (
                  <div key={run.id}>
                    <button
                      onClick={() => setExpandedSync(isExpanded ? null : run.id)}
                      className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 text-left transition-colors"
                    >
                      {hasErrors
                        ? <XCircle size={18} className="text-red-500 shrink-0" />
                        : run.completed_at
                        ? <CheckCircle2 size={18} className="text-green-500 shrink-0" />
                        : <Loader2 size={18} className="text-blue-500 animate-spin shrink-0" />
                      }
                      {syncTypeBadge(run.sync_type)}
                      <span className="text-sm text-gray-700 font-medium">{run.trigger_stage || 'All Stages'}</span>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{run.leads_found} found</span>
                        <span className="text-green-600">{run.leads_created} new</span>
                        <span className="text-blue-600">{run.leads_updated} upd</span>
                        <span className="text-gray-400">{run.leads_skipped} skip</span>
                        {hasErrors && <span className="text-red-600">{JSON.parse(run.errors!).length} err</span>}
                      </div>
                      <span className="ml-auto text-xs text-gray-400">{fmtDate(run.started_at)}</span>
                      {run.duration_ms !== null && <span className="text-xs text-gray-400">{run.duration_ms}ms</span>}
                      {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 bg-gray-50">
                        <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                          <div><span className="text-gray-500">ID:</span> <span className="font-mono">{run.id.slice(0, 8)}</span></div>
                          <div><span className="text-gray-500">Completed:</span> {fmtDate(run.completed_at)}</div>
                        </div>
                        {hasErrors && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-red-600 mb-1">Errors:</p>
                            <div className="bg-red-50 rounded p-2 text-xs text-red-700 max-h-40 overflow-y-auto">
                              {JSON.parse(run.errors!).map((e: string, i: number) => (
                                <div key={i} className="mb-1">{e}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            setFilterSyncRunId(run.id);
                            setTab('api_calls');
                            loadApiCalls();
                          }}
                          className="text-xs text-even-blue hover:underline flex items-center gap-1"
                        >
                          View API calls for this sync run <ArrowRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* API Calls Tab */}
        {tab === 'api_calls' && (
          <div>
            {/* Filters */}
            <div className="flex items-center gap-3 mb-3 text-sm">
              {filterSyncRunId && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full">
                  <span>Sync run: {filterSyncRunId.slice(0, 8)}...</span>
                  <button onClick={() => { setFilterSyncRunId(null); }} className="hover:text-blue-900">&times;</button>
                </div>
              )}
              <label className="flex items-center gap-2 text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyErrors}
                  onChange={e => setOnlyErrors(e.target.checked)}
                  className="rounded"
                />
                Errors only
              </label>
              <button
                onClick={loadApiCalls}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
              >
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="divide-y divide-gray-100">
                {apiCalls.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">No API calls recorded yet.</div>
                ) : apiCalls.map(call => {
                  const isError = call.response_status >= 400 || !!call.error_message;
                  const isExpanded = expandedApi === call.id;
                  return (
                    <div key={call.id}>
                      <button
                        onClick={() => setExpandedApi(isExpanded ? null : call.id)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 text-left transition-colors"
                      >
                        {statusBadge(call.response_status)}
                        <span className="text-xs font-mono text-gray-600">{call.method}</span>
                        <span className="text-xs text-gray-700 truncate max-w-xs">{call.endpoint}</span>
                        {callTypeBadge(call.call_type)}
                        {call.lead_id && (
                          <span className="text-xs text-gray-400 font-mono truncate max-w-[80px]" title={call.lead_id}>
                            {call.lead_id.slice(0, 8)}...
                          </span>
                        )}
                        <span className="ml-auto text-xs text-gray-400">{call.duration_ms}ms</span>
                        <span className="text-xs text-gray-400">{fmtDate(call.created_at)}</span>
                        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 bg-gray-50 space-y-3">
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div><span className="text-gray-500">ID:</span> <span className="font-mono">{call.id.slice(0, 8)}</span></div>
                            <div><span className="text-gray-500">Lead ID:</span> <span className="font-mono">{call.lead_id || '—'}</span></div>
                            {call.sync_run_id && (
                              <div><span className="text-gray-500">Sync Run:</span> <span className="font-mono">{call.sync_run_id.slice(0, 8)}</span></div>
                            )}
                          </div>
                          {call.request_body && (
                            <div>
                              <p className="text-xs font-medium text-gray-600 mb-1">Request Body:</p>
                              <pre className="bg-gray-100 rounded p-2 text-xs overflow-x-auto max-h-32">
                                {JSON.stringify(JSON.parse(call.request_body), null, 2)}
                              </pre>
                            </div>
                          )}
                          {call.response_body && (
                            <div>
                              <p className="text-xs font-medium text-gray-600 mb-1">Response Body:</p>
                              <pre className="bg-gray-100 rounded p-2 text-xs overflow-x-auto max-h-32">
                                {JSON.stringify(JSON.parse(call.response_body), null, 2)}
                              </pre>
                            </div>
                          )}
                          {call.error_message && (
                            <div>
                              <p className="text-xs font-medium text-red-600 mb-1">Error:</p>
                              <div className="bg-red-50 rounded p-2 text-xs text-red-700">{call.error_message}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
