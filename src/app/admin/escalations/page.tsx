'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  Clock,
  Play,
  X,
  AlertCircle,
  Filter,
} from 'lucide-react';

interface EscalationEntry {
  id: string;
  source_type: string;
  source_id: string;
  escalated_from_name: string | null;
  escalated_to_name: string | null;
  patient_name: string | null;
  patient_thread_id: string | null;
  reason: string;
  level: number;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

const LEVEL_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: 'bg-amber-100', text: 'text-amber-700' },
  2: { bg: 'bg-orange-100', text: 'text-orange-700' },
  3: { bg: 'bg-red-100', text: 'text-red-700' },
  4: { bg: 'bg-red-200', text: 'text-red-800' },
};

const SOURCE_LABELS: Record<string, string> = {
  readiness_item: 'Readiness Item',
  message: 'Message',
  form_gap: 'Form Gap',
  sla_breach: 'SLA Breach',
  manual: 'Manual',
};

export default function EscalationsPage() {
  const [entries, setEntries] = useState<EscalationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const [runningCron, setRunningCron] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Resolve modal
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (resolvedFilter === 'open') params.set('resolved', 'false');
      if (resolvedFilter === 'resolved') params.set('resolved', 'true');

      const res = await fetch(`/api/escalation/log?${params.toString()}`);
      const data = await res.json();
      if (data.success) setEntries(data.data || []);
    } catch (err) {
      console.error('Failed to fetch escalations:', err);
    } finally {
      setLoading(false);
    }
  }, [resolvedFilter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Run cron manually
  const runCron = async () => {
    setRunningCron(true);
    setMsg(null);
    try {
      const res = await fetch('/api/escalation/cron', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMsg({
          type: 'success',
          text: `Escalation run: ${data.data.escalated} escalated, ${data.data.skipped} skipped (${data.data.processed} total overdue)`,
        });
        fetchEntries();
      } else {
        setMsg({ type: 'error', text: data.error || 'Cron failed' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error running escalation check' });
    } finally {
      setRunningCron(false);
    }
  };

  // Resolve an escalation
  const handleResolve = async () => {
    if (!resolveId) return;
    setResolving(true);
    try {
      const res = await fetch('/api/escalation/log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escalation_id: resolveId,
          resolution_notes: resolveNotes || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: 'Escalation resolved' });
        setResolveId(null);
        setResolveNotes('');
        fetchEntries();
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to resolve' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error' });
    } finally {
      setResolving(false);
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });

  const getLevelStyle = (level: number) =>
    LEVEL_COLORS[Math.min(level, 4)] || LEVEL_COLORS[4];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-even-navy flex items-center gap-2">
            <AlertTriangle size={24} /> Escalation Log
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {entries.length} {resolvedFilter === 'open' ? 'open' : resolvedFilter === 'resolved' ? 'resolved' : 'total'} escalations
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runCron}
            disabled={runningCron}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            <Play size={16} /> {runningCron ? 'Running...' : 'Run Escalation Check'}
          </button>
          <button
            onClick={fetchEntries}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="flex items-center gap-1 text-sm">
          <Filter size={14} className="text-gray-400" />
          {(['open', 'resolved', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setResolvedFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                resolvedFilter === f
                  ? 'bg-even-blue text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      {msg && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-200 rounded-xl">
          <AlertTriangle size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No escalations</p>
          <p className="text-gray-400 text-sm mt-1">
            {resolvedFilter === 'open'
              ? 'No open escalations. Run an escalation check to scan for overdue items.'
              : 'No escalation records match the current filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => {
            const levelStyle = getLevelStyle(entry.level);
            return (
              <div
                key={entry.id}
                className={`bg-white border rounded-xl p-4 transition-colors ${
                  entry.resolved ? 'border-gray-200 opacity-75' : 'border-red-200'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Level + Source badge row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${levelStyle.bg} ${levelStyle.text}`}>
                        Level {entry.level}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {SOURCE_LABELS[entry.source_type] || entry.source_type}
                      </span>
                      {entry.resolved && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          <CheckCircle size={10} /> Resolved
                        </span>
                      )}
                    </div>

                    {/* Reason */}
                    <p className="text-sm text-gray-800 mb-1">{entry.reason}</p>

                    {/* Meta row */}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      {entry.patient_name && (
                        <span>Patient: <span className="font-medium text-gray-700">{entry.patient_name}</span></span>
                      )}
                      {entry.escalated_to_name && (
                        <span>To: <span className="font-medium text-gray-700">{entry.escalated_to_name}</span></span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {formatDate(entry.created_at)}
                      </span>
                    </div>

                    {/* Resolution notes */}
                    {entry.resolved && entry.resolution_notes && (
                      <div className="mt-2 text-xs text-green-700 bg-green-50 px-3 py-1.5 rounded">
                        Resolution: {entry.resolution_notes}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!entry.resolved && (
                    <button
                      onClick={() => { setResolveId(entry.id); setResolveNotes(''); }}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors whitespace-nowrap"
                    >
                      <CheckCircle size={12} /> Resolve
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resolve Modal */}
      {resolveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-even-navy">Resolve Escalation</h2>
              <button onClick={() => setResolveId(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Resolution Notes (optional)</label>
              <textarea
                value={resolveNotes}
                onChange={e => setResolveNotes(e.target.value)}
                placeholder="e.g., Item was completed by Dr. Kumar"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none h-24"
              />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setResolveId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={resolving}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {resolving ? 'Resolving...' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
