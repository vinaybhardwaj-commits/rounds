'use client';

// =============================================================================
// /admin/api-performance — API Performance Dashboard (AP.5)
//
// Replaces the original ComingSoon placeholder. Pulls aggregations from
// /api/admin/api-performance (AP.4), populated by withApiTelemetry rows in
// the api_request_log table (AP.1+AP.2).
//
// Surfaces: 4 KPI cards, endpoint table, 24h time series, slowest endpoints,
// top error producers. Auto-refreshes every 30s.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { Activity, AlertTriangle, Gauge, BarChart3, RefreshCw, Loader2 } from 'lucide-react';

interface KPIs {
  total_requests: number;
  requests_per_min: number;
  error_rate_pct: number;
  overall_p95_ms: number;
}

interface EndpointRow {
  route_pattern: string;
  method: string;
  count: number;
  error_count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  last_seen: string;
}

interface TimeSeriesPoint {
  bucket: string;
  total: number;
  errors: number;
  avg_latency_ms: number;
}

interface SlowestRow {
  route_pattern: string;
  method: string;
  p95_ms: number;
  count: number;
}

interface ErrorTopRow {
  route_pattern: string;
  method: string;
  error_count: number;
  count: number;
  last_status: number | null;
}

interface ApiPerfPayload {
  success: boolean;
  window_hours: number;
  kpis: KPIs;
  endpoints: EndpointRow[];
  timeseries: TimeSeriesPoint[];
  slowest: SlowestRow[];
  error_tops: ErrorTopRow[];
  error?: string;
}

const WINDOW_OPTIONS = [
  { hours: 1, label: '1h' },
  { hours: 24, label: '24h' },
  { hours: 168, label: '7d' },
];

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET': return 'bg-blue-50 text-blue-700';
    case 'POST': return 'bg-green-50 text-green-700';
    case 'PATCH': return 'bg-amber-50 text-amber-700';
    case 'DELETE': return 'bg-red-50 text-red-700';
    case 'PUT': return 'bg-purple-50 text-purple-700';
    default: return 'bg-gray-50 text-gray-700';
  }
}

function latencyTone(ms: number): string {
  if (ms === 0) return 'text-gray-400';
  if (ms < 100) return 'text-emerald-700';
  if (ms < 500) return 'text-gray-700';
  if (ms < 2000) return 'text-amber-700';
  return 'text-red-700';
}

