'use client';

import { useState, useEffect } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  Activity,
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  Zap,
  X,
} from 'lucide-react';

// Types
interface LLMOverview {
  total_calls: number;
  successful: number;
  errors: number;
  fallbacks: number;
  cache_hits: number;
  total_tokens_prompt: number;
  total_tokens_completion: number;
  total_tokens: number;
  avg_latency_ms: number;
  p50_latency: number;
  p95_latency: number;
  p99_latency: number;
  success_rate: number;
}

interface ByType {
  analysis_type: string;
  call_count: number;
  successful: number;
  errors: number;
  avg_latency_ms: number;
  total_tokens: number;
}

interface DailyTrend {
  date: string;
  calls: number;
  errors: number;
  avg_latency_ms: number;
  tokens: number;
}

interface LatencyBucket {
  bucket: string;
  count: number;
}

interface RecentError {
  id: string;
  analysis_type: string;
  route: string;
  error_message: string;
  latency_ms: number;
  model: string;
  fallback_used: boolean;
  created_at: string;
  triggered_by_name: string;
}

interface ModelBreakdown {
  model: string;
  call_count: number;
  avg_latency_ms: number;
  total_tokens: number;
  errors: number;
}

interface LogEntry {
  id: string;
  route: string;
  analysis_type: string;
  model: string;
  tokens_prompt: number;
  tokens_completion: number;
  tokens_total: number;
  latency_ms: number;
  status: string;
  error_message: string | null;
  cache_hit: boolean;
  fallback_used: boolean;
  source_type: string;
  triggered_by_name: string;
  triggered_by_email: string;
  created_at: string;
}

interface LogDetail {
  id: string;
  route: string;
  analysis_type: string;
  prompt_messages: any;
  response_raw: string;
  response_parsed: any;
  model: string;
  tokens_prompt: number;
  tokens_completion: number;
  tokens_total: number;
  latency_ms: number;
  status: string;
  error_message: string | null;
  cache_hit: boolean;
  fallback_used: boolean;
  source_id: string;
  source_type: string;
  triggered_by_name: string;
  triggered_by_email: string;
  triggered_by_role: string;
  metadata: any;
  created_at: string;
}

