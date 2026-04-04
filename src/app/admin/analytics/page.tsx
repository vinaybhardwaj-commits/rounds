'use client';

// ============================================
// Admin Analytics Dashboard
// Shows DAU, feature adoption, page views,
// session stats, user engagement, errors.
// super_admin only.
// ============================================

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Users,
  MousePointerClick,
  Eye,
  Clock,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Activity,
  ChevronDown,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';

interface DAUEntry { date: string; users: number; }
interface FeatureEntry { feature: string; uses: number; users: number; }
interface PageEntry { page: string; views: number; users: number; }
interface SessionStats { total_sessions: number; unique_users: number; avg_session_seconds: number; }
interface UserRanking { profile_id: string; full_name: string; role: string; email: string; events: number; sessions: number; active_days: number; }
interface ErrorSummary { severity: string; count: number; unique_errors: number; }
interface ErrorDetail { id: number; message: string; severity: string; url: string; component: string; user_role: string; created_at: string; }

interface AnalyticsData {
  period_days: number;
  dau: DAUEntry[];
  features: FeatureEntry[];
  pages: PageEntry[];
  sessions: SessionStats;
  userRanking: UserRanking[];
  errors: ErrorSummary[];
}

const FEATURE_LABELS: Record<string, string> = {
  login_success: 'Login',
  chat_send_message: 'Chat Message Sent',
  chat_file_upload: 'File Uploaded (Chat)',
  patient_create: 'Patient Created',
  patient_import_csv: 'CSV Import',
  patient_stage_advance: 'Stage Advanced',
  patient_archive: 'Patient Archived',
  form_submit: 'Form Submitted',
  ot_surgery_posted: 'Surgery Posted',
  ot_readiness_confirm: 'OT Item Confirmed',
  ot_readiness_bulk_confirm: 'OT Bulk Confirm',
  help_open: 'Help Widget Opened',
  help_ask: 'Help Question Asked',
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Admin',
  department_head: 'Dept Head',
  doctor: 'Doctor',
  surgeon: 'Surgeon',
  nurse: 'Nurse',
  ip_coordinator: 'IP Coord',
  billing_executive: 'Billing',
  ot_coordinator: 'OT Coord',
  insurance_coordinator: 'Insurance',
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [errors, setErrors] = useState<ErrorDetail[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [showErrors, setShowErrors] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, errorsRes] = await Promise.all([
        fetch(`/api/analytics/dashboard?days=${days}`),
        fetch('/api/errors'),
      ]);
      const analyticsData = await analyticsRes.json();
      const errorsData = await errorsRes.json();

      if (analyticsData.success) setData(analyticsData.data);
      if (errorsData.success) setErrors(errorsData.data.errors || []);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Bar chart helper — max value determines scale
  const renderBar = (value: number, max: number, color: string = 'bg-even-blue') => (
    <div className="w-full bg-gray-100 rounded-full h-5 relative overflow-hidden">
      <div
        className={`h-full rounded-full ${color} transition-all duration-500`}
        style={{ width: `${max > 0 ? Math.max((value / max) * 100, 2) : 0}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-semibold text-gray-700">
        {value.toLocaleString('en-IN')}
      </span>
    </div>
  );

  return (
    <AdminLayout title="Analytics" subtitle="Usage, adoption & errors">
      {/* Controls */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-gray-700 focus:ring-2 focus:ring-even-blue focus:border-transparent"
          >
            <option value={1}>Today</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <div className="text-center py-12 text-gray-400">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading analytics...</p>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* ── Summary Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Users className="w-4 h-4" />
                <span className="text-xs font-medium uppercase">Unique Users</span>
              </div>
              <p className="text-2xl font-bold text-even-navy">{data.sessions.unique_users}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Activity className="w-4 h-4" />
                <span className="text-xs font-medium uppercase">Sessions</span>
              </div>
              <p className="text-2xl font-bold text-even-navy">{data.sessions.total_sessions}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Clock className="w-4 h-4" />
                <span className="text-xs font-medium uppercase">Avg Session</span>
              </div>
              <p className="text-2xl font-bold text-even-navy">{formatDuration(data.sessions.avg_session_seconds)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-medium uppercase">Errors</span>
              </div>
              <p className="text-2xl font-bold text-red-600">
                {data.errors.reduce((s, e) => s + e.count, 0)}
              </p>
            </div>
          </div>

          {/* ── DAU Chart ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-even-blue" />
              Daily Active Users
            </h3>
            {data.dau.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No data yet</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {data.dau.slice().reverse().map((d) => {
                  const max = Math.max(...data.dau.map(x => x.users), 1);
                  const height = Math.max((d.users / max) * 100, 4);
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.users} users`}>
                      <span className="text-[9px] text-gray-500 font-medium">{d.users}</span>
                      <div className="w-full bg-even-blue/80 rounded-t-sm transition-all duration-300" style={{ height: `${height}%` }} />
                      <span className="text-[8px] text-gray-400">{formatDate(d.date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Feature Adoption + Page Views ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Features */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <MousePointerClick className="w-4 h-4 text-green-600" />
                Feature Adoption
              </h3>
              {data.features.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No feature usage yet</p>
              ) : (
                <div className="space-y-2">
                  {data.features.slice(0, 15).map((f) => {
                    const maxUses = data.features[0]?.uses || 1;
                    return (
                      <div key={f.feature} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-32 truncate shrink-0" title={f.feature}>
                          {FEATURE_LABELS[f.feature] || f.feature}
                        </span>
                        <div className="flex-1">
                          {renderBar(f.uses, maxUses, 'bg-green-500')}
                        </div>
                        <span className="text-[10px] text-gray-400 w-12 text-right shrink-0">
                          {f.users} user{f.users !== 1 ? 's' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pages */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-600" />
                Page Views
              </h3>
              {data.pages.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No page views yet</p>
              ) : (
                <div className="space-y-2">
                  {data.pages.slice(0, 15).map((p) => {
                    const maxViews = data.pages[0]?.views || 1;
                    return (
                      <div key={p.page} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-32 truncate shrink-0 font-mono" title={p.page}>
                          {p.page}
                        </span>
                        <div className="flex-1">
                          {renderBar(p.views, maxViews, 'bg-purple-500')}
                        </div>
                        <span className="text-[10px] text-gray-400 w-12 text-right shrink-0">
                          {p.users} user{p.users !== 1 ? 's' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── User Engagement Ranking ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-even-blue" />
              Most Active Users
            </h3>
            {data.userRanking.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No user data yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">#</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">User</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Role</th>
                      <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">Sessions</th>
                      <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">Events</th>
                      <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">Active Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.userRanking.map((u, i) => (
                      <tr key={u.profile_id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 px-2 text-gray-400 font-medium">{i + 1}</td>
                        <td className="py-2 px-2">
                          <div className="font-medium text-gray-800">{u.full_name || u.email}</div>
                          {u.full_name && <div className="text-[10px] text-gray-400">{u.email}</div>}
                        </td>
                        <td className="py-2 px-2">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-medium">{u.sessions}</td>
                        <td className="py-2 px-2 text-right font-medium">{u.events}</td>
                        <td className="py-2 px-2 text-right font-medium">{u.active_days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Error Log ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <button
              onClick={() => setShowErrors(!showErrors)}
              className="w-full flex items-center justify-between"
            >
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                Recent Errors ({errors.length})
              </h3>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showErrors ? 'rotate-180' : ''}`} />
            </button>
            {showErrors && (
              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                {errors.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2 text-center">No errors recorded</p>
                ) : (
                  errors.slice(0, 30).map((e) => (
                    <div key={e.id} className="border border-gray-100 rounded-lg p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                            e.severity === 'error' ? 'bg-red-100 text-red-700' :
                            e.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {e.severity}
                          </span>
                          <p className="text-xs text-gray-800 mt-1 font-mono truncate">{e.message}</p>
                          {e.url && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{e.url}</p>}
                        </div>
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {new Date(e.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-center py-12 text-gray-400">Failed to load analytics data</p>
      )}
    </AdminLayout>
  );
}