export default function APIPerformancePage() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<ApiPerfPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/api-performance?hours=${hours}`, { cache: 'no-store' });
      const body: ApiPerfPayload = await res.json();
      if (!body.success) {
        setError(body.error || `HTTP ${res.status}`);
        setData(null);
      } else {
        setData(body);
        setError(null);
        setLastFetched(new Date());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hours]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <AdminShell activeSection="api-performance">
      <div className="px-6 py-6 space-y-6">
        {/* Header + window picker + refresh */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">API Performance</h1>
            <p className="text-sm text-gray-500 mt-1">
              Endpoint latency, throughput, and error rates from the last {hours === 168 ? '7 days' : hours + 'h'}.
              {lastFetched && (
                <> · Last refreshed {lastFetched.toLocaleTimeString()}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => setHours(opt.hours)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    hours === opt.hours
                      ? 'bg-even-blue text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
              title="Refresh now"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin text-even-blue' : 'text-gray-500'} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                icon={<Activity size={18} className="text-blue-500" />}
                label="Total requests"
                value={formatNumber(data.kpis.total_requests)}
                sub={`${data.kpis.requests_per_min} req/min`}
              />
              <KpiCard
                icon={<BarChart3 size={18} className="text-emerald-500" />}
                label="Error rate"
                value={`${data.kpis.error_rate_pct}%`}
                sub={data.kpis.error_rate_pct > 5 ? 'Above 5% — investigate' : 'Healthy'}
                tone={data.kpis.error_rate_pct > 5 ? 'warn' : 'ok'}
              />
              <KpiCard
                icon={<Gauge size={18} className="text-amber-500" />}
                label="Overall p95"
                value={`${data.kpis.overall_p95_ms} ms`}
                sub={data.kpis.overall_p95_ms > 2000 ? 'Above 2s — slow' : 'Healthy'}
                tone={data.kpis.overall_p95_ms > 2000 ? 'warn' : 'ok'}
              />
              <KpiCard
                icon={<AlertTriangle size={18} className="text-purple-500" />}
                label="Endpoints tracked"
                value={data.endpoints.length.toString()}
                sub={`${data.error_tops.length} with errors`}
              />
            </div>

            {/* Time series — simple bar chart */}
            {data.timeseries.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Requests over time (5-min buckets)</h2>
                <TimeSeriesBars points={data.timeseries} />
              </div>
            )}

            {/* Slowest + Error tops side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <CompactList
                title="Slowest endpoints (p95)"
                rows={data.slowest.map((r) => ({
                  primary: `${r.method} ${r.route_pattern}`,
                  secondary: `${r.count} req`,
                  metric: `${r.p95_ms}ms`,
                  tone: latencyTone(r.p95_ms),
                }))}
                empty="No endpoints with ≥5 requests yet"
              />
              <CompactList
                title="Top error producers"
                rows={data.error_tops.map((r) => ({
                  primary: `${r.method} ${r.route_pattern}`,
                  secondary: `${r.error_count} of ${r.count}` + (r.last_status ? ` · last ${r.last_status}` : ''),
                  metric: `${r.error_count}`,
                  tone: 'text-red-700',
                }))}
                empty="No errors in this window 🎉"
              />
            </div>

            {/* Endpoint table */}
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700">All endpoints (top 30 by count)</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Method</th>
                      <th className="px-4 py-2 text-left">Route</th>
                      <th className="px-4 py-2 text-right">Count</th>
                      <th className="px-4 py-2 text-right">Errors</th>
                      <th className="px-4 py-2 text-right">p50</th>
                      <th className="px-4 py-2 text-right">p95</th>
                      <th className="px-4 py-2 text-right">p99</th>
                      <th className="px-4 py-2 text-right">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.endpoints.map((ep) => (
                      <tr key={`${ep.method}-${ep.route_pattern}`} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${methodColor(ep.method)}`}>
                            {ep.method}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{ep.route_pattern}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{ep.count}</td>
                        <td className={`px-4 py-2 text-right ${ep.error_count > 0 ? 'text-red-700 font-medium' : 'text-gray-400'}`}>
                          {ep.error_count}
                        </td>
                        <td className={`px-4 py-2 text-right ${latencyTone(ep.p50_ms)}`}>{ep.p50_ms}</td>
                        <td className={`px-4 py-2 text-right ${latencyTone(ep.p95_ms)}`}>{ep.p95_ms}</td>
                        <td className={`px-4 py-2 text-right ${latencyTone(ep.p99_ms)}`}>{ep.p99_ms}</td>
                        <td className="px-4 py-2 text-right text-xs text-gray-400">
                          {new Date(ep.last_seen).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.endpoints.length === 0 && (
                  <div className="px-4 py-12 text-center text-sm text-gray-400">
                    No requests in this window yet — wait a few minutes for telemetry to populate.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub: string; tone?: 'ok' | 'warn';
}) {
  const subTone = tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-gray-500';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 uppercase">
        {icon} {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-even-navy">{value}</div>
      <div className={`mt-1 text-xs ${subTone}`}>{sub}</div>
    </div>
  );
}

function TimeSeriesBars({ points }: { points: TimeSeriesPoint[] }) {
  const maxTotal = Math.max(1, ...points.map((p) => p.total));
  return (
    <div className="flex items-end gap-0.5 h-32">
      {points.map((p, i) => {
        const heightPct = (p.total / maxTotal) * 100;
        const errorPct = p.total > 0 ? (p.errors / p.total) * 100 : 0;
        return (
          <div
            key={i}
            className="flex-1 min-w-[2px] flex flex-col-reverse"
            title={`${new Date(p.bucket).toLocaleTimeString()} — ${p.total} req · ${p.errors} err · ${p.avg_latency_ms}ms avg`}
          >
            <div
              className={errorPct > 10 ? 'bg-red-400' : errorPct > 0 ? 'bg-amber-400' : 'bg-blue-400'}
              style={{ height: `${heightPct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function CompactList({ title, rows, empty }: {
  title: string;
  rows: Array<{ primary: string; secondary: string; metric: string; tone: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-gray-700 truncate">{r.primary}</p>
                <p className="text-gray-400">{r.secondary}</p>
              </div>
              <span className={`font-semibold ${r.tone}`}>{r.metric}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
