'use client';

// ============================================
// Rounds — /admin/hospitals page (Sprint 3 Day 15)
//
// super_admin surface for the hospitals registry. Activate / deactivate
// hospitals (which gates them out of user_accessible_hospital_ids and
// hides their channels). Today shows EHRC active + EHBR/EHIN inactive.
//
// Activating EHBR is the trigger for Sprint 4; activating EHIN is Sprint 5.
//
// Multi-hospital admin (user_hospital_access grants, doctor affiliations)
// lands in Sprint 3.5 — only meaningful when 2+ hospitals are active.
// ============================================

import { useEffect, useState } from 'react';

interface HospitalDetail {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  is_active: boolean;
  ot_room_count: number | null;
  primary_profile_count: number;
  department_count: number;
  active_case_count: number;
  created_at: string;
}

export default function AdminHospitalsPage() {
  const [data, setData] = useState<HospitalDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/hospitals')
      .then((r) => r.json())
      .then((body) => {
        if (body?.success) setData(body.data);
        else setError(body?.error || 'Failed to load');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggle = async (h: HospitalDetail) => {
    const next = !h.is_active;
    if (!next && h.active_case_count > 0) {
      alert(`Cannot deactivate ${h.slug.toUpperCase()}: ${h.active_case_count} active surgical cases. Resolve them first.`);
      return;
    }
    if (!confirm(`${next ? 'Activate' : 'Deactivate'} ${h.slug.toUpperCase()}?`)) return;

    setBusyId(h.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/hospitals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: h.id, is_active: next }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Admin — Hospitals</h1>
          <p className="mt-1 text-sm text-gray-600">
            Activate or deactivate hospitals in the multi-hospital registry. super_admin only.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-right">Profiles</th>
              <th className="px-3 py-2 text-right">Departments</th>
              <th className="px-3 py-2 text-right">Active cases</th>
              <th className="px-3 py-2 text-right">OT rooms</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.map((h) => (
              <tr key={h.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-900">{h.slug.toUpperCase()}</span>
                  <span className="ml-2 text-gray-500">{h.display_name ?? h.name}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{h.primary_profile_count}</td>
                <td className="px-3 py-2 text-right font-mono">{h.department_count}</td>
                <td className={`px-3 py-2 text-right font-mono ${h.active_case_count > 0 ? 'text-blue-700' : ''}`}>
                  {h.active_case_count}
                </td>
                <td className="px-3 py-2 text-right font-mono">{h.ot_room_count ?? '—'}</td>
                <td className="px-3 py-2 text-center">
                  {h.is_active ? (
                    <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      active
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                      inactive
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggle(h)}
                    disabled={busyId === h.id}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${
                      h.is_active
                        ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    } disabled:opacity-50`}
                    title={!h.is_active ? `Activating ${h.slug.toUpperCase()} unlocks it for new cases + sidebar group + cron coverage.` : undefined}
                  >
                    {busyId === h.id ? '…' : h.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Activating EHBR triggers the Sprint 4 plan (per PRD §9). Activating EHIN triggers Sprint 5.
        Department channels for a newly-activated hospital appear in the sidebar after a re-seed
        via /admin/chat-system → "Seed department + cross-functional channels".
      </p>
    </main>
  );
}
