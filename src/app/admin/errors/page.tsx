'use client';

import { useState, useEffect } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  AlertTriangle,
  Bug,
  Shield,
  Activity,
  ChevronDown,
  X,
  TrendingUp,
} from 'lucide-react';

// Types
interface ErrorOverview {
  total_errors: number;
  errors_24h: number;
  errors_7d: number;
  unique_messages: number;
  affected_users: number;
  top_severity: string;
}

interface BySeverity {
  severity: string;
  count: number;
}

interface ByComponent {
  component: string;
  count: number;
  latest_at: string;
}

interface ByUrl {
  url: string;
  count: number;
}

interface DailyTrend {
  date: string;
  count: number;
}

interface ErrorCluster {
  message: string;
  component: string;
  url: string;
  severity: string;
  count: number;
  first_seen: string;
  last_seen: string;
  affected_users: number;
}

interface RecentError {
  id: string;
  message: string;
  component: string;
  url: string;
  severity: string;
  profile_name: string;
  user_role: string;
  created_at: string;
}

interface ErrorData {
  overview: ErrorOverview;
  by_severity: BySeverity[];
  by_component: ByComponent[];
  by_url: ByUrl[];
  daily_trend: DailyTrend[];
  error_clusters: ErrorCluster[];
  recent_errors: RecentError[];
}

// Helpers
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function getSeverityColor(severity: string): string {
  if (severity === 'error') return 'bg-red-500';
  if (severity === 'warning') return 'bg-amber-500';
  return 'bg-blue-500';
}

