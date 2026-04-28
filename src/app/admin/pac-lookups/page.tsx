'use client';

// =============================================================================
// /admin/pac-lookups — super_admin CRUD for PAC Workspace lookup tables.
// PRD D6 + D7 — admin-editable order types + clearance specialties.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, AlertCircle, Save } from 'lucide-react';

interface OrderType {
  code: string;
  label: string;
  category: string | null;
  sop_default_for_asa: number[] | null;
  sop_default_for_mode: string[] | null;
  active: boolean;
  hospital_id: string | null;
}

interface ClearanceSpecialty {
  code: string;
  label: string;
  default_assignee_role: string;
  sop_trigger_comorbidities: string[] | null;
  active: boolean;
  hospital_id: string | null;
}

type Tab = 'orders' | 'clearances';

export default function AdminPacLookupsPage() {
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/admin" className="text-sm text-indigo-600 hover:text-indigo-700">← Admin</a>
          <span className="text-gray-300">·</span>
          <h1 className="text-base font-semibold text-gray-800">PAC Workspace lookups</h1>
        </div>
        <div className="max-w-5xl mx-auto px-4 flex gap-1 border-t border-gray-100">
          {[
            { id: 'orders', label: 'Order types' },
            { id: 'clearances', label: 'Clearance specialties' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as Tab)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                tab === t.id ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="max-w-5xl mx-auto p-4">
        {tab === 'orders' ? <OrderTypesTab /> : <ClearanceSpecialtiesTab />}
      </div>
    </main>
  );
}

// =============================================================================
// Order types tab
// =============================================================================

function OrderTypesTab() {
  const [rows, setRows] = useState<OrderType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newRow, setNewRow] = useState<Partial<OrderType>>({ active: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pac-lookups/order-types', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.data as OrderType[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patchRow = useCallback(
    async (code: string, patch: Partial<OrderType>) => {
      setSaving(code);
      setError(null);
      try {
        const res = await fetch('/api/admin/pac-lookups/order-types', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, ...patch }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        setRows((prev) => prev.map((r) => (r.code === code ? (json.data as OrderType) : r)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  const createRow = useCallback(async () => {
    if (!newRow.code || !newRow.label) {
      setError('code and label required');
      return;
    }
    setSaving('__new__');
    setError(null);
    try {
      const res = await fetch('/api/admin/pac-lookups/order-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRow),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setRows((prev) => [...prev, json.data as OrderType]);
      setNewRow({ active: true });
      setShowNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }, [newRow]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {error && <ErrorBar message={error} />}
      <header className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Order types ({rows.length})</h2>
        <button
          type="button"
          onClick={() => setShowNew(!showNew)}
          className="ml-auto text-xs bg-indigo-600 text-white px-3 py-1.5 rounded inline-flex items-center gap-1 hover:bg-indigo-700"
        >
          <Plus size={12} /> Add type
        </button>
      </header>

      {showNew && (
        <div className="bg-white border border-indigo-200 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <input
            placeholder="code (snake_case)"
            value={newRow.code ?? ''}
            onChange={(e) => setNewRow({ ...newRow, code: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1"
          />
          <input
            placeholder="label"
            value={newRow.label ?? ''}
            onChange={(e) => setNewRow({ ...newRow, label: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1"
          />
          <input
            placeholder="category (haematology, biochem, ...)"
            value={newRow.category ?? ''}
            onChange={(e) => setNewRow({ ...newRow, category: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1"
          />
          <input
            placeholder="ASA defaults (e.g. 1,2,3)"
            value={(newRow.sop_default_for_asa ?? []).join(',')}
            onChange={(e) =>
              setNewRow({
                ...newRow,
                sop_default_for_asa: e.target.value
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
              })
            }
            className="border border-gray-200 rounded px-2 py-1"
          />
          <button
            type="button"
            disabled={saving === '__new__'}
            onClick={createRow}
            className="bg-indigo-600 text-white px-3 py-1 rounded inline-flex items-center justify-center gap-1 disabled:opacity-50 sm:col-span-1"
          >
            <Save size={12} /> Save
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {rows.map((r) => (
          <div key={r.code} className="px-3 py-2 grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs items-center">
            <code className="sm:col-span-2 text-gray-500 truncate">{r.code}</code>
            <input
              defaultValue={r.label}
              onBlur={(e) => e.target.value !== r.label && patchRow(r.code, { label: e.target.value })}
              className="sm:col-span-3 border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded px-1 py-0.5"
            />
            <input
              defaultValue={r.category ?? ''}
              onBlur={(e) => (e.target.value || '') !== (r.category || '') && patchRow(r.code, { category: e.target.value || null })}
              className="sm:col-span-2 border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded px-1 py-0.5"
              placeholder="(no category)"
            />
            <input
              defaultValue={(r.sop_default_for_asa ?? []).join(',')}
              onBlur={(e) => {
                const arr = e.target.value
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
                const cur = (r.sop_default_for_asa ?? []).join(',');
                if (arr.join(',') !== cur) patchRow(r.code, { sop_default_for_asa: arr.length ? arr : null });
              }}
              className="sm:col-span-2 border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded px-1 py-0.5"
              placeholder="ASA defaults"
            />
            <label className="sm:col-span-2 inline-flex items-center gap-1.5 text-gray-600">
              <input
                type="checkbox"
                checked={r.active}
                onChange={(e) => patchRow(r.code, { active: e.target.checked })}
              />
              {r.active ? 'active' : 'inactive'}
            </label>
            <span className="sm:col-span-1 text-right text-[10px] text-gray-400">
              {saving === r.code ? <Loader2 size={10} className="inline-block animate-spin" /> : ' '}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="px-3 py-4 text-xs text-gray-400">No order types defined.</p>}
      </div>
    </div>
  );
}

// =============================================================================
// Clearance specialties tab
// =============================================================================

function ClearanceSpecialtiesTab() {
  const [rows, setRows] = useState<ClearanceSpecialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newRow, setNewRow] = useState<Partial<ClearanceSpecialty>>({ active: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pac-lookups/clearance-specialties', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.data as ClearanceSpecialty[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patchRow = useCallback(
    async (code: string, patch: Partial<ClearanceSpecialty>) => {
      setSaving(code);
      setError(null);
      try {
        const res = await fetch('/api/admin/pac-lookups/clearance-specialties', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, ...patch }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        setRows((prev) => prev.map((r) => (r.code === code ? (json.data as ClearanceSpecialty) : r)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  const createRow = useCallback(async () => {
    if (!newRow.code || !newRow.label) {
      setError('code and label required');
      return;
    }
    setSaving('__new__');
    setError(null);
    try {
      const res = await fetch('/api/admin/pac-lookups/clearance-specialties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRow),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setRows((prev) => [...prev, json.data as ClearanceSpecialty]);
      setNewRow({ active: true });
      setShowNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }, [newRow]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {error && <ErrorBar message={error} />}
      <header className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Clearance specialties ({rows.length})</h2>
        <button
          type="button"
          onClick={() => setShowNew(!showNew)}
          className="ml-auto text-xs bg-indigo-600 text-white px-3 py-1.5 rounded inline-flex items-center gap-1 hover:bg-indigo-700"
        >
          <Plus size={12} /> Add specialty
        </button>
      </header>

      {showNew && (
        <div className="bg-white border border-indigo-200 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <input
            placeholder="code (snake_case)"
            value={newRow.code ?? ''}
            onChange={(e) => setNewRow({ ...newRow, code: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1"
          />
          <input
            placeholder="label"
            value={newRow.label ?? ''}
            onChange={(e) => setNewRow({ ...newRow, label: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1"
          />
          <input
            placeholder="default assignee role"
            value={newRow.default_assignee_role ?? 'specialist'}
            onChange={(e) => setNewRow({ ...newRow, default_assignee_role: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1"
          />
          <input
            placeholder="trigger comorbidities (comma-sep snake_case)"
            value={(newRow.sop_trigger_comorbidities ?? []).join(',')}
            onChange={(e) =>
              setNewRow({
                ...newRow,
                sop_trigger_comorbidities: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })
            }
            className="border border-gray-200 rounded px-2 py-1 sm:col-span-2"
          />
          <button
            type="button"
            disabled={saving === '__new__'}
            onClick={createRow}
            className="bg-indigo-600 text-white px-3 py-1 rounded inline-flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <Save size={12} /> Save
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {rows.map((r) => (
          <div key={r.code} className="px-3 py-2 grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs items-center">
            <code className="sm:col-span-2 text-gray-500 truncate">{r.code}</code>
            <input
              defaultValue={r.label}
              onBlur={(e) => e.target.value !== r.label && patchRow(r.code, { label: e.target.value })}
              className="sm:col-span-3 border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded px-1 py-0.5"
            />
            <input
              defaultValue={r.default_assignee_role}
              onBlur={(e) => e.target.value !== r.default_assignee_role && patchRow(r.code, { default_assignee_role: e.target.value })}
              className="sm:col-span-2 border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded px-1 py-0.5"
            />
            <input
              defaultValue={(r.sop_trigger_comorbidities ?? []).join(',')}
              onBlur={(e) => {
                const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                const cur = (r.sop_trigger_comorbidities ?? []).join(',');
                if (arr.join(',') !== cur) patchRow(r.code, { sop_trigger_comorbidities: arr });
              }}
              className="sm:col-span-3 border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded px-1 py-0.5"
              placeholder="trigger comorbidities"
            />
            <label className="sm:col-span-1 inline-flex items-center gap-1.5 text-gray-600">
              <input
                type="checkbox"
                checked={r.active}
                onChange={(e) => patchRow(r.code, { active: e.target.checked })}
              />
              {r.active ? 'on' : 'off'}
            </label>
            <span className="sm:col-span-1 text-right text-[10px] text-gray-400">
              {saving === r.code ? <Loader2 size={10} className="inline-block animate-spin" /> : ' '}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="px-3 py-4 text-xs text-gray-400">No specialties defined.</p>}
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 p-6">
      <Loader2 size={14} className="animate-spin" /> Loading…
    </div>
  );
}

function ErrorBar({ message }: { message: string }) {
  return (
    <div className="border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-xs flex items-center gap-2">
      <AlertCircle size={12} /> {message}
    </div>
  );
}
