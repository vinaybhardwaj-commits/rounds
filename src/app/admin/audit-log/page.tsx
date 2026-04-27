'use client';

// =============================================================================
// /admin/audit-log — super_admin audit-log viewer (GLASS.10)
//
// Per PRD §5.4.A. Filterable table with payload diff drawer. Lives under
// AdminShell so it inherits the HealthBar + sidebar.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { ShieldCheck, RefreshCw, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface AuditRow {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  hospital_id: string | null;
  hospital_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  payload_before: Record<string, unknown> | null;
  payload_after: Record<string, unknown> | null;
  source: string;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
}

interface ApiPayload {
  success: boolean;
  data: AuditRow[];
  total: number;
  limit: number;
  offset: number;
  window: { from_ts: string; to_ts: string };
  error?: string;
}

const COMMON_ACTIONS = [
  'patient.create', 'patient.update_field', 'patient.discharge', 'patient.archive',
  'patient.stage_advance',
  'case.create', 'case.transition', 'case.cancel', 'case.book_ot',
  'pac.schedule', 'pac.publish_outcome',
  'form.submit',
  'task.create', 'task.acknowledge', 'task.start', 'task.complete', 'task.cancel',
  'equipment.request_create', 'equipment.request_update',
];

const PRESET_RANGES = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
];

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function ActionPill({ action }: { action: string }) {
  const isUndo = action.endsWith('.undo');
  const cls = isUndo
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-blue-50 text-blue-800 border-blue-200';
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-mono ${cls}`}>
      {action}
    </span>
  );
}

export default function AdminAuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<AuditRow | null>(null);

  // Filters
  const [hours, setHours] = useState(24 * 7);
  const [action, setAction] = useState('');
  const [actionPrefix, setActionPrefix] = useState('');
  const [targetType, setTargetType] = useState('');
  const [q, setQ] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromTs = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const params = new URLSearchParams();
      params.set('from_ts', fromTs);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (action) params.set('action', action);
      if (actionPrefix) params.set('action_prefix', actionPrefix);
      if (targetType) params.set('target_type', targetType);
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/audit-log?${params.toString()}`, { cache: 'no-store' });
      const body: ApiPayload = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error || `HTTP ${res.status}`);
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(body.data);
      setTotal(body.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [hours, action, actionPrefix, targetType, q, limit, offset]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <AdminShell activeSection="audit-log">
      <div className="p-4 max-w-7xl mx-auto">
        <header className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <ShieldCheck size={20} className="text-even-blue" />
              Audit Log
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Every clinical mutation in Rounds. 7-year retention. {total.toLocaleString('en-IN')} rows match current filter.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setOffset(0); load(); }}
            className="inline-flex items-center gap-1 rounded-md bg-white border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </header>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Window</label>
            <div className="flex gap-1">
              {PRESET_RANGES.map(p => (
                <button
                  key={p.hours}
                  type="button"
                  onClick={() => { setHours(p.hours); setOffset(0); }}
                  className={`px-2 py-1 text-xs rounded border ${hours === p.hours ? 'bg-even-blue/10 text-even-blue border-even-blue' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Action</label>
            <select
              value={action}
              onChange={e => { setAction(e.target.value); setOffset(0); }}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1"
            >
              <option value="">— any —</option>
              {COMMON_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Domain</label>
            <select
              value={actionPrefix}
              onChange={e => { setActionPrefix(e.target.value); setOffset(0); }}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1"
            >
              <option value="">— any —</option>
              <option value="patient">patient.*</option>
              <option value="case">case.*</option>
              <option value="pac">pac.*</option>
              <option value="form">form.*</option>
              <option value="task">task.*</option>
              <option value="equipment">equipment.*</option>
              <option value="admin">admin.*</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Target type</label>
            <input
              type="text"
              value={targetType}
              onChange={e => { setTargetType(e.target.value); setOffset(0); }}
              placeholder="e.g. patient_thread"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Search summary</label>
            <input
              type="text"
              value={q}
              onChange={e => { setQ(e.target.value); setOffset(0); }}
              placeholder="text in summary"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1"
            />
          </div>
        </div>

        {/* Table */}
        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded p-2 mb-3">Error: {error}</div>
        )}
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-left px-3 py-2">Summary</th>
                <th className="text-left px-3 py-2">Hospital</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-gray-400"><Loader2 size={16} className="animate-spin inline" /> loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-gray-400">No rows match the current filter.</td></tr>
              )}
              {rows.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setDrawer(r)}
                  className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                >
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600">{formatTs(r.ts)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <div className="font-medium text-gray-900">{r.actor_name || <span className="text-gray-400 italic">system</span>}</div>
                    {r.actor_role && <div className="text-[10px] text-gray-500">{r.actor_role}</div>}
                  </td>
                  <td className="px-3 py-2"><ActionPill action={r.action} /></td>
                  <td className="px-3 py-2 text-xs">
                    <div className="text-gray-700">{r.target_type}</div>
                    {r.target_id && <div className="text-[10px] text-gray-400 font-mono">{r.target_id.slice(0, 8)}…</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 max-w-md truncate">{r.summary}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.hospital_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <div>Page {currentPage} of {totalPages.toLocaleString('en-IN')}</div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="inline-flex items-center gap-1 px-2 py-1 border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50"
            >
              <ChevronLeft size={12} /> Prev
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + limit)}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 px-2 py-1 border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50"
            >
              Next <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {/* Diff drawer */}
        {drawer && (
          <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-black/40" onClick={() => setDrawer(null)} />
            <aside className="w-full max-w-2xl bg-white shadow-2xl overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500">{formatTs(drawer.ts)}</div>
                  <div className="font-medium text-gray-900 text-sm mt-0.5">
                    <ActionPill action={drawer.action} />
                    <span className="ml-2">{drawer.summary}</span>
                  </div>
                </div>
                <button type="button" onClick={() => setDrawer(null)} className="text-gray-400 hover:text-gray-600 p-1">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-4 text-xs">
                <DefBlock label="Audit ID" value={drawer.id} mono />
                <DefBlock label="Actor" value={drawer.actor_name ? `${drawer.actor_name} (${drawer.actor_role || 'no role'})` : 'system'} />
                <DefBlock label="Hospital" value={drawer.hospital_name || '—'} />
                <DefBlock label="Target" value={`${drawer.target_type} / ${drawer.target_id || '—'}`} mono />
                <DefBlock label="Source" value={drawer.source} />
                {drawer.request_id && <DefBlock label="Request ID" value={drawer.request_id} mono />}
                {drawer.ip && <DefBlock label="IP" value={drawer.ip} mono />}
                {drawer.user_agent && <DefBlock label="User agent" value={drawer.user_agent} mono />}

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Payload before</div>
                  <pre className="bg-gray-50 text-gray-800 p-2 rounded text-[11px] overflow-x-auto">{drawer.payload_before ? JSON.stringify(drawer.payload_before, null, 2) : 'null'}</pre>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Payload after</div>
                  <pre className="bg-gray-50 text-gray-800 p-2 rounded text-[11px] overflow-x-auto">{drawer.payload_after ? JSON.stringify(drawer.payload_after, null, 2) : 'null'}</pre>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function DefBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">{label}</div>
      <div className={`text-gray-800 ${mono ? 'font-mono text-[11px] break-all' : ''}`}>{value}</div>
    </div>
  );
}