function getSeverityBadgeColor(severity: string): string {
  if (severity === 'error') return 'bg-red-100 text-red-700';
  if (severity === 'warning') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

function getSeverityBorderColor(severity: string): string {
  if (severity === 'error') return 'border-l-red-500';
  if (severity === 'warning') return 'border-l-amber-500';
  return 'border-l-blue-500';
}

// Stat Card
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

// Error Detail Modal
function ErrorDetailModal({ error, onClose }: { error: ErrorCluster; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-gray-200 max-w-3xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="text-sm font-semibold text-even-navy">Error Cluster Details</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Error Message */}
          <div>
            <h4 className="text-xs font-semibold text-gray-700 mb-2">Error Message</h4>
            <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
              {error.message}
            </pre>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-gray-500">Severity:</span>
              <span className={`ml-2 px-1.5 py-0.5 rounded font-medium ${getSeverityBadgeColor(error.severity)}`}>
                {error.severity}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Component:</span>
              <span className="ml-2 font-medium text-gray-700">{error.component || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Occurrences:</span>
              <span className="ml-2 font-bold text-gray-900">{error.count}</span>
            </div>
            <div>
              <span className="text-gray-500">Affected Users:</span>
              <span className="ml-2 font-medium text-gray-700">{error.affected_users}</span>
            </div>
            <div>
              <span className="text-gray-500">First Seen:</span>
              <span className="ml-2 font-medium text-gray-700">{formatTime(error.first_seen)}</span>
            </div>
            <div>
              <span className="text-gray-500">Last Seen:</span>
              <span className="ml-2 font-medium text-gray-700">{formatTime(error.last_seen)}</span>
            </div>
          </div>

          {/* URL */}
          {error.url && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">Page URL</h4>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 break-all">
                {error.url}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main Page
export default function ErrorForensicsPage() {
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, escalations: 0 });
  const [healthData, setHealthData] = useState<any>(null);

  const [data, setData] = useState<ErrorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs'>('overview');
  const [expandedCluster, setExpandedCluster] = useState<ErrorCluster | null>(null);
  const [recentErrorsExpanded, setRecentErrorsExpanded] = useState<{ [key: string]: boolean }>({});

  // Fetch metadata
  useEffect(() => {
    fetch('/api/profiles/me').then(r => r.json()).then(d => {
      if (d.success && d.data?.role) setUserRole(d.data.role);
    }).catch(() => {});

    Promise.all([
      fetch('/api/admin/approvals').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/escalation/log?resolved=false').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([approvals, escalations]) => {
      setBadges({
        approvals: approvals.data?.length || 0,
        escalations: escalations.data?.length || 0,
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

  // Fetch error analytics
  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/errors/analytics')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setData(d.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AdminShell activeSection="errors" userRole={userRole} badges={badges} health={healthData}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Error Forensics</h1>
            <p className="text-sm text-gray-600 mt-1">Comprehensive error analysis and root cause tracking</p>
          </div>
          <div className="p-8 text-center text-sm text-gray-500">Loading error analytics...</div>
        </div>
      </AdminShell>
    );
  }

  if (!data) {
    return (
      <AdminShell activeSection="errors" userRole={userRole} badges={badges} health={healthData}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Error Forensics</h1>
            <p className="text-sm text-gray-600 mt-1">Comprehensive error analysis and root cause tracking</p>
          </div>
          <div className="p-8 text-center text-sm text-gray-500">No error data available</div>
        </div>
      </AdminShell>
    );
  }

  const maxDailyCount = data.daily_trend.length > 0 ? Math.max(...data.daily_trend.map(d => d.count)) : 1;
  const maxSeverityCount = data.by_severity.length > 0 ? Math.max(...data.by_severity.map(s => s.count)) : 1;
  const maxComponentCount = data.by_component.length > 0 ? Math.max(...data.by_component.map(c => c.count)) : 1;

  return (
    <AdminShell activeSection="errors" userRole={userRole} badges={badges} health={healthData}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-even-navy">Error Forensics</h1>
          <p className="text-sm text-gray-600 mt-1">Comprehensive error analysis and root cause tracking</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-gray-100 p-1 flex gap-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'overview' ? 'bg-even-blue text-white' : 'text-gray-700 hover:bg-gray-100'
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
            <span className="flex items-center gap-2"><Bug size={16} /> Error Log</span>
          </button>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Errors"
                value={formatNumber(data.overview.total_errors)}
                icon={<AlertTriangle size={20} className="text-red-600" />}
                color="bg-red-100"
              />
              <StatCard
                label="Last 24h"
                value={formatNumber(data.overview.errors_24h)}
                subValue={`${data.overview.affected_users} users`}
                icon={<TrendingUp size={20} className="text-orange-600" />}
                color="bg-orange-100"
              />
              <StatCard
                label="Last 7d"
                value={formatNumber(data.overview.errors_7d)}
                subValue={`${data.overview.unique_messages} unique`}
                icon={<Shield size={20} className="text-purple-600" />}
                color="bg-purple-100"
              />
              <StatCard
                label="Affected Users"
                value={formatNumber(data.overview.affected_users)}
                subValue={`Top: ${data.overview.top_severity}`}
                icon={<Activity size={20} className="text-blue-600" />}
                color="bg-blue-100"
              />
            </div>

            {/* Daily Error Trend */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-even-navy mb-4">Daily Error Trend (Last 30 Days)</h3>
              {data.daily_trend.length > 0 ? (
                <div className="flex items-end gap-1 h-32">
                  {data.daily_trend.map((d, i) => {
                    const barH = maxDailyCount > 0 ? (d.count / maxDailyCount) * 100 : 0;
                    const date = new Date(d.date);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.count} errors`}>
                        <div className="w-full relative" style={{ height: Math.max(barH, 2) + '%', minHeight: '2px' }}>
                          <div className="absolute bottom-0 w-full bg-red-500 rounded-t" style={{ height: '100%' }} />
                        </div>
                        <span className="text-xs text-gray-400 -rotate-45 origin-center whitespace-nowrap" style={{ fontSize: '9px' }}>
                          {date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-500 text-center py-4">No data</div>
              )}
            </div>

            {/* Two Column: By Severity + By Component */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Severity */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">Errors by Severity</h3>
                {data.by_severity.length > 0 ? (
                  <div className="space-y-3">
                    {data.by_severity.map((s, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-24 text-xs text-gray-600 font-medium">{s.severity}</div>
                        <div className="flex-1 h-6 bg-gray-100 rounded flex items-center overflow-hidden">
                          <div
                            className={`h-full ${getSeverityColor(s.severity)} rounded transition-all`}
                            style={{ width: (s.count / maxSeverityCount) * 100 + '%' }}
                          />
                        </div>
                        <div className="w-12 text-right text-xs font-bold text-gray-900">{s.count}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 text-center py-4">No data</div>
                )}
              </div>

              {/* By Component */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">Errors by Component</h3>
                {data.by_component.length > 0 ? (
                  <div className="space-y-2">
                    {data.by_component.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="font-medium text-gray-700 truncate">{c.component || 'Unknown'}</div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="w-20 h-4 bg-gray-100 rounded flex items-center overflow-hidden">
                            <div
                              className="h-full bg-blue-400 rounded"
                              style={{ width: (c.count / maxComponentCount) * 100 + '%' }}
                            />
                          </div>
                          <div className="w-8 text-right font-bold text-gray-900">{c.count}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 text-center py-4">No data</div>
                )}
              </div>
            </div>

            {/* Error Clusters (Top 20) */}
            {data.error_clusters.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="p-5 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-even-navy flex items-center gap-2">
                    <AlertTriangle size={16} className="text-red-600" />
                    Error Clusters (Top 20)
                  </h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {data.error_clusters.map((cluster, i) => (
                    <button
                      key={i}
                      onClick={() => setExpandedCluster(cluster)}
                      className={`w-full text-left p-4 hover:bg-gray-50 transition-colors border-l-4 ${getSeverityBorderColor(cluster.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getSeverityBadgeColor(cluster.severity)}`}>
                              {cluster.severity}
                            </span>
                            <span className="text-xs font-medium text-gray-600">{cluster.component || 'Unknown'}</span>
                          </div>
                          <p className="text-sm text-gray-700 truncate">{cluster.message}</p>
                          <div className="flex gap-3 mt-2 text-xs text-gray-500">
                            <span>{cluster.count} errors</span>
                            <span>{cluster.affected_users} users</span>
                            <span>Last: {new Date(cluster.last_seen).toLocaleDateString('en-IN')}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-gray-400">
                          <ChevronDown size={16} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error Log Tab */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {data.recent_errors.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">No recent errors</div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                  {data.recent_errors.map((error) => (
                    <div key={error.id}>
                      <button
                        onClick={() => setRecentErrorsExpanded(prev => ({ ...prev, [error.id]: !prev[error.id] }))}
                        className="w-full text-left p-4 hover:bg-gray-50 transition-colors border-l-4 flex items-start justify-between gap-3"
                        style={{ borderLeftColor: getSeverityColor(error.severity).replace('bg-', '') === 'red-500' ? '#ef4444' : getSeverityColor(error.severity).replace('bg-', '') === 'amber-500' ? '#f59e0b' : '#3b82f6' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getSeverityBadgeColor(error.severity)}`}>
                              {error.severity}
                            </span>
                            <span className="text-xs text-gray-600">{error.component || 'Unknown'}</span>
                          </div>
                          <p className="text-sm text-gray-700 truncate">{error.message}</p>
                          <div className="flex gap-3 mt-1 text-xs text-gray-500">
                            <span>{error.profile_name || 'Anonymous'}</span>
                            <span>{formatTime(error.created_at)}</span>
                          </div>
                        </div>
                        <ChevronDown
                          size={16}
                          className={`flex-shrink-0 text-gray-400 transition-transform ${recentErrorsExpanded[error.id] ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {/* Expanded Details */}
                      {recentErrorsExpanded[error.id] && (
                        <div className="bg-gray-50 border-t border-gray-100 p-4 space-y-2">
                          <div>
                            <span className="text-xs text-gray-500">User Role:</span>
                            <span className="ml-2 text-xs font-medium text-gray-700">{error.user_role}</span>
                          </div>
                          {error.url && (
                            <div>
                              <span className="text-xs text-gray-500">URL:</span>
                              <div className="mt-1 text-xs text-gray-700 bg-white border border-gray-200 rounded p-2 break-all font-mono">
                                {error.url}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {expandedCluster && (
        <ErrorDetailModal error={expandedCluster} onClose={() => setExpandedCluster(null)} />
      )}
    </AdminShell>
  );
}
