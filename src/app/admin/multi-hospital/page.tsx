'use client';

// ============================================
// Rounds — /admin/multi-hospital page (Sprint 3.5)
//
// super_admin surface for granting hospital access + managing doctor
// affiliations + setting role_scope.
//
// Three sections:
//   1. User Hospital Access — extra hospitals beyond a profile's primary
//   2. Doctor Affiliations — doctor ↔ hospital mappings (one is_primary)
//   3. Role Scope — central / hospital_bound / multi_hospital toggle
//
// All actions hit POST /api/admin/multi-hospital with discriminated body.
// ============================================

import { useEffect, useState } from 'react';

interface Hospital { id: string; slug: string; name: string; is_active: boolean }
interface Profile {
  id: string; full_name: string | null; email: string | null;
  role: string; role_scope: string | null;
  primary_hospital_id: string | null; primary_hospital_slug: string | null;
}
interface Grant {
  id: string; profile_id: string; hospital_id: string; granted_at: string;
  profile_name: string | null; hospital_slug: string; granter_name: string | null;
}
interface Affiliation {
  id: string; profile_id: string; hospital_id: string; is_primary: boolean;
  profile_name: string | null; hospital_slug: string;
}
interface Payload {
  hospitals: Hospital[]; profiles: Profile[];
  grants: Grant[]; affiliations: Affiliation[];
}

const DOCTOR_ROLES = new Set(['doctor','consultant','specialist','resident','senior_resident','anaesthesiologist','anaesthetist','surgeon','rmo','registrar']);

export default function AdminMultiHospitalPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'access'|'affiliations'|'scope'>('access');

  const load = () => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/multi-hospital')
      .then((r) => r.json())
      .then((body) => {
        if (body?.success) setData(body.data);
        else setError(body?.error || 'Failed to load');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/multi-hospital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Admin — Multi-hospital access</h1>
          <p className="mt-1 text-sm text-gray-600">Grants, doctor affiliations, and role scope. super_admin only.</p>
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
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>
      )}

      <nav className="mb-4 flex gap-1 border-b border-gray-200">
        <TabBtn current={tab} k="access" set={setTab} label={`User Hospital Access (${data?.grants.length ?? 0})`} />
        <TabBtn current={tab} k="affiliations" set={setTab} label={`Doctor Affiliations (${data?.affiliations.length ?? 0})`} />
        <TabBtn current={tab} k="scope" set={setTab} label={`Role Scope (${data?.profiles.length ?? 0})`} />
      </nav>

      {tab === 'access' && data && (
        <AccessSection data={data} busy={busy} post={post} />
      )}
      {tab === 'affiliations' && data && (
        <AffiliationsSection data={data} busy={busy} post={post} />
      )}
      {tab === 'scope' && data && (
        <ScopeSection data={data} busy={busy} post={post} />
      )}
    </main>
  );
}

function TabBtn({ current, k, set, label }: { current: string; k: 'access'|'affiliations'|'scope'; set: (k: 'access'|'affiliations'|'scope') => void; label: string }) {
  const active = current === k;
  return (
    <button
      type="button"
      onClick={() => set(k)}
      className={`px-3 py-2 text-sm font-medium ${active ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-600 hover:text-gray-900'}`}
    >
      {label}
    </button>
  );
}

