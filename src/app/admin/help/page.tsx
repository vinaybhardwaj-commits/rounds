'use client';

import { useState, useEffect } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  HelpCircle,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Search,
  Users,
  BarChart3,
  Zap,
} from 'lucide-react';

// Types
interface Overview {
  total_questions: number;
  unique_users: number;
  ai_answers: number;
  template_answers: number;
  no_match: number;
  satisfaction_rate: number;
  rated_count: number;
}

interface BySource {
  response_source: string;
  count: number;
  helpful_count: number;
  unhelpful_count: number;
}

interface ByPage {
  context_page: string;
  count: number;
}

interface DailyTrend {
  date: string;
  count: number;
}

interface TopQuestion {
  question: string;
  count: number;
  response_source: string;
  helpful: boolean | null;
}

interface FeatureCoverage {
  feature: string;
  mention_count: number;
}

interface RecentQuestion {
  id: string;
  question: string;
  response_source: string;
  context_page: string;
  helpful: boolean | null;
  profile_name: string;
  created_at: string;
}

interface AnalyticsData {
  overview: Overview;
  by_source: BySource[];
  by_page: ByPage[];
  daily_trend: DailyTrend[];
  top_questions: TopQuestion[];
  feature_coverage: FeatureCoverage[];
  recent_questions: RecentQuestion[];
}

// Helpers
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
}

