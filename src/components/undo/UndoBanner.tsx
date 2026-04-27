'use client';

// =============================================================================
// UndoBanner — top-of-app banner showing the user's recent undoable actions
//
// GLASS.9 per PRD §6.2: each guaranteed-mode action's success creates a
// 24h-window banner. Banner is per-user (only the actor sees their own undos).
//
// Polls GET /api/undo/recent on mount. Shows up to 5 chips with countdown.
// Click → POST /api/undo/[id] → on success, drops the chip + briefly shows
// the "undone" toast.
//
// Telemetry: glass.undo_used fires on Undo click (success path).
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { Undo2, X } from 'lucide-react';
import { trackFeature } from '@/lib/session-tracker';

interface UndoableRow {
  id: string;
  action: string;
  summary: string;
  ts: string;
  expires_at: string;
  target_type: string;
  target_id: string | null;
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hours}h ${remMins}m left` : `${hours}h left`;
}

export function UndoBanner() {
  const [rows, setRows] = useState<UndoableRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);  // forces countdown re-render every 30s
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/undo/recent', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.success && Array.isArray(body.data)) {
        setRows(body.data);
      }
    } catch {
      // non-fatal — banner just stays empty
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);  // refresh every 60s
    return () => clearInterval(interval);
  }, [load]);

  // Re-render countdown every 30s without re-fetching
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const handleUndo = useCallback(async (row: UndoableRow) => {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/undo/${row.id}`, { method: 'POST' });
      const body = await res.json();
      if (body?.success) {
        trackFeature('glass.undo_used', { action: row.action, age_ms: Date.now() - new Date(row.ts).getTime() });
        setRows(prev => prev.filter(r => r.id !== row.id));
      } else {
        // surface error inline; user can still click X to dismiss
        alert(`Undo failed: ${body?.error || 'unknown error'}`);
      }
    } catch (e) {
      alert(`Undo failed: ${e instanceof Error ? e.message : 'network error'}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const visible = rows.filter(r => !dismissed.has(r.id));

  if (visible.length === 0) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-5xl mx-auto px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold mr-1">
          Undo
        </span>
        {visible.map(row => {
          const remaining = formatRemaining(row.expires_at);
          const isExpired = remaining === 'expired';
          return (
            <div
              key={row.id}
              className={`inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-xs ${
                isExpired ? 'border-gray-200 text-gray-400' : 'border-amber-300 text-amber-900'
              }`}
            >
              <span className="truncate max-w-[280px]" title={row.summary}>{row.summary}</span>
              <span className="text-[10px] text-gray-500">· {remaining}</span>
              {!isExpired && (
                <button
                  type="button"
                  onClick={() => handleUndo(row)}
                  disabled={busy === row.id}
                  className="inline-flex items-center gap-0.5 ml-1 rounded bg-amber-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  title="Undo this action"
                >
                  <Undo2 size={11} />
                  {busy === row.id ? '…' : 'Undo'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDismissed(s => { const n = new Set(s); n.add(row.id); return n; })}
                className="ml-0.5 text-gray-400 hover:text-gray-600"
                title="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