function AccessSection({ data, busy, post }: { data: Payload; busy: boolean; post: (b: Record<string, unknown>) => Promise<void> }) {
  const [profileId, setProfileId] = useState('');
  const [hospitalId, setHospitalId] = useState('');

  return (
    <section>
      <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Grant access</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">— Profile —</option>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email} · {p.role} · {p.role_scope ?? '—'} · {p.primary_hospital_slug ?? 'no primary'}
              </option>
            ))}
          </select>
          <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">— Hospital —</option>
            {data.hospitals.filter((h) => h.is_active).map((h) => (
              <option key={h.id} value={h.id}>{h.slug.toUpperCase()} · {h.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { if (profileId && hospitalId) post({ action: 'grant_access', profile_id: profileId, hospital_id: hospitalId }); }}
            disabled={busy || !profileId || !hospitalId}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Grant
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Profile</th>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-left">Granted at</th>
              <th className="px-3 py-2 text-left">Granted by</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.grants.map((g) => (
              <tr key={g.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">{g.profile_name || g.profile_id.slice(0, 8)}</td>
                <td className="px-3 py-2 font-mono">{g.hospital_slug.toUpperCase()}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{new Date(g.granted_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{g.granter_name || (g.granted_by ? 'system' : '—')}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Revoke ${g.profile_name}'s access to ${g.hospital_slug.toUpperCase()}?`)) post({ action: 'revoke_access', grant_id: g.id }); }}
                    disabled={busy}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-red-50 hover:border-red-300 hover:text-red-800 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {data.grants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-500">No grants yet. Use form above to give central or multi-hospital users extra access.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AffiliationsSection({ data, busy, post }: { data: Payload; busy: boolean; post: (b: Record<string, unknown>) => Promise<void> }) {
  const [profileId, setProfileId] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [isPrimary, setIsPrimary] = useState(true);
  const doctors = data.profiles.filter((p) => DOCTOR_ROLES.has(p.role));

  return (
    <section>
      <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Add affiliation</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">— Doctor —</option>
            {doctors.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email} · {p.role}</option>
            ))}
          </select>
          <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">— Hospital —</option>
            {data.hospitals.filter((h) => h.is_active).map((h) => (
              <option key={h.id} value={h.id}>{h.slug.toUpperCase()}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-gray-700">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary
          </label>
          <button
            type="button"
            onClick={() => { if (profileId && hospitalId) post({ action: 'add_affiliation', profile_id: profileId, hospital_id: hospitalId, is_primary: isPrimary }); }}
            disabled={busy || !profileId || !hospitalId}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Doctor</th>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-center">Primary?</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.affiliations.map((a) => (
              <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">{a.profile_name || a.profile_id.slice(0, 8)}</td>
                <td className="px-3 py-2 font-mono">{a.hospital_slug.toUpperCase()}</td>
                <td className="px-3 py-2 text-center">
                  {a.is_primary ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">primary</span> : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {!a.is_primary && (
                    <button
                      type="button"
                      onClick={() => post({ action: 'set_primary_affiliation', affiliation_id: a.id })}
                      disabled={busy}
                      className="mr-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      Set primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Remove ${a.profile_name}'s affiliation with ${a.hospital_slug.toUpperCase()}?`)) post({ action: 'remove_affiliation', affiliation_id: a.id }); }}
                    disabled={busy}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-red-50 hover:border-red-300 hover:text-red-800 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {data.affiliations.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">No doctor affiliations yet. The Picker B target_hospital auto-fill needs at least one primary affiliation per admitting doctor.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScopeSection({ data, busy, post }: { data: Payload; busy: boolean; post: (b: Record<string, unknown>) => Promise<void> }) {
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">Profile</th>
            <th className="px-3 py-2 text-left">Role</th>
            <th className="px-3 py-2 text-left">Primary hospital</th>
            <th className="px-3 py-2 text-left">Current scope</th>
            <th className="px-3 py-2 text-right">Set scope</th>
          </tr>
        </thead>
        <tbody>
          {data.profiles.map((p) => (
            <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2">{p.full_name || p.email}</td>
              <td className="px-3 py-2 text-xs text-gray-700">{p.role}</td>
              <td className="px-3 py-2 font-mono text-xs">{p.primary_hospital_slug?.toUpperCase() ?? '—'}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                  p.role_scope === 'central' ? 'bg-purple-100 text-purple-800' :
                  p.role_scope === 'multi_hospital' ? 'bg-blue-100 text-blue-800' :
                  p.role_scope === 'hospital_bound' ? 'bg-gray-100 text-gray-700' :
                  'bg-amber-100 text-amber-800'
                }`}>
                  {p.role_scope ?? 'unset'}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <select
                  value={p.role_scope ?? ''}
                  onChange={(e) => { if (e.target.value) post({ action: 'set_role_scope', profile_id: p.id, role_scope: e.target.value }); }}
                  disabled={busy}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="">—</option>
                  <option value="central">central</option>
                  <option value="hospital_bound">hospital_bound</option>
                  <option value="multi_hospital">multi_hospital</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
