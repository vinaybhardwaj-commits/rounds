'use client';

// ============================================
// Rounds — /admin/cases page (Sprint 3 Day 13)
//
// Central ops surface for case-lifecycle metrics. Shows per-hospital
// aggregates + cross-hospital overview. Window selector (7 / 30 / 90 days).
//
// Tabs:
//   - Overview        ✓ live today
//   - By Hospital     ✓ live today
//   - SLA Breaches    — stub, Sprint 3.5
//   - Per Role        — stub, Sprint 3.5
//   - Objections+LSQ  — stub, Sprint 3.5
//
// Tenancy: data already scoped by user_accessible_hospital_ids at the
// endpoint. Hospital-bound users see only their hospital.
// ============================================

import { useCallback, useEffect, useState } from 'react';

interface PerHospital {
  slug: string;
  name: string;
  is_active: boolean;
  handoffs_submitted: number;
  sla_breaches: number;
  cases_active: number;
  cases_completed: number;
  cases_cancelled: number;
  cases_postponed: number;
  pac_published: number;
  ot_list_locks: number;
}

interface SummaryPayload {
  success: boolean;
  feature_enabled: boolean;
  window_days: number;
  generated_at: string;
  hospitals_accessible: number;
  overview: {
    handoffs_submitted: number;
    sla_breaches: number;
    cases_active: number;
    cases_completed: number;
    cases_cancelled: number;
    cases_postponed: number;
    pac_published: number;
    ot_list_locks: number;
  };
  by_hospital: PerHospital[];
}

type Tab = 'overview' | 'by_hospital' | 'sla' | 'roles' | 'objections';

const TABS: Array<{ key: Tab; label: string; live: boolean }> = [
  { key: 'overview', label: 'Overview', live: true },
  { key: 'by_hospital', label: 'By Hospital', live: true },
  { key: 'sla', label: 'SLA Breaches', live: false },
  { key: 'roles', label: 'Per Role', live: false },
  { key: 'objections', label: 'Objections + LSQ', live: false },
];

export default function AdminCasesPage() {
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [windowDays, setWindowDays] = useState<number>(7);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setFeatureDisabled(false);
    fetch(`/api/admin/cases/summary?window_days=${windowDays}`)
      .then((r) => r.json())
      .then((body) => {
        if (body?.feature_enabled === false) {
          setFeatureDisabled(true);
          return;
        }
        if (body?.success) setData(body);
        else setError(body?.error || 'Failed to load');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [windowDays]);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Admin — Cases</h1>
          <p className="mt-1 text-sm text-gray-600">
            Cross-hospital case-lifecycle metrics. Scoped to your accessible hospitals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">Window</label>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {featureDisabled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Case model is disabled (<code>FEATURE_CASE_MODEL_ENABLED=false</code>).
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <nav className="mb-4 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => t.live && setTab(t.key)}
              disabled={!t.live}
              className={`px-3 py-2 text-sm font-medium ${
                active
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : t.live ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400'
              }`}
              title={t.live ? '' : 'Ships Sprint 3.5'}
            >
              {t.label}
              {!t.live && <span className="ml-1 text-[10px] text-gray-400">(soon)</span>}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' && data && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Handoffs submitted" value={data.overview.handoffs_submitted} suffix={` · last ${data.window_days}d`} />
          <Metric label="SLA breaches" value={data.overview.sla_breaches} suffix={` · last ${data.window_days}d`} tone={data.overview.sla_breaches > 0 ? 'red' : 'default'} />
          <Metric label="Active cases" value={data.overview.cases_active} suffix=" right now" />
          <Metric label="PACs published" value={data.overview.pac_published} suffix={` · last ${data.window_days}d`} />
          <Metric label="OT lists locked" value={data.overview.ot_list_locks} suffix={` · last ${data.window_days}d`} />
          <Metric label="Completed" value={data.overview.cases_completed} suffix={` · last ${data.window_days}d`} tone="emerald" />
          <Metric label="Cancelled" value={data.overview.cases_cancelled} suffix={` · last ${data.window_days}d`} tone="gray" />
          <Metric label="Postponed" value={data.overview.cases_postponed} suffix={` · last ${data.window_days}d`} tone="amber" />
        </section>
      )}

      {tab === 'by_hospital' && data && (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Hospital</th>
                <th className="px-3 py-2 text-right">Handoffs</th>
                <th className="px-3 py-2 text-right">SLA breaches</th>
                <th className="px-3 py-2 text-right">Active</th>
                <th className="px-3 py-2 text-right">Completed</th>
                <th className="px-3 py-2 text-right">Cancelled</th>
                <th className="px-3 py-2 text-right">Postponed</th>
                <th className="px-3 py-2 text-right">PACs</th>
                <th className="px-3 py-2 text-right">Lists locked</th>
              </tr>
            </thead>
            <tbody>
              {data.by_hospital.map((h) => (
                <tr key={h.slug} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900">
                    <span className="font-medium">{h.slug.toUpperCase()}</span>
                    <span className="ml-2 text-gray-500">{h.name}</span>
                    {!h.is_active && <span className="ml-2 rounded bg-gray-200 px-1 py-0.5 text-[10px] text-gray-700">inactive</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{h.handoffs_submitted}</td>
                  <td className={`px-3 py-2 text-right font-mono ${h.sla_breaches > 0 ? 'text-red-700' : ''}`}>{h.sla_breaches}</td>
                  <td className="px-3 py-2 text-right font-mono">{h.cases_active}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{h.cases_completed}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-500">{h.cases_cancelled}</td>
                  <td className="px-3 py-2 text-right font-mono text-amber-700">{h.cases_postponed}</td>
                  <td className="px-3 py-2 text-right font-mono">{h.pac_published}</td>
                  <td className="px-3 py-2 text-right font-mono">{h.ot_list_locks}</td>
                </tr>
              ))}
              {data.by_hospital.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500">
                    No accessible hospitals.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {(tab === 'sla' || tab === 'roles' || tab === 'objections') && (
        <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-sm font-medium text-gray-900">Ships Sprint 3.5.</p>
          <p className="mt-1 text-xs text-gray-600">
            Overview + By Hospital are live; this tab is a placeholder.
          </p>
        </section>
      )}

      {data && (
        <p className="mt-4 text-right text-[11px] text-gray-400">
          Generated {new Date(data.generated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
          {' · '}{data.hospitals_accessible} hospital{data.hospitals_accessible === 1 ? '' : 's'} accessible
        </p>
      )}
    </main>
  );
}

interface MetricProps {
  label: string;
  value: number | string;
  suffix?: string;
  tone?: 'default' | 'emerald' | 'red' | 'amber' | 'gray';
}

function Metric({ label, value, suffix, tone = 'default' }: MetricProps) {
  const color =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'red' ? 'text-red-700' :
    tone === 'amber' ? 'text-amber-700' :
    tone === 'gray' ? 'text-gray-500' :
    'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>
        {value}
      </p>
      {suffix && <p className="mt-0.5 text-[11px] text-gray-400">{suffix}</p>}
    </div>
  );
}
