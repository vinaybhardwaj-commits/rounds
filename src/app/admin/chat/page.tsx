'use client';

import { useState, useEffect } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  MessageSquare,
  Users,
  Hash,
  Activity,
  RefreshCw,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';

// Types
interface ChatAnalyticsData {
  overview: {
    total_channels: number;
    total_messages: number;
    total_senders: number;
    avg_messages_per_channel: number;
    snapshot_dates: number;
  };
  by_channel_type: Array<{
    channel_type: string;
    channel_count: number;
    total_messages: number;
    avg_messages: number;
  }>;
  daily_trend: Array<{
    date: string;
    total_messages: number;
    unique_senders: number;
  }>;
  top_channels: Array<{
    channel_id: string;
    channel_name: string;
    channel_type: string;
    total_messages: number;
    unique_senders: number;
    last_snapshot_date: string;
  }>;
  activity_summary: {
    human_messages: number;
    system_messages: number;
    human_pct: number;
  };
}

// Format helpers
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function getChannelTypeBadge(type: string) {
  const typeMap: Record<string, { bg: string; text: string }> = {
    patient: { bg: 'bg-blue-100', text: 'text-blue-700' },
    department: { bg: 'bg-green-100', text: 'text-green-700' },
    'cross-functional': { bg: 'bg-purple-100', text: 'text-purple-700' },
    system: { bg: 'bg-gray-100', text: 'text-gray-700' },
  };
  const style = typeMap[type] || typeMap.system;
  return style;
}

// KPI Card component
function KPICard({
  label,
  value,
  icon,
  subValue,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  subValue?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gray-600 font-medium">{label}</div>
          <div className="text-2xl font-bold text-even-navy mt-1">{value}</div>
          {subValue && <div className="text-xs text-gray-500 mt-1">{subValue}</div>}
        </div>
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-even-blue to-even-navy flex items-center justify-center text-white flex-shrink-0">
          {icon}
        </div>
      </div>
    </div>
  );
}