function getSourceBadgeColor(source: string) {
  if (source === 'ai') return 'bg-blue-100 text-blue-700';
  if (source === 'template') return 'bg-gray-100 text-gray-700';
  return 'bg-red-100 text-red-700';
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

// Main Page
export default function HelpAnalyticsPage() {
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, admissions: 0, escalations: 0 });
  const [healthData, setHealthData] = useState<any>(null);
  const [data, setData] = useState<AnalyticsData | null>(null);
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
    fetch('/api/admin/help/analytics')
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
      <AdminShell activeSection="help" userRole={userRole} badges={badges} health={healthData}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Help System Analytics</h1>
            <p className="text-sm text-gray-600 mt-1">Monitor help questions, coverage, and satisfaction</p>
          </div>
          <div className="p-8 text-center text-sm text-gray-500">Loading analytics...</div>
        </div>
      </AdminShell>
    );
  }

  if (!data) {
    return (
      <AdminShell activeSection="help" userRole={userRole} badges={badges} health={healthData}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Help System Analytics</h1>
            <p className="text-sm text-gray-600 mt-1">Monitor help questions, coverage, and satisfaction</p>
          </div>
          <div className="p-8 text-center text-sm text-gray-500">No data available</div>
        </div>
      </AdminShell>
    );
  }

  const { overview, by_source, by_page, daily_trend, top_questions, feature_coverage, recent_questions } = data;
  const ai_rate = overview.total_questions > 0
    ? Math.round((overview.ai_answers / overview.total_questions) * 100)
    : 0;

  const maxDailyCount = daily_trend.length > 0 ? Math.max(...daily_trend.map(d => d.count)) : 1;
  const maxPageCount = by_page.length > 0 ? Math.max(...by_page.map(p => p.count)) : 1;
  const maxFeatureCount = feature_coverage.length > 0 ? Math.max(...feature_coverage.map(f => f.mention_count)) : 1;

  return (
    <AdminShell activeSection="help" userRole={userRole} badges={badges} health={healthData}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-even-navy">Help System Analytics</h1>
          <p className="text-sm text-gray-600 mt-1">Monitor help questions, coverage, and satisfaction</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Questions"
            value={formatNumber(overview.total_questions)}
            icon={<MessageSquare size={20} className="text-blue-600" />}
            color="bg-blue-100"
          />
          <StatCard
            label="Unique Users"
            value={formatNumber(overview.unique_users)}
            icon={<Users size={20} className="text-green-600" />}
            color="bg-green-100"
          />
          <StatCard
            label="AI Answer Rate"
            value={ai_rate + '%'}
            subValue={`${overview.ai_answers} answered`}
            icon={<Zap size={20} className="text-purple-600" />}
            color="bg-purple-100"
          />
          <StatCard
            label="Satisfaction Rate"
            value={overview.satisfaction_rate + '%'}
            subValue={`${overview.rated_count} rated`}
            icon={
              <div className="text-lg">
                {overview.satisfaction_rate > 70 ? '🟢' : overview.satisfaction_rate > 40 ? '🟡' : '🔴'}
              </div>
            }
            color={
              overview.satisfaction_rate > 70
                ? 'bg-green-100'
                : overview.satisfaction_rate > 40
                  ? 'bg-amber-100'
                  : 'bg-red-100'
            }
          />
        </div>

        {/* Daily Trend Chart */}
        {daily_trend.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-even-navy mb-4">Daily Questions Trend (30 days)</h3>
            <div className="flex items-end gap-1 h-40">
              {daily_trend.map((d, i) => {
                const barH = maxDailyCount > 0 ? (d.count / maxDailyCount) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex-1 relative bg-blue-100 rounded-t cursor-pointer hover:bg-blue-200 transition-colors"
                    style={{ height: Math.max(barH, 2) + '%', minHeight: '2px' }}
                    title={`${d.date}: ${d.count} questions`}
                  >
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-gray-600 whitespace-nowrap">
                      {d.count > 0 ? d.count : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-6">
              <span>{daily_trend[0]?.date}</span>
              <span>{daily_trend[daily_trend.length - 1]?.date}</span>
            </div>
          </div>
        )}

        {/* Response Source Breakdown */}
        {by_source.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-even-navy mb-4">Response Source Breakdown</h3>
            <div className="space-y-3">
              {by_source.map((s, i) => {
                const pct = overview.total_questions > 0
                  ? Math.round((s.count / overview.total_questions) * 100)
                  : 0;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getSourceBadgeColor(s.response_source)}`}>
                          {s.response_source === 'ai' ? 'AI Answer' : s.response_source === 'template' ? 'Template' : 'No Match'}
                        </span>
                        <span className="text-xs text-gray-600">{s.count} questions</span>
                      </div>
                      <span className="text-sm font-semibold text-even-navy">{pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          s.response_source === 'ai'
                            ? 'bg-even-blue'
                            : s.response_source === 'template'
                              ? 'bg-gray-400'
                              : 'bg-red-400'
                        }`}
                        style={{ width: pct + '%' }}
                      />
                    </div>
                    {s.count > 0 && (
                      <div className="flex gap-4 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <ThumbsUp size={12} className="text-green-600" /> {s.helpful_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <ThumbsDown size={12} className="text-red-600" /> {s.unhelpful_count}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Two column: Top Questions + Feature Coverage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Questions */}
          {top_questions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-even-navy mb-4">Top Questions (10)</h3>
              <div className="space-y-2">
                {top_questions.map((q, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-xs text-gray-700 flex-1">{truncate(q.question, 80)}</p>
                      <span className="text-xs font-semibold text-even-navy whitespace-nowrap">{q.count}x</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${getSourceBadgeColor(q.response_source)}`}>
                        {q.response_source === 'ai' ? 'AI' : q.response_source === 'template' ? 'Tmpl' : 'None'}
                      </span>
                      {q.helpful === true ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <ThumbsUp size={12} /> Helpful
                        </span>
                      ) : q.helpful === false ? (
                        <span className="flex items-center gap-1 text-red-600">
                          <ThumbsDown size={12} /> Not helpful
                        </span>
                      ) : (
                        <span className="text-gray-400">Not rated</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature Coverage */}
          {feature_coverage.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-even-navy mb-4">Feature Coverage</h3>
              <div className="space-y-2">
                {feature_coverage.map((f, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-700">{truncate(f.feature, 40)}</span>
                        <span className="text-xs text-gray-600">{f.mention_count}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-even-blue transition-all"
                          style={{ width: (f.mention_count / maxFeatureCount) * 100 + '%' }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* By Page Distribution */}
        {by_page.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-even-navy mb-4">Questions by Page</h3>
            <div className="space-y-2">
              {by_page.map((p, i) => {
                const pct = overview.total_questions > 0
                  ? Math.round((p.count / overview.total_questions) * 100)
                  : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-700">{truncate(p.context_page || 'Unknown', 50)}</span>
                        <span className="text-xs font-semibold text-gray-700">{p.count}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-even-navy transition-all"
                          style={{ width: (p.count / maxPageCount) * 100 + '%' }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Questions Table */}
        {recent_questions.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-even-navy">Recent Questions (10)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Question</th>
                    <th className="text-center px-3 py-2 text-gray-600 font-medium">Source</th>
                    <th className="text-center px-3 py-2 text-gray-600 font-medium">Helpful</th>
                    <th className="text-left px-3 py-2 text-gray-600 font-medium">Page</th>
                    <th className="text-left px-3 py-2 text-gray-600 font-medium">User</th>
                    <th className="text-left px-3 py-2 text-gray-600 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_questions.map((q) => (
                    <tr key={q.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2 text-gray-700">{truncate(q.question, 50)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getSourceBadgeColor(q.response_source)}`}>
                          {q.response_source === 'ai' ? 'AI' : q.response_source === 'template' ? 'Tmpl' : 'None'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {q.helpful === true ? (
                          <ThumbsUp size={14} className="inline text-green-600" />
                        ) : q.helpful === false ? (
                          <ThumbsDown size={14} className="inline text-red-600" />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600 max-w-xs truncate">{truncate(q.context_page || '—', 30)}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-xs truncate">{q.profile_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatTime(q.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
