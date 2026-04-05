'use client';

import { useState, useEffect } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  FileText,
  BarChart3,
  TrendingUp,
  CheckCircle,
  Calendar,
  User,
} from 'lucide-react';

// Types
interface FormAnalyticsOverview {
  total_submissions: number;
  unique_form_types: number;
  avg_completion_score: string;
  submissions_7d: number;
  submissions_30d: number;
}

interface FormByType {
  form_type: string;
  count: number;
  avg_score: string;
  min_score: string;
  max_score: string;
  latest_at: string;
}

interface FormByDepartment {
  department_name: string;
  count: number;
  avg_score: string;
}

interface DailyTrend {
  date: string;
  count: number;
}

interface CompletionBucket {
  bucket: string;
  count: number;
}

interface RecentSubmission {
  id: string;
  form_type: string;
  status: string;
  completion_score: string;
  submitted_by_name: string;
  department_name: string;
  created_at: string;
}

interface FormAnalyticsData {
  overview: FormAnalyticsOverview;
  by_type: FormByType[];
  by_department: FormByDepartment[];
  daily_trend: DailyTrend[];
  completion_distribution: CompletionBucket[];
  recent_submissions: RecentSubmission[];
}

// Helpers
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatPercent(val: string | number): string {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return (num * 100).toFixed(0) + '%';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function getScoreColor(score: number) {
  if (score < 0.5) return 'bg-red-500';
  if (score < 0.75) return 'bg-amber-500';
  return 'bg-green-500';
}

function getScoreTextColor(score: number) {
  if (score < 0.5) return 'text-red-700';
  if (score < 0.75) return 'text-amber-700';
  return 'text-green-700';
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

// Skeleton loader
function SkeletonLoader() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-20 animate-pulse bg-gray-50" />
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-5 h-48 animate-pulse bg-gray-50" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5 h-64 animate-pulse bg-gray-50" />
        <div className="bg-white rounded-xl border border-gray-100 p-5 h-64 animate-pulse bg-gray-50" />
      </div>
    </div>
  );
}