// Main page
export default function ChatAnalyticsPage() {
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, admissions: 0, escalations: 0 });
  const [healthData, setHealthData] = useState<any>(null);

  const [analytics, setAnalytics] = useState<ChatAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch metadata
  useEffect(() => {
    fetch('/api/profiles/me')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data?.role) setUserRole(d.data.role);
      })
      .catch(() => {});

    Promise.all([
      fetch('/api/admin/approvals').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/escalation/log?resolved=false').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/admission-tracker').then(r => r.json()).catch(() => ({ data: [] })),
    ])
      .then(([approvals, escalations, admissions]) => {
        setBadges({
          approvals: approvals.data?.length || 0,
          escalations: escalations.data?.length || 0,
          admissions: admissions.data?.length || 0,
        });
      });

    fetch('/api/admin/health')
      .then(r => r.json())
      .then(d => {
        setHealthData({
          llm: { status: d.status || 'down', latency_ms: d.latency_ms || 0 },
          errors_1h: 0, error_sparkline: [], active_sessions: 0,
          api_p95_ms: 0, api_trend: 'stable' as const,
          forms_today: 0, forms_yesterday: 0, last_deploy: { time: '', sha: '' },
        });
      })
      .catch(() => {});
  }, []);

  // Fetch analytics
  const fetchAnalytics = () => {
    setLoading(true);
    fetch('/api/admin/chat/analytics')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setAnalytics(d.data);
        }
      })
      .catch(err => {
        console.error('Failed to fetch analytics:', err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  // Handle snapshot
  const handleSnapshot = async () => {
    setSnapshotLoading(true);
    setSnapshotMessage(null);
    try {
      const res = await fetch('/api/admin/chat/snapshot', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSnapshotMessage({
          type: 'success',
          text: `Snapshot complete: ${data.data.rows_inserted} channels processed`,
        });
        // Refresh analytics
        setTimeout(() => fetchAnalytics(), 500);
      } else {
        setSnapshotMessage({ type: 'error', text: data.error || 'Snapshot failed' });
      }
    } catch (err) {
      setSnapshotMessage({ type: 'error', text: 'Failed to run snapshot' });
    } finally {
      setSnapshotLoading(false);
      setTimeout(() => setSnapshotMessage(null), 5000);
    }
  };

  const hasData = analytics && analytics.overview.total_channels > 0;
  const maxDailyMessages = analytics?.daily_trend.length
    ? Math.max(...analytics.daily_trend.map(d => d.total_messages))
    : 1;
  const maxChannelMessages = analytics?.top_channels.length
    ? Math.max(...analytics.top_channels.map(c => c.total_messages))
    : 1;

  return (
    <AdminShell activeSection="chat" userRole={userRole} badges={badges} health={healthData}>
      <div className="space-y-6">
        {/* Header with title and snapshot button */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Chat Analytics</h1>
            <p className="text-sm text-gray-600 mt-1">
              Message volume, activity patterns, and communication by channel
            </p>
          </div>
          <button
            onClick={handleSnapshot}
            disabled={snapshotLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-even-blue text-white rounded-lg font-medium text-sm hover:bg-even-navy transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw size={16} className={snapshotLoading ? 'animate-spin' : ''} />
            {snapshotLoading ? 'Refreshing...' : 'Refresh Data'}
          </button>
        </div>

        {/* Snapshot status message */}
        {snapshotMessage && (
          <div
            className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
              snapshotMessage.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p className="text-sm">{snapshotMessage.text}</p>
          </div>
        )}

        {/* Empty state */}
        {!hasData && !loading && (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <MessageSquare size={32} className="mx-auto text-gray-400 mb-3" />
            <h3 className="text-sm font-semibold text-gray-700 mb-1">No chat data yet</h3>
            <p className="text-xs text-gray-500 mb-4">
              Click "Refresh Data" to pull the latest stats from GetStream
            </p>
            <button
              onClick={handleSnapshot}
              disabled={snapshotLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-even-blue text-white rounded-lg font-medium text-sm hover:bg-even-navy transition-colors disabled:opacity-60"
            >
              <RefreshCw size={16} className={snapshotLoading ? 'animate-spin' : ''} />
              {snapshotLoading ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading analytics...</div>
        ) : hasData ? (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KPICard
                label="Total Channels"
                value={formatNumber(analytics.overview.total_channels)}
                icon={<MessageSquare size={20} />}
              />
              <KPICard
                label="Total Messages"
                value={formatNumber(analytics.overview.total_messages)}
                icon={<Hash size={20} />}
              />
              <KPICard
                label="Active Senders"
                value={formatNumber(analytics.overview.total_senders)}
                icon={<Users size={20} />}
              />
              <KPICard
                label="Avg/Channel"
                value={formatNumber(analytics.overview.avg_messages_per_channel)}
                icon={<Activity size={20} />}
              />
            </div>

            {/* Daily Trend */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-even-navy mb-4">Daily Message Trend (Last 30 Days)</h3>
              {analytics.daily_trend.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-end gap-1 h-40">
                    {analytics.daily_trend.map((day, i) => {
                      const barHeight = maxDailyMessages > 0 ? (day.total_messages / maxDailyMessages) * 100 : 0;
                      return (
                        <div
                          key={i}
                          className="flex-1 flex flex-col items-center gap-1"
                          title={`${day.date}: ${day.total_messages} msgs, ${day.unique_senders} senders`}
                        >
                          <div className="w-full h-full bg-gray-50 rounded-t relative" style={{ minHeight: '2px' }}>
                            <div
                              className="absolute bottom-0 w-full bg-gradient-to-t from-even-blue to-cyan-400 rounded-t transition-all"
                              style={{ height: Math.max(barHeight, 2) + '%' }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap" style={{ fontSize: '10px' }}>
                            {new Date(day.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500 text-center py-8">No data</div>
              )}
            </div>

            {/* Activity Split */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-even-navy mb-4">Activity Split</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-3 h-3 rounded bg-even-blue" />
                      <span className="text-xs font-medium text-gray-700">Human Messages</span>
                      <span className="text-xs text-gray-500">{analytics.activity_summary.human_pct}%</span>
                    </div>
                    <div className="h-6 bg-gray-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-even-blue"
                        style={{ width: `${analytics.activity_summary.human_pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-16 text-right">
                    {formatNumber(analytics.activity_summary.human_messages)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-3 h-3 rounded bg-gray-400" />
                      <span className="text-xs font-medium text-gray-700">System Messages</span>
                      <span className="text-xs text-gray-500">{100 - analytics.activity_summary.human_pct}%</span>
                    </div>
                    <div className="h-6 bg-gray-100 rounded-lg overflow-hidden">
                      <div className="h-full bg-gray-400" style={{ width: `${100 - analytics.activity_summary.human_pct}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-16 text-right">
                    {formatNumber(analytics.activity_summary.system_messages)}
                  </span>
                </div>
              </div>
            </div>

            {/* By Channel Type */}
            {analytics.by_channel_type.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">By Channel Type</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Channel Type</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Count</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Total Messages</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Avg/Channel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.by_channel_type.map((row, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="text-left px-3 py-2">
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getChannelTypeBadge(
                                row.channel_type,
                              ).bg} ${getChannelTypeBadge(row.channel_type).text}`}
                            >
                              {row.channel_type}
                            </span>
                          </td>
                          <td className="text-center px-3 py-2 text-gray-700 font-medium">{row.channel_count}</td>
                          <td className="text-center px-3 py-2 text-gray-700 font-bold">
                            {formatNumber(row.total_messages)}
                          </td>
                          <td className="text-center px-3 py-2 text-gray-600">
                            {formatNumber(row.avg_messages)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Top Channels */}
            {analytics.top_channels.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">Top 20 Channels</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Channel Name</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Type</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Messages</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Senders</th>
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.top_channels.map((channel, i) => {
                        const barWidth =
                          maxChannelMessages > 0 ? (channel.total_messages / maxChannelMessages) * 100 : 0;
                        return (
                          <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="text-left px-3 py-2 text-gray-700 font-medium truncate max-w-xs">
                              {channel.channel_name}
                            </td>
                            <td className="text-center px-3 py-2">
                              <span
                                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getChannelTypeBadge(
                                  channel.channel_type,
                                ).bg} ${getChannelTypeBadge(channel.channel_type).text}`}
                              >
                                {channel.channel_type}
                              </span>
                            </td>
                            <td className="text-center px-3 py-2 text-gray-700 font-bold">
                              {formatNumber(channel.total_messages)}
                            </td>
                            <td className="text-center px-3 py-2 text-gray-600">
                              {formatNumber(channel.unique_senders)}
                            </td>
                            <td className="text-left px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-4 bg-gray-100 rounded">
                                  <div
                                    className="h-full bg-even-blue rounded transition-all"
                                    style={{ width: `${barWidth}%` }}
                                  />
                                </div>
                                <span className="text-gray-500 text-xs whitespace-nowrap">
                                  {Math.round(barWidth)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
