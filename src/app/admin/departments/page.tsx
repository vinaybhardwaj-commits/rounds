'use client';

// ============================================
// Rounds — /admin/departments page (Sprint 4 prep)
//
// super_admin CRUD for the departments table. Needed to stand up
// EHBR/EHIN departments without raw SQL.
// ============================================

import { useEffect, useState } from 'react';

interface Hospital { id: string; slug: string; name: string; is_active: boolean }
interface Dept {
  id: string; hospital_id: string; hospital_slug: string;
  name: string; slug: string;
  head_profile_id: string | null; head_name: string | null;
  is_active: boolean; member_count: number;
}

export default function AdminDepartmentsPage() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterHospital, setFilterHospital] = useState<string>('all');

  const [newHosp, setNewHosp] = useState('');
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, h] = await Promise.all([
        fetch('/api/admin/departments').then((r) => r.json()),
        fetch('/api/admin/hospitals').then((r) => r.json()),
      ]);
      if (d?.success) setDepts(d.data); else throw new Error(d?.error || 'depts load failed');
      if (h?.success) setHospitals(h.data); else throw new Error(h?.error || 'hospitals load failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newHosp || !newName.trim() || !newSlug.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospital_id: newHosp, name: newName.trim(), slug: newSlug.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j?.error || `HTTP ${res.status}`);
      setNewName(''); setNewSlug('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (d: Dept) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: d.id, is_active: !d.is_active }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j?.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Dept) => {
    if (!confirm(`Delete "${d.name}" (${d.hospital_slug})? Cannot undo.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/departments?id=${d.id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j?.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filtered = filterHospital === 'all' ? depts : depts.filter((d) => d.hospital_id === filterHospital);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Admin — Departments</h1>
          <p className="mt-1 text-sm text-gray-600">CRUD for the departments table. Slugs become channel ids — globally unique.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>}

      <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Add department</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <select value={newHosp} onChange={(e) => setNewHosp(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">— Hospital —</option>
            {hospitals.filter((h) => h.is_active).map((h) => (
              <option key={h.id} value={h.id}>{h.slug.toUpperCase()} · {h.name}</option>
            ))}
          </select>
          <input type="text" placeholder="Name (e.g. Cardiology)" value={newName} onChange={(e) => setNewName(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
          <input type="text" placeholder="Slug (e.g. cardiology)" value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} className="rounded-md border border-gray-300 px-2 py-1 font-mono text-sm" />
          <button type="button" onClick={create} disabled={busy || !newHosp || !newName.trim() || !newSlug.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Create</button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">After creating EHBR/EHIN depts, run /admin/chat-system "Seed channels" to create matching GetStream channels.</p>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <label className="text-xs text-gray-600">Filter</label>
        <select value={filterHospital} onChange={(e) => setFilterHospital(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
          <option value="all">All hospitals ({depts.length})</option>
          {hospitals.map((h) => {
            const n = depts.filter((d) => d.hospital_id === h.id).length;
            return <option key={h.id} value={h.id}>{h.slug.toUpperCase()} ({n})</option>;
          })}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Slug</th>
              <th className="px-3 py-2 text-left">Head</th>
              <th className="px-3 py-2 text-right">Members</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{d.hospital_slug.toUpperCase()}</td>
                <td className="px-3 py-2">{d.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{d.slug}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{d.head_name ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{d.member_count}</td>
                <td className="px-3 py-2 text-center">
                  {d.is_active
                    ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">active</span>
                    : <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">inactive</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => toggle(d)} disabled={busy} className="mr-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {d.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" onClick={() => remove(d)} disabled={busy || d.member_count > 0} title={d.member_count > 0 ? 'Reassign members first' : 'Delete'} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-red-50 hover:border-red-300 hover:text-red-800 disabled:opacity-50">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-500">No departments match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
