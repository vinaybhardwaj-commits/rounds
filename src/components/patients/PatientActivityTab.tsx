'use client';

// =============================================================================
// PatientActivityTab — per-patient audit timeline (GLASS.10.5)
//
// Mounted as a tab inside PatientDetailView. Visible to every authenticated
// user (per PRD §5.4.B — coordination win: "a billing exec about to discharge
// can see Dr Smith just started a discharge summary 10 min ago").
//
// Minimal columns per PRD §5.4.B: relative timestamp, actor name + role,
// human-readable action label, summary. NO payload-diff drilldown — that
// stays super_admin-only via /admin/audit-log.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ShieldCheck, RefreshCw } from 'lucide-react';

interface ActivityRow {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  source: string;
}

// Human-readable labels for the dotted actions. Anything not in the map renders
// as the raw dotted string.
const ACTION_LABELS: Record<string, string> = {
  'patient.create': 'Created patient',
  'patient.update_field': 'Updated patient',
  'patient.discharge': 'Discharged patient',
  'patient.archive': 'Archived patient',
  'patient.unarchive': 'Restored patient',
  'patient.stage_advance': 'Advanced stage',
  'patient.discharge.undo': 'Undid discharge',
  'patient.archive.undo': 'Undid archive',
  'patient.stage_advance.undo': 'Undid stage advance',
  'case.create': 'Created surgical case',
  'case.transition': 'Case state changed',
  'case.cancel': 'Cancelled case',
  'case.cancel.undo': 'Undid case cancellation',
  'case.book_ot': 'Booked OT slot',
  'case.book_ot.undo': 'Freed OT slot',
  'pac.schedule': 'Scheduled PAC',
  'pac.publish_outcome': 'Published PAC outcome',
  'pac.publish_outcome.undo': 'Reset PAC outcome',
  'form.submit': 'Submitted form',
  'task.create': 'Created task',
  'task.acknowledge': 'Acknowledged task',
  'task.start': 'Started task',
  'task.complete': 'Completed task',
  'task.cancel': 'Cancelled task',
  'equipment.request_create': 'Requested equipment',
  'equipment.request_update': 'Updated equipment request',
  'admin.manual_recovery': 'Super-admin recovery',
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

function sourceColor(source: string): string {
  switch (source) {
    case 'cron': return 'text-purple-600 bg-purple-50';
    case 'system': return 'text-gray-500 bg-gray-50';
    case 'admin_console': return 'text-amber-700 bg-amber-50';
    default: return 'text-gray-500 bg-gray-50';
  }
}

export function PatientActivityTab({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/audit?limit=50`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error || `HTTP ${res.status}`);
        setRows([]);
        return;
      }
      setRows(body.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <ShieldCheck size={14} className="text-even-blue" />
              Activity timeline
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Every action taken on this patient. 7-year retention. {rows.length} recent event{rows.length === 1 ? '' : 's'}.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 rounded-md bg-white border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
          </button>
        </header>

        {error && (
          <div className="bg-red-50 text-red-700 text-xs rounded p-2 mb-3">Error: {error}</div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No activity recorded yet for this patient.
          </div>
        )}

        <ol className="space-y-2">
          {rows.map(r => {
            const isUndo = r.action.endsWith('.undo');
            return (
              <li
                key={r.id}
                className={`bg-white border rounded-md p-3 ${isUndo ? 'border-amber-200' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-gray-900">{actionLabel(r.action)}</span>
                      {isUndo && (
                        <span className="text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1 py-0.5 rounded">undo</span>
                      )}
                      {r.source !== 'api' && (
                        <span className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded ${sourceColor(r.source)}`}>{r.source}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 mt-1 line-clamp-2">{r.summary}</p>
                    <div className="text-[10px] text-gray-500 mt-1">
                      <span className="font-medium text-gray-700">{r.actor_name || 'system'}</span>
                      {r.actor_role && <span> · {r.actor_role}</span>}
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap" title={r.ts}>
                    {formatRelative(r.ts)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {rows.length >= 50 && (
          <p className="text-[11px] text-gray-400 text-center mt-3">
            Showing latest 50 events. Older events are in the audit log (super_admin).
          </p>
        )}
      </div>
    </div>
  );
}
