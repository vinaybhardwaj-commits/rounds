'use client';

// =============================================================================
// /admin/settings — General app settings (sub-sprint D.2)
//
// Single page that lists every row in app_settings and renders the
// appropriate control per known key. For ot_planning_enabled, a toggle
// switch wired to PATCH /api/admin/settings.
//
// Super_admin gating is enforced at three layers:
//   1. /admin/layout.tsx server-side redirect (D.2)
//   2. Sidebar filter (this entry has requiresRole: 'super_admin')
//   3. /api/admin/settings handler hasRole check (D.1)
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { Settings, Loader2, RefreshCw, AlertCircle, CheckCircle, Stethoscope, ClipboardList } from 'lucide-react';

interface SettingsRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

interface ApiPayload {
  success: boolean;
  data: SettingsRow[];
  error?: string;
}

// Per-key UI metadata. Adding a new flag means: seed in /api/admin/migrate,
// add to MUTABLE_KEYS in /api/admin/settings, add an entry here.
interface KeyMeta {
  label: string;
  helpText: string;
  icon: React.ReactNode;
  controlType: 'toggle';
  groupLabel: string;
}

const KEY_META: Record<string, KeyMeta> = {
  ot_planning_enabled: {
    label: 'OT Planning module',
    helpText: 'When ON, the OT Planning surfaces (patient chart panel, bottom-nav OT tab, /ot-management, /ot-calendar, /equipment-kanban, /anaesthetist-queue, /case/[id]) are visible to all users. When OFF, those surfaces are hidden across the entire app — background data pipelines keep running silently so no data is lost. PAC Workspace is independent of this flag.',
    icon: <Stethoscope size={16} className="text-blue-600" />,
    controlType: 'toggle',
    groupLabel: 'Modules',
  },
  // 2 May 2026 (PCW2.0): PAC Workspace v2 master toggle.
  // Independent of ot_planning_enabled. When OFF, users see the legacy v1
  // workspace. When ON, the new fact-driven orchestration workspace renders.
  pac_workspace_v2_enabled: {
    label: 'PAC Workspace v2 (smart orchestration)',
    helpText: 'When ON, the upgraded PAC Workspace shows fact-driven Smart Suggestions, ASA inference, deadline strip, appointment scheduling, and time-travel resurrection on stale tests. Built per the EHRC Pre-Op Assessment SOP v5. When OFF, users see the original v1 workspace. Independent of OT Planning toggle. Recommended: leave OFF until v2 build is complete.',
    icon: <ClipboardList size={16} className="text-emerald-600" />,
    controlType: 'toggle',
    groupLabel: 'Modules',
  },
};

function coerceBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true';
  if (typeof v === 'number') return v !== 0;
  return false;
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminSettingsPage() {
  const [rows, setRows] = useState<SettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' });
      const body: ApiPayload = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error || `HTTP ${res.status}`);
        setRows([]);
        return;
      }
      setRows(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  };

  const onToggle = async (key: string, nextValue: boolean) => {
    setSavingKey(key);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: nextValue }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        showToast('err', body.error || `HTTP ${res.status}`);
        return;
      }
      showToast('ok', `${KEY_META[key]?.label || key} ${nextValue ? 'enabled' : 'disabled'}`);
      // Optimistic local update + reload to pick up updated_at/updated_by.
      setRows(prev => prev.map(r => r.key === key ? { ...r, value: nextValue } : r));
      load();
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : 'save failed');
    } finally {
      setSavingKey(null);
    }
  };

  // Group rows by metadata.groupLabel; unknown keys land in "Other".
  const groups = (() => {
    const m = new Map<string, SettingsRow[]>();
    for (const r of rows) {
      const meta = KEY_META[r.key];
      const g = meta?.groupLabel || 'Other';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(r);
    }
    return Array.from(m.entries());
  })();

  return (
    <AdminShell activeSection="settings" userRole="super_admin">
      <div className="p-4 max-w-3xl mx-auto">
        <header className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center">
              <Settings size={18} className="text-blue-700" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">General Settings</h1>
              <p className="text-xs text-gray-500">App-wide feature flags and module toggles. Super-admin only.</p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </header>

        {toast && (
          <div className={`mb-4 rounded-lg border p-3 flex items-center gap-2 text-sm ${
            toast.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {toast.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {toast.text}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2 text-sm text-red-800">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Failed to load settings</div>
              <div className="text-xs mt-0.5">{error}</div>
              <div className="text-xs mt-1.5 text-red-700">If you haven&apos;t yet, run <code className="font-mono bg-red-100 px-1 rounded">POST /api/admin/migrate</code> to create the app_settings table.</div>
            </div>
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
            <Loader2 size={20} className="animate-spin inline-block mr-2" />
            Loading settings…
          </div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-8 text-center text-sm text-gray-500">
            No settings found. Run <code className="font-mono bg-white px-1 rounded">POST /api/admin/migrate</code> as super_admin to seed the app_settings table.
          </div>
        )}

        {groups.map(([groupLabel, groupRows]) => (
          <section key={groupLabel} className="mb-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{groupLabel}</h2>
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
              {groupRows.map(row => {
                const meta = KEY_META[row.key];
                const value = coerceBool(row.value);
                const isSaving = savingKey === row.key;
                return (
                  <div key={row.key} className="p-4 flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">{meta?.icon || <Settings size={16} className="text-gray-400" />}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-900">{meta?.label || row.key}</h3>
                        <code className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1 py-0.5 rounded">{row.key}</code>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{meta?.helpText || row.description || '(no description)'}</p>
                      <p className="text-[10px] text-gray-400 mt-2">
                        Last updated {formatTs(row.updated_at)}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={value}
                        disabled={isSaving}
                        onClick={() => onToggle(row.key, !value)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          value ? 'bg-emerald-600' : 'bg-gray-300'
                        } ${isSaving ? 'opacity-60 cursor-wait' : ''}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                            value ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <div className="mt-1 text-[10px] text-center text-gray-500">{value ? 'ON' : 'OFF'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </AdminShell>
  );
}