// Main Page
export default function FormAnalyticsPage() {
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, admissions: 0, escalations: 0 });
  const [healthData, setHealthData] = useState<any>(null);
  const [data, setData] = useState<FormAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Fetch analytics
  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/forms/analytics')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setData(d.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const maxDailyCount = data?.daily_trend && data.daily_trend.length > 0
    ? Math.max(...data.daily_trend.map(d => d.count))
    : 1;

  const maxCompletionCount = data?.completion_distribution && data.completion_distribution.length > 0
    ? Math.max(...data.completion_distribution.map(d => d.count))
    : 1;

  return (
    <AdminShell activeSection="forms" userRole={userRole} badges={badges} health={healthData}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-even-navy">Form Analytics</h1>
          <p className="text-sm text-gray-600 mt-1">Monitor form submissions, completion rates, and response quality across departments</p>
        </div>

        {loading ? (
          <SkeletonLoader />
        ) : !data ? (
          <div className="p-8 text-center text-sm text-gray-500">No form data available</div>
        ) : (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Submissions"
                value={formatNumber(data.overview.total_submissions)}
                subValue={`30d: ${formatNumber(data.overview.submissions_30d)}`}
                icon={<FileText size={20} className="text-blue-600" />}
                color="bg-blue-100"
              />
              <StatCard
                label="Unique Form Types"
                value={data.overview.unique_form_types}
                subValue={`Active forms`}
                icon={<BarChart3 size={20} className="text-purple-600" />}
                color="bg-purple-100"
              />
              <StatCard
                label="Avg Completion"
                value={formatPercent(data.overview.avg_completion_score)}
                subValue={`Field fill rate`}
                icon={<CheckCircle size={20} className="text-green-600" />}
                color="bg-green-100"
              />
              <StatCard
                label="7d Submissions"
                value={formatNumber(data.overview.submissions_7d)}
                subValue={`Week trend`}
                icon={<TrendingUp size={20} className="text-amber-600" />}
                color="bg-amber-100"
              />
            </div>

            {/* Daily submissions chart */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-even-navy mb-4">Daily Submissions (30 days)</h3>
              {data.daily_trend.length > 0 ? (
                <div className="flex items-end gap-1 h-32">
                  {data.daily_trend.map((d, i) => {
                    const barH = maxDailyCount > 0 ? (d.count / maxDailyCount) * 100 : 0;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.count} submissions`}>
                        <div className="w-full relative" style={{ height: Math.max(barH, 2) + '%', minHeight: '2px' }}>
                          <div className="absolute bottom-0 w-full bg-blue-400 rounded-t" style={{ height: '100%' }} />
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

            {/* Two column: By Type + Completion Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Form Type */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">Submissions by Type (7d)</h3>
                {data.by_type.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left px-2 py-2 text-gray-600 font-medium">Form Type</th>
                          <th className="text-center px-2 py-2 text-gray-600 font-medium">Count</th>
                          <th className="text-center px-2 py-2 text-gray-600 font-medium">Avg Score</th>
                          <th className="text-center px-2 py-2 text-gray-600 font-medium">Min/Max</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.by_type.map((t, i) => {
                          const avgScore = parseFloat(t.avg_score);
                          return (
                            <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="text-left px-2 py-2 text-gray-700 font-medium">{t.form_type}</td>
                              <td className="text-center px-2 py-2 text-gray-600">{t.count}</td>
                              <td className="text-center px-2 py-2">
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-12 h-4 bg-gray-100 rounded">
                                    <div
                                      className={`h-full rounded ${getScoreColor(avgScore)}`}
                                      style={{ width: (avgScore * 100) + '%' }}
                                    />
                                  </div>
                                  <span className={`font-medium ${getScoreTextColor(avgScore)}`}>
                                    {formatPercent(t.avg_score)}
                                  </span>
                                </div>
                              </td>
                              <td className="text-center px-2 py-2 text-gray-600">
                                {formatPercent(t.min_score)} / {formatPercent(t.max_score)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 text-center py-4">No data</div>
                )}
              </div>

              {/* Completion Distribution */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">Completion Distribution</h3>
                {data.completion_distribution.length > 0 ? (
                  <div className="space-y-3">
                    {data.completion_distribution.map((d, i) => {
                      const barH = maxCompletionCount > 0 ? (d.count / maxCompletionCount) * 100 : 0;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-20 text-xs text-gray-600 font-medium text-right">{d.bucket}</div>
                          <div className="flex-1 h-6 bg-gray-100 rounded flex items-center">
                            <div
                              className="h-full bg-blue-500 rounded transition-all"
                              style={{ width: barH + '%' }}
                            />
                          </div>
                          <div className="w-12 text-right text-xs font-medium text-gray-700">{d.count}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 text-center py-4">No data</div>
                )}
              </div>
            </div>

            {/* By Department */}
            {data.by_department.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4">Submissions by Department (7d)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Department</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Count</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Avg Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_department.map((d, i) => {
                        const avgScore = parseFloat(d.avg_score);
                        return (
                          <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="text-left px-3 py-2 text-gray-700 font-medium">{d.department_name}</td>
                            <td className="text-center px-3 py-2 text-gray-600">{d.count}</td>
                            <td className="text-center px-3 py-2">
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-16 h-4 bg-gray-100 rounded">
                                  <div
                                    className={`h-full rounded ${getScoreColor(avgScore)}`}
                                    style={{ width: (avgScore * 100) + '%' }}
                                  />
                                </div>
                                <span className={`font-medium ${getScoreTextColor(avgScore)}`}>
                                  {formatPercent(d.avg_score)}
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

            {/* Recent Submissions */}
            {data.recent_submissions.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
                  <Calendar size={16} className="text-blue-600" />
                  Recent Submissions (Last 10)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Form Type</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Status</th>
                        <th className="text-center px-3 py-2 text-gray-600 font-medium">Score</th>
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Submitted By</th>
                        <th className="text-left px-3 py-2 text-gray-600 font-medium">Department</th>
                        <th className="text-right px-3 py-2 text-gray-600 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_submissions.map((s) => {
                        const score = parseFloat(s.completion_score);
                        return (
                          <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="text-left px-3 py-2 text-gray-700 font-medium">{s.form_type}</td>
                            <td className="text-center px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                s.status === 'completed' ? 'bg-green-100 text-green-700' :
                                s.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {s.status}
                              </span>
                            </td>
                            <td className="text-center px-3 py-2">
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-12 h-4 bg-gray-100 rounded">
                                  <div
                                    className={`h-full rounded ${getScoreColor(score)}`}
                                    style={{ width: (score * 100) + '%' }}
                                  />
                                </div>
                                <span className={`font-medium ${getScoreTextColor(score)}`}>
                                  {formatPercent(s.completion_score)}
                                </span>
                              </div>
                            </td>
                            <td className="text-left px-3 py-2 text-gray-600 truncate max-w-[120px]">{s.submitted_by_name}</td>
                            <td className="text-left px-3 py-2 text-gray-600 truncate max-w-[120px]">{s.department_name}</td>
                            <td className="text-right px-3 py-2 text-gray-500 whitespace-nowrap">{formatTime(s.created_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