// Helpers
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatLatency(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function getStatusBadge(status: string) {
  if (status === 'success') return 'bg-green-100 text-green-700';
  if (status === 'error') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

// Stat card
function StatCard({ label, value, subValue, icon, color }: {
  label: string; value: string | number; subValue?: string;
  icon: React.ReactNode; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <div>
          <div className="text-xs text-gray-600">{label}</div>
          <div className="text-xl font-bold text-even-navy">{value}</div>
          {subValue && <div className="text-xs text-gray-500">{subValue}</div>}
        </div>
      </div>
    </div>
  );
}

// Log detail modal
function LogDetailModal({ logId, onClose }: { logId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/llm/logs/${logId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setDetail(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [logId]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-gray-200 max-w-4xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="text-sm font-semibold text-even-navy">LLM Call Detail</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : !detail ? (
          <div className="p-8 text-center text-sm text-red-500">Failed to load</div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><span className="text-gray-500">Type:</span> <span className="font-medium">{detail.analysis_type}</span></div>
              <div><span className="text-gray-500">Model:</span> <span className="font-medium">{detail.model}</span></div>
              <div><span className="text-gray-500">Status:</span> <span className={`font-medium px-1.5 py-0.5 rounded ${getStatusBadge(detail.status)}`}>{detail.status}</span></div>
              <div><span className="text-gray-500">Latency:</span> <span className="font-medium">{formatLatency(detail.latency_ms)}</span></div>
              <div><span className="text-gray-500">Tokens:</span> <span className="font-medium">{detail.tokens_prompt} in / {detail.tokens_completion} out</span></div>
              <div><span className="text-gray-500">Route:</span> <span className="font-medium">{detail.route}</span></div>
              <div><span className="text-gray-500">By:</span> <span className="font-medium">{detail.triggered_by_name || '—'}</span></div>
              <div><span className="text-gray-500">Time:</span> <span className="font-medium">{formatTime(detail.created_at)}</span></div>
            </div>

            {detail.cache_hit && <div className="text-xs text-blue-600 font-medium">Cache hit</div>}
            {detail.fallback_used && <div className="text-xs text-amber-600 font-medium">Fallback used (template response)</div>}
            {detail.error_message && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{detail.error_message}</div>
            )}

            {/* Prompt */}
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">Prompt Messages</h4>
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
                {detail.prompt_messages ? JSON.stringify(detail.prompt_messages, null, 2) : '—'}
              </pre>
            </div>

            {/* Response */}
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">Response (Raw)</h4>
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
                {detail.response_raw || '—'}
              </pre>
            </div>

            {/* Parsed Response */}
            {detail.response_parsed && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-2">Response (Parsed)</h4>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(detail.response_parsed, null, 2)}
                </pre>
              </div>
            )}

            {/* Metadata */}
            {detail.metadata && Object.keys(detail.metadata).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-2">Metadata</h4>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(detail.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Main Page
export default function LLMObservatoryPage() {
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, admissions: 0, escalations: 0 });
  const [healthData, setHealthData] = useState<any>(null);

  // Stats tab
  const [overview, setOverview] = useState<LLMOverview | null>(null);
  const [byType, setByType] = useState<ByType[]>([]);
  const [dailyTrend, setDailyTrend] = useState<DailyTrend[]>([]);
  const [latencyDist, setLatencyDist] = useState<LatencyBucket[]>([]);
  const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdown[]>([]);

  // Logs tab
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalPages, setLogsTotalPages] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('');
  const [logTypeFilter, setLogTypeFilter] = useState('');

  // Detail modal
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'stats' | 'logs'>('stats');
  const [statsLoading, setStatsLoading] = useState(true);

  // Fetch metadata
  useEffect(() => {
    fetch('/api/profiles/me').then(r => r.json()).then(d => {
      if (d.success && d.data?.role) setUserRole(d.data.role);
    }).catch(() => {});

    Promise.all([
      fetch('/api/admin/approvals').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/escalation/log?resolved=false').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/admission-tracker').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([approvals, escalations, admissions]) => {
      setBadges({
        approvals: approvals.data?.length || 0,
        escalations: escalations.data?.length || 0,
        admissions: admissions.data?.length || 0,
      });
    });

    fetch('/api/admin/health').then(r => r.json()).then(d => {
      setHealthData({
        llm: { status: d.status || 'down', latency_ms: d.latency_ms || 0 },
        errors_1h: 0, error_sparkline: [], active_sessions: 0,
        api_p95_ms: 0, api_trend: 'stable' as const,
        forms_today: 0, forms_yesterday: 0, last_deploy: { time: '', sha: '' },
      });
    }).catch(() => {});
  }, []);

  // Fetch stats
  useEffect(() => {
    setStatsLoading(true);
    fetch('/api/admin/llm/stats')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setOverview(d.data.overview);
          setByType(d.data.by_type);
          setDailyTrend(d.data.daily_trend);
          setLatencyDist(d.data.latency_distribution);
          setRecentErrors(d.data.recent_errors);
          setModelBreakdown(d.data.model_breakdown);
        }
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  // Fetch logs
  useEffect(() => {
    setLogsLoading(true);
    const params = new URLSearchParams({ page: String(logsPage), limit: '50' });
    if (logSearch) params.append('search', logSearch);
    if (logStatusFilter) params.append('status', logStatusFilter);
    if (logTypeFilter) params.append('type', logTypeFilter);

    fetch(`/api/admin/llm/logs?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setLogs(d.data.logs);
          setLogsTotalPages(d.data.pagination.totalPages);
        }
      })
      .catch(() => {})
      .finally(() => setLogsLoading(false));
  }, [logsPage, logSearch, logStatusFilter, logTypeFilter]);

  // Get unique analysis types for filter
  const analysisTypes = [...new Set(byType.map(t => t.analysis_type))];
  const maxDailyCallCount = dailyTrend.length > 0 ? Math.max(...dailyTrend.map(d => d.calls)) : 1;
  const maxLatencyCount = latencyDist.length > 0 ? Math.max(...latencyDist.map(d => d.count)) : 1;

  return (
    <AdminShell activeSection="llm" userRole={userRole} badges={badges} health={healthData}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-even-navy">LLM Observatory</h1>
          <p className="text-sm text-gray-600 mt-1">Monitor AI model usage, latency, tokens, and errors</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-gray-100 p-1 flex gap-1">
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'stats' ? 'bg-even-blue text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2"><Activity size={16} /> Overview</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'logs' ? 'bg-even-blue text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2"><Brain size={16} /> Call Logs</span>
          </button>
        </div>

        {/* Stats Tab */}
        {activeTab === 'stats' && (
          statsLoading ? (
            <div className="p-8 text-sm text-gray-500">Loading LLM stats...</div>
          ) : !overview ? (
            <div className="p-8 text-sm text-gray-500">No LLM data available</div>
          ) : (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total Calls (7d)" value={formatNumber(overview.total_calls)} icon={<Brain size={20} className="text-blue-600" />} color="bg-blue-100" />
                <StatCard label="Success Rate" value={overview.success_rate + '%'} subValue={`${overview.errors} errors`} icon={<Zap size={20} className="text-green-600" />} color="bg-green-100" />
                <StatCard label="Avg Latency" value={formatLatency(overview.avg_latency_ms)} subValue={`p95: ${formatLatency(overview.p95_latency)}`} icon={<Clock size={20} className="text-purple-600" />} color="bg-purple-100" />
                <StatCard label="Total Tokens" value={formatNumber(overview.total_tokens)} subValue={`${formatNumber(overview.total_tokens_prompt)} in / ${formatNumber(overview.total_tokens_completion)} out`} icon={<Activity size={20} className="text-amber-600" />} color="bg-amber-100" />
              </div>

              {/* Daily Trend */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">Daily Usage (14 days)</h3>
                {dailyTrend.length > 0 ? (
                  <div className="flex items-end gap-1 h-32">
                    {dailyTrend.map((d, i) => {
                      const barH = maxDailyCallCount > 0 ? (d.calls / maxDailyCallCount) * 100 : 0;
                      const errorH = d.calls > 0 ? (d.errors / d.calls) * barH : 0;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.calls} calls, ${d.errors} errors`}>
                          <div className="w-full relative" style={{ height: Math.max(barH, 2) + '%', minHeight: '2px' }}>
                            <div className="absolute bottom-0 w-full bg-blue-400 rounded-t" style={{ height: '100%' }} />
                            {errorH > 0 && (
                              <div className="absolute bottom-0 w-full bg-red-400 rounded-t" style={{ height: errorH + '%' }} />
                            )}
                          </div>
                          <span className="text-xs text-gray-400 -rotate-45 origin-center whitespace-nowrap" style={{ fontSize: '9px' }}>
                            {new Date(d.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 text-center py-4">No data</div>
                )}
              </div>

              {/* Two column: By Type + Latency */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* By Analysis Type */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="text-sm font-semibold text-even-navy mb-4">Calls by Type (7d)</h3>
                  {byType.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left px-2 py-2 text-gray-600 font-medium">Type</th>
                            <th className="text-center px-2 py-2 text-gray-600 font-medium">Calls</th>
                            <th className="text-center px-2 py-2 text-gray-600 font-medium">Errors</th>
                            <th className="text-center px-2 py-2 text-gray-600 font-medium">Avg Latency</th>
                            <th className="text-center px-2 py-2 text-gray-600 font-medium">Tokens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byType.map((t, i) => (
                            <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="text-left px-2 py-2 text-gray-700 font-medium">{t.analysis_type}</td>
                              <td className="text-center px-2 py-2 text-gray-600">{t.call_count}</td>
                              <td className="text-center px-2 py-2 text-red-600 font-medium">{t.errors}</td>
                              <td className="text-center px-2 py-2 text-gray-600">{formatLatency(t.avg_latency_ms)}</td>
                              <td className="text-center px-2 py-2 text-gray-600">{formatNumber(t.total_tokens)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 text-center py-4">No data</div>
                  )}
                </div>

                {/* Latency Distribution */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="text-sm font-semibold text-even-navy mb-4">Latency Distribution (7d)</h3>
                  {latencyDist.length > 0 ? (
                    <div className="space-y-2">
                      {latencyDist.map((d, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-20 text-xs text-gray-600 font-medium text-right">{d.bucket}</div>
                          <div className="flex-1 h-6 bg-gray-100 rounded flex items-center">
                            <div
                              className="h-full bg-purple-500 rounded transition-all"
                              style={{ width: (d.count / maxLatencyCount) * 100 + '%' }}
                            />
                          </div>
                          <div className="w-10 text-right text-xs font-medium text-gray-700">{d.count}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 text-center py-4">No data</div>
                  )}
                </div>
              </div>

              {/* Model Breakdown */}
              {modelBreakdown.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="text-sm font-semibold text-even-navy mb-4">Model Breakdown (7d)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left px-2 py-2 text-gray-600 font-medium">Model</th>
                          <th className="text-center px-2 py-2 text-gray-600 font-medium">Calls</th>
                          <th className="text-center px-2 py-2 text-gray-600 font-medium">Avg Latency</th>
                          <th className="text-center px-2 py-2 text-gray-600 font-medium">Total Tokens</th>
                          <th className="text-center px-2 py-2 text-gray-600 font-medium">Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelBreakdown.map((m, i) => (
                          <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="text-left px-2 py-2 text-gray-700 font-medium font-mono text-xs">{m.model}</td>
                            <td className="text-center px-2 py-2 text-gray-600">{m.call_count}</td>
                            <td className="text-center px-2 py-2 text-gray-600">{formatLatency(m.avg_latency_ms)}</td>
                            <td className="text-center px-2 py-2 text-gray-600">{formatNumber(m.total_tokens)}</td>
                            <td className="text-center px-2 py-2 text-red-600 font-medium">{m.errors}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent Errors */}
              {recentErrors.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-red-600" />
                    Recent Errors
                  </h3>
                  <div className="space-y-2">
                    {recentErrors.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setSelectedLogId(e.id)}
                        className="w-full text-left bg-red-50 border border-red-100 rounded-lg p-3 hover:bg-red-100 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs font-medium text-red-700 truncate">{e.error_message}</div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">{formatTime(e.created_at)}</span>
                        </div>
                        <div className="flex gap-3 mt-1 text-xs text-red-600">
                          <span>{e.analysis_type}</span>
                          <span>{e.model}</span>
                          <span>{formatLatency(e.latency_ms)}</span>
                          {e.fallback_used && <span className="text-amber-600">Fallback used</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  type="text"
                  placeholder="Search responses, errors..."
                  value={logSearch}
                  onChange={e => { setLogSearch(e.target.value); setLogsPage(1); }}
                  className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-even-blue"
                />
              </div>
              <select
                value={logStatusFilter}
                onChange={e => { setLogStatusFilter(e.target.value); setLogsPage(1); }}
                className="px-3 py-2 text-xs border border-gray-200 rounded-lg"
              >
                <option value="">All statuses</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
                <option value="fallback">Fallback</option>
              </select>
              <select
                value={logTypeFilter}
                onChange={e => { setLogTypeFilter(e.target.value); setLogsPage(1); }}
                className="px-3 py-2 text-xs border border-gray-200 rounded-lg"
              >
                <option value="">All types</option>
                {analysisTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Log table */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {logsLoading ? (
                <div className="p-8 text-center text-sm text-gray-500">Loading logs...</div>
              ) : logs.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">No LLM calls found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Time</th>
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Type</th>
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Model</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Status</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Latency</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Tokens</th>
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log => (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedLogId(log.id)}
                          className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                        >
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatTime(log.created_at)}</td>
                          <td className="px-3 py-2 text-gray-700 font-medium">{log.analysis_type}</td>
                          <td className="px-3 py-2 text-gray-600 font-mono">{log.model}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${getStatusBadge(log.status)}`}>
                              {log.status}
                            </span>
                            {log.cache_hit && <span className="ml-1 text-blue-500" title="Cache hit">C</span>}
                            {log.fallback_used && <span className="ml-1 text-amber-500" title="Fallback">F</span>}
                          </td>
                          <td className="px-3 py-2 text-center text-gray-600">{formatLatency(log.latency_ms)}</td>
                          <td className="px-3 py-2 text-center text-gray-600">{log.tokens_total}</td>
                          <td className="px-3 py-2 text-gray-600 truncate max-w-[120px]">{log.triggered_by_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              <div className="border-t border-gray-100 p-3 flex items-center justify-between">
                <button onClick={() => setLogsPage(p => Math.max(1, p - 1))} disabled={logsPage === 1}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 text-gray-700">
                  <ChevronLeft size={18} />
                </button>
                <span className="text-xs text-gray-600">Page {logsPage} of {logsTotalPages}</span>
                <button onClick={() => setLogsPage(p => Math.min(logsTotalPages, p + 1))} disabled={logsPage === logsTotalPages}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 text-gray-700">
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedLogId && (
        <LogDetailModal logId={selectedLogId} onClose={() => setSelectedLogId(null)} />
      )}
    </AdminShell>
  );
}
