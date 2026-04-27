'use client';

// =============================================================================
// /admin/doctor-affiliations (MH.7b)
//
// Admin UI for managing reference_doctor × hospital affiliations. Per V's
// locked design (27 Apr 2026 night, journal §1).
//
// Features:
//   - Searchable table of (doctor → hospitals) — q param hits API
//   - Per-row chip view of current affiliations (HospitalChip with star = primary)
//   - "+ Add affiliation" modal: HospitalPicker + is_primary checkbox
//   - Per-chip Remove action with confirm
//   - Scope-aware via /api/admin/doctor-affiliations (super_admin all; hospital_admin
//     only their hospital's affiliations)
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Network, Search, Plus, Trash2, Star, RefreshCw, X, Loader2 } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { HospitalChip } from '@/components/HospitalChip';
import { HospitalPicker } from '@/components/HospitalPicker';

interface AffiliationRow {
  id: string;
  reference_doctor_id: string;
  doctor_full_name: string | null;
  doctor_specialty: string | null;
  hospital_id: string;
  hospital_slug: string;
  hospital_short_name: string | null;
  hospital_name: string;
  is_primary: boolean;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
}

interface DoctorRow {
  reference_doctor_id: string;
  doctor_full_name: string | null;
  doctor_specialty: string | null;
  affiliations: AffiliationRow[];
}

export default function DoctorAffiliationsPage() {
  const [rows, setRows] = useState<AffiliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<string>('');

  // Add modal state
  const [addOpenForDoctor, setAddOpenForDoctor] = useState<DoctorRow | null>(null);
  const [addHospitalId, setAddHospitalId] = useState<string | null>(null);
  const [addIsPrimary, setAddIsPrimary] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Remove confirm state
  const [removeTarget, setRemoveTarget] = useState<AffiliationRow | null>(null);
  const [removeSubmitting, setRemoveSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      qs.set('limit', '300');
      const res = await fetch(`/api/admin/doctor-affiliations?${qs.toString()}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setRows(body.data || []);
      setScope(body.scope || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load affiliations');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => { fetchData(); }, 250);
    return () => clearTimeout(t);
  }, [fetchData]);

  // Group rows by doctor
  const doctorRows: DoctorRow[] = useMemo(() => {
    const byDoctor = new Map<string, DoctorRow>();
    for (const r of rows) {
      const existing = byDoctor.get(r.reference_doctor_id);
      if (existing) {
        existing.affiliations.push(r);
      } else {
        byDoctor.set(r.reference_doctor_id, {
          reference_doctor_id: r.reference_doctor_id,
          doctor_full_name: r.doctor_full_name,
          doctor_specialty: r.doctor_specialty,
          affiliations: [r],
        });
      }
    }
    return Array.from(byDoctor.values()).sort((a, b) =>
      (a.doctor_full_name || '').localeCompare(b.doctor_full_name || '')
    );
  }, [rows]);

  const handleAdd = async () => {
    if (!addOpenForDoctor || !addHospitalId) return;
    setAddSubmitting(true);
    setAddError(null);
    try {
      const res = await fetch('/api/admin/doctor-affiliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference_doctor_id: addOpenForDoctor.reference_doctor_id,
          hospital_id: addHospitalId,
          is_primary: addIsPrimary,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setAddOpenForDoctor(null);
      setAddHospitalId(null);
      setAddIsPrimary(false);
      await fetchData();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add affiliation');
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoveSubmitting(true);
    try {
      const res = await fetch(`/api/admin/doctor-affiliations/${removeTarget.id}`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setRemoveTarget(null);
      await fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove affiliation');
    } finally {
      setRemoveSubmitting(false);
    }
  };

  return (
    <AdminLayout breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Doctor Affiliations' }]}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-even-navy flex items-center gap-2">
              <Network size={20} /> Doctor Affiliations
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              Reference doctors × hospitals. Marketing handoffs validate the doctor-hospital pair on submit (soft-warn).
              {scope && <span className="ml-2 text-gray-400">· Scope: {scope}</span>}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by doctor name…"
            className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-even-blue"
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Doctor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Specialty</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Affiliations</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  <Loader2 size={16} className="inline animate-spin mr-2" /> Loading affiliations…
                </td></tr>
              )}
              {!loading && doctorRows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  {search ? 'No doctors match your search.' : 'No affiliations yet.'}
                </td></tr>
              )}
              {!loading && doctorRows.map(d => (
                <tr key={d.reference_doctor_id} className="hover:bg-blue-50/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-even-navy">{d.doctor_full_name || '—'}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{d.reference_doctor_id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{d.doctor_specialty || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {d.affiliations.map(a => (
                        <div key={a.id} className="flex items-center gap-0.5 group">
                          <HospitalChip
                            hospitalSlug={a.hospital_slug}
                            hospitalShortName={a.hospital_short_name}
                            hospitalName={a.hospital_name}
                          />
                          {a.is_primary && (
                            <Star size={10} className="text-amber-500 fill-amber-400" aria-label="Primary affiliation" />
                          )}
                          <button
                            onClick={() => setRemoveTarget(a)}
                            className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-500"
                            aria-label={`Remove ${a.hospital_slug.toUpperCase()} affiliation`}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setAddOpenForDoctor(d);
                        setAddHospitalId(null);
                        setAddIsPrimary(false);
                        setAddError(null);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-even-blue hover:bg-even-blue hover:text-white rounded transition-colors"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add modal */}
        {addOpenForDoctor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                <h2 className="text-base font-semibold text-gray-900">Add affiliation</h2>
                <button onClick={() => setAddOpenForDoctor(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <div className="text-xs text-gray-500">Doctor</div>
                  <div className="text-sm font-medium text-even-navy">{addOpenForDoctor.doctor_full_name || '—'}</div>
                </div>
                <HospitalPicker value={addHospitalId} onChange={setAddHospitalId} required label="Hospital" />
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={addIsPrimary}
                    onChange={e => setAddIsPrimary(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Mark as primary affiliation
                </label>
                {addError && (
                  <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                    {addError}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 bg-gray-50 rounded-b-xl">
                <button
                  onClick={() => setAddOpenForDoctor(null)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!addHospitalId || addSubmitting}
                  className="px-3 py-1.5 text-sm bg-even-blue text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {addSubmitting && <Loader2 size={12} className="animate-spin" />}
                  Add affiliation
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Remove confirm */}
        {removeTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 size={16} className="text-red-500" />
                <h2 className="text-base font-semibold text-gray-900">Remove affiliation?</h2>
              </div>
              <p className="text-sm text-gray-600">
                Remove {removeTarget.hospital_slug.toUpperCase()} affiliation for{' '}
                <strong>{removeTarget.doctor_full_name}</strong>?
              </p>
              <p className="text-[11px] text-gray-400 mt-1">
                Future submissions of this doctor + hospital will trigger a soft-warn instead of pass.
              </p>
              <div className="flex items-center justify-end gap-2 mt-4">
                <button
                  onClick={() => setRemoveTarget(null)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemove}
                  disabled={removeSubmitting}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {removeSubmitting && <Loader2 size={12} className="animate-spin" />}
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
