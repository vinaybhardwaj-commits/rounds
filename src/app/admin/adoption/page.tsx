'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { Sparkline } from '@/components/admin/Sparkline';
import {
  AlertCircle,
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  Clock,
  HelpCircle,
  LogIn,
  TrendingDown,
  Users,
  Zap,
} from 'lucide-react';

// Types
interface FunnelData {
  signed_up: number;
  approved: number;
  first_login: number;
  active_7d: number;
  regular_30d: number;
}

interface CohortData {
  week: string;
  signed_up: number;
  approved: number;
  first_login: number;
  active_7d: number;
  regular_30d: number;
}

interface StuckUser {
  id: string;
  full_name: string;
  email: string;
  approved_at?: string;
  first_login_at?: string;
  last_active_at?: string;
  login_count?: number;
}

interface DepartmentUser {
  id: string;
  full_name: string;
  email: string;
  first_login_at: string | null;
  last_active_at: string | null;
  login_count: number;
  total_session_seconds: number;
}

interface DepartmentData {
  department_id: string;
  department_name: string;
  slug: string;
  total_users: number;
  logged_in_users: number;
  active_7d: number;
  regular_users: number;
  avg_session_seconds: number;
  last_activity: string;
  forms_7d: number;
  help_count_7d: number;
  sparkline_14d: number[];
  users: DepartmentUser[];
}

interface FormDropoff {
  form_type: string;
  total: number;
  completed: number;
  abandoned: number;
  completion_rate: number;
}

interface BounceSession {
  id: string;
  full_name: string;
  email: string;
  department_name: string;
  first_login_at: string;
  total_session_seconds: number;
}

interface HelpGap {
  question: string;
  search_count: number;
  unique_users: number;
  last_searched: string;
}

interface ErrorHotspot {
  location: string;
  error_count: number;
  affected_users: number;
  sample_messages: string[];
}

interface FeatureUsage {
  page: string;
  unique_users: number;
  total_views: number;
}

interface DurationBucket {
  bucket: string;
  count: number;
}

interface FrictionData {
  form_dropoffs: FormDropoff[];
  bounce_sessions: BounceSession[];
  help_gaps: HelpGap[];
  error_hotspots: ErrorHotspot[];
  feature_usage: FeatureUsage[];
  duration_distribution: DurationBucket[];
}

// Helper functions
const getConversionRate = (from: number, to: number): string => {
  if (from === 0) return '0%';
  return ((to / from) * 100).toFixed(0) + '%';
};

const getConversionColor = (rate: number): string => {
  if (rate >= 70) return 'bg-green-200';
  if (rate >= 40) return 'bg-amber-200';
  return 'bg-red-200';
};

const getConversionBadge = (rate: number): string => {
  if (rate >= 70) return 'text-green-700 bg-green-50';
  if (rate >= 40) return 'text-amber-700 bg-amber-50';
  return 'text-red-700 bg-red-50';
};

const getStatusDot = (adoptionRate: number): string => {
  if (adoptionRate >= 70) return 'bg-green-500';
  if (adoptionRate >= 40) return 'bg-amber-500';
  return 'bg-red-500';
};

const formatDate = (date: string | null): string => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
};

const formatDaysAgo = (date: string | null): string => {
  if (!date) return '—';
  const now = new Date();
  const then = new Date(date);
  const days = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
};

const formatMinutes = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '< 1m';
  if (minutes >= 60) return Math.round(minutes / 60) + 'h';
  return minutes + 'm';
};

// Tab: Funnel
function FunnelTab() {
  const [funnelData, setFunnelData] = useState<{
    funnel: FunnelData;
    cohorts: CohortData[];
    stuck: { approved_no_login: StuckUser[]; logged_in_inactive: StuckUser[] };
  } | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/admin/adoption/funnel');
        if (!res.ok) throw new Error('Failed to fetch funnel data');
        const json = await res.json();
        if (json.success) {
          setFunnelData(json.data);
        } else {
          setError('API returned success: false');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="p-5 text-sm text-gray-500">Loading funnel data...</div>;
  }

  if (error) {
    return <div className="p-5 text-sm text-red-600">Error: {error}</div>;
  }

  if (!funnelData) {
    return <div className="p-5 text-sm text-gray-500">No funnel data</div>;
  }

  const stages = [
    { key: 'signed_up', label: 'Signed Up', color: 'bg-blue-500' },
    { key: 'approved', label: 'Approved', color: 'bg-blue-500' },
    { key: 'first_login', label: 'First Login', color: 'bg-purple-500' },
    { key: 'active_7d', label: 'Active (7d)', color: 'bg-green-500' },
    { key: 'regular_30d', label: 'Regular (30d)', color: 'bg-teal-500' },
  ];

  const maxCount = funnelData.funnel.signed_up || 1;

  return (
    <div className="space-y-6">
      {/* Funnel Visualization */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4">User Conversion Funnel</h3>
        <div className="space-y-3">
          {stages.map((stage, idx) => {
            const count = funnelData.funnel[stage.key as keyof FunnelData];
            const width = (count / maxCount) * 100;
            let conversionRate = '—';
            let conversionColor = '';
            if (idx > 0) {
              const prevCount =
                funnelData.funnel[
                  stages[idx - 1].key as keyof FunnelData
                ];
              const rate = (count / prevCount) * 100;
              conversionRate = rate.toFixed(0) + '%';
              conversionColor = getConversionBadge(rate);
            }

            return (
              <div key={stage.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{stage.label}</span>
                  <span className="text-gray-500">{count} users</span>
                </div>
                <button
                  onClick={() => setSelectedStage(selectedStage === stage.key ? null : stage.key)}
                  className={`w-full h-8 ${stage.color} rounded transition-opacity opacity-80 hover:opacity-100 flex items-center px-3 text-white text-xs font-medium relative cursor-pointer`}
                  style={{ width: Math.max(width, 10) + '%' }}
                >
                  <span>{count}</span>
                  {conversionRate !== '—' && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${conversionColor}`}>
                      {conversionRate}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cohort Table */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4">Cohort Conversion Rates</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-3 py-2 text-gray-600 font-medium">Week</th>
                {stages.map((stage) => (
                  <th key={stage.key} className="text-center px-2 py-2 text-gray-600 font-medium">
                    {stage.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnelData.cohorts.map((cohort, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="text-left px-3 py-2 text-gray-700">
                    {new Date(cohort.week).toLocaleDateString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  {stages.map((stage) => {
                    const stageKey = stage.key as keyof CohortData;
                    const count = cohort[stageKey];
                    let rate = 0;
                    if (stageKey !== 'signed_up' && cohort.signed_up) {
                      rate = (count / cohort.signed_up) * 100;
                    }
                    return (
                      <td
                        key={stage.key}
                        className={`text-center px-2 py-2 font-medium ${
                          stageKey === 'signed_up'
                            ? 'text-gray-700'
                            : getConversionColor(rate)
                        }`}
                      >
                        {stageKey === 'signed_up' ? count : rate.toFixed(0) + '%'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stuck Users */}
      <div className="space-y-4">
        {/* Approved but never logged in */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            Approved but Never Logged In ({funnelData.stuck.approved_no_login.length})
          </h3>
          {funnelData.stuck.approved_no_login.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-3 py-2 text-gray-600 font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-gray-600 font-medium">Email</th>
                    <th className="text-center px-3 py-2 text-gray-600 font-medium">Days Since Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {funnelData.stuck.approved_no_login.map((user) => {
                    const daysAgo = user.approved_at
                      ? Math.floor(
                          (new Date().getTime() - new Date(user.approved_at).getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      : 0;
                    return (
                      <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="text-left px-3 py-2 text-gray-700 font-medium">{user.full_name}</td>
                        <td className="text-left px-3 py-2 text-gray-600">{user.email}</td>
                        <td className="text-center px-3 py-2 text-red-600 font-medium">{daysAgo}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-gray-500 text-center py-4">All approved users have logged in</div>
          )}
        </div>

        {/* Logged in but inactive */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-600" />
            Logged In but Inactive (7+ days) ({funnelData.stuck.logged_in_inactive.length})
          </h3>
          {funnelData.stuck.logged_in_inactive.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-3 py-2 text-gray-600 font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-gray-600 font-medium">Email</th>
                    <th className="text-center px-3 py-2 text-gray-600 font-medium">Last Active</th>
                    <th className="text-center px-3 py-2 text-gray-600 font-medium">Login Count</th>
                  </tr>
                </thead>
                <tbody>
                  {funnelData.stuck.logged_in_inactive.map((user) => (
                    <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="text-left px-3 py-2 text-gray-700 font-medium">{user.full_name}</td>
                      <td className="text-left px-3 py-2 text-gray-600">{user.email}</td>
                      <td className="text-center px-3 py-2 text-amber-600 font-medium">
                        {formatDaysAgo(user.last_active_at)}
                      </td>
                      <td className="text-center px-3 py-2 text-gray-600">{user.login_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-gray-500 text-center py-4">No inactive users</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Tab: Departments
function DepartmentsTab() {
  const [departments, setDepartments] = useState<DepartmentData[]>([]);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/admin/adoption/departments');
        if (!res.ok) throw new Error('Failed to fetch department data');
        const json = await res.json();
        if (json.success) {
          setDepartments(
            json.data.sort((a: DepartmentData, b: DepartmentData) => {
              const aRate = (a.logged_in_users / a.total_users) * 100;
              const bRate = (b.logged_in_users / b.total_users) * 100;
              return aRate - bRate;
            })
          );
        } else {
          setError('API returned success: false');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="p-5 text-sm text-gray-500">Loading department data...</div>;
  }

  if (error) {
    return <div className="p-5 text-sm text-red-600">Error: {error}</div>;
  }

  const usersNeverLoggedIn = departments.reduce((sum, dept) => sum + (dept.total_users - dept.logged_in_users), 0);
  const usersWithActivity = departments.reduce((sum, dept) => sum + dept.logged_in_users, 0);
  const activeDepts = departments.filter((d) => d.logged_in_users > 0).length;

  return (
    <div className="space-y-6">
      {/* Summary Bar */}
      <div className="bg-even-white rounded-xl border border-gray-100 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-600 mb-1">Departments with Active Users</div>
            <div className="text-lg font-bold text-even-navy">
              {activeDepts} of {departments.length}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-600 mb-1">Total Users Logged In</div>
            <div className="text-lg font-bold text-even-blue">{usersWithActivity}</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 mb-1">Never Logged In</div>
            <div className="text-lg font-bold text-red-600">{usersNeverLoggedIn}</div>
          </div>
        </div>
      </div>

      {/* Department Cards */}
      <div className="space-y-3">
        {departments.map((dept) => {
          const adoptionRate = (dept.logged_in_users / dept.total_users) * 100;
          const isExpanded = expandedDept === dept.department_id;

          return (
            <div key={dept.department_id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {/* Header */}
              <button
                onClick={() => setExpandedDept(isExpanded ? null : dept.department_id)}
                className="w-full px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                  <div
                    className={`w-2 h-2 rounded-full ${getStatusDot(adoptionRate)}`}
                  />
                  <div className="flex-1 text-left">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-even-navy">{dept.department_name}</span>
                      <span className="text-xs text-gray-600">
                        {dept.logged_in_users} of {dept.total_users} active
                      </span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${getConversionBadge(adoptionRate)}`}>
                        {adoptionRate.toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                      <span>{dept.forms_7d} forms</span>
                      <span className="text-gray-300">|</span>
                      <span>{dept.help_count_7d} help searches</span>
                    </div>
                  </div>
                  <Sparkline data={dept.sparkline_14d} height={24} width={80} />
                </div>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="border-t border-gray-100 p-5 bg-gray-50">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left px-3 py-2 text-gray-600 font-medium">Name</th>
                          <th className="text-left px-3 py-2 text-gray-600 font-medium">Email</th>
                          <th className="text-center px-3 py-2 text-gray-600 font-medium">First Login</th>
                          <th className="text-center px-3 py-2 text-gray-600 font-medium">Last Active</th>
                          <th className="text-center px-3 py-2 text-gray-600 font-medium">Logins</th>
                          <th className="text-center px-3 py-2 text-gray-600 font-medium">Session Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dept.users.map((user) => (
                          <tr
                            key={user.id}
                            className={`border-b border-gray-200 ${
                              !user.first_login_at ? 'bg-red-50' : user.last_active_at &&
                              (new Date().getTime() - new Date(user.last_active_at).getTime()) > (7 * 24 * 60 * 60 * 1000)
                                ? 'bg-amber-50'
                                : ''
                            }`}
                          >
                            <td className="text-left px-3 py-2 text-gray-700 font-medium">
                              {user.full_name}
                            </td>
                            <td className="text-left px-3 py-2 text-gray-600">{user.email}</td>
                            <td className="text-center px-3 py-2 text-gray-600">
                              {formatDate(user.first_login_at)}
                            </td>
                            <td className="text-center px-3 py-2 text-gray-600">
                              {formatDaysAgo(user.last_active_at)}
                            </td>
                            <td className="text-center px-3 py-2 text-gray-600">{user.login_count}</td>
                            <td className="text-center px-3 py-2 text-gray-600">
                              {formatMinutes(user.total_session_seconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Tab: Friction
function FrictionTab() {
  const [friction, setFriction] = useState<FrictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/admin/adoption/friction');
        if (!res.ok) throw new Error('Failed to fetch friction data');
        const json = await res.json();
        if (json.success) {
          setFriction(json.data);
        } else {
          setError('API returned success: false');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="p-5 text-sm text-gray-500">Loading friction data...</div>;
  }

  if (error) {
    return <div className="p-5 text-sm text-red-600">Error: {error}</div>;
  }

  if (!friction) {
    return <div className="p-5 text-sm text-gray-500">No friction data</div>;
  }

  const maxCompletionRate = Math.max(...friction.form_dropoffs.map((f) => f.completion_rate), 100);
  const maxErrors = Math.max(...friction.error_hotspots.map((e) => e.error_count), 1);
  const maxDuration = Math.max(...friction.duration_distribution.map((d) => d.count), 1);
  const maxFeatureUsers = Math.max(...friction.feature_usage.map((f) => f.unique_users), 1);

  return (
    <div className="space-y-6">
      {/* Form Drop-off Analysis */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4">Form Drop-off Analysis</h3>
        {friction.form_dropoffs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Form Type</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Total</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Completed</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Abandoned</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Completion Rate</th>
                </tr>
              </thead>
              <tbody>
                {friction.form_dropoffs.map((form, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="text-left px-3 py-2 text-gray-700 font-medium">
                      {form.form_type.replace(/_/g, ' ')}
                    </td>
                    <td className="text-center px-3 py-2 text-gray-600">{form.total}</td>
                    <td className="text-center px-3 py-2 text-green-600 font-medium">{form.completed}</td>
                    <td className="text-center px-3 py-2 text-red-600 font-medium">{form.abandoned}</td>
                    <td className="text-center px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                          <div
                            className={`h-full ${getConversionColor((form.completion_rate / maxCompletionRate) * 100)}`}
                            style={{ width: (form.completion_rate / maxCompletionRate) * 100 + '%' }}
                          />
                        </div>
                        <span className="font-medium text-gray-700 w-10 text-right">
                          {form.completion_rate.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-4">No form drop-off data</div>
        )}
      </div>

      {/* Bounce Sessions */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-red-600" />
          Bounce Sessions (&lt; 60s) ({friction.bounce_sessions.length})
        </h3>
        {friction.bounce_sessions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Name</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Department</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">First Login</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Session Duration</th>
                </tr>
              </thead>
              <tbody>
                {friction.bounce_sessions.map((session) => (
                  <tr key={session.id} className="border-b border-gray-100 hover:bg-gray-50 bg-red-50">
                    <td className="text-left px-3 py-2 text-gray-700 font-medium">{session.full_name}</td>
                    <td className="text-left px-3 py-2 text-gray-600">{session.department_name}</td>
                    <td className="text-center px-3 py-2 text-gray-600">
                      {formatDate(session.first_login_at)}
                    </td>
                    <td className="text-center px-3 py-2 text-red-600 font-medium">
                      {session.total_session_seconds}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-4">No bounce sessions</div>
        )}
      </div>

      {/* Help Gaps */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-amber-600" />
          Unanswered Help Searches ({friction.help_gaps.length})
        </h3>
        {friction.help_gaps.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Search Query</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Search Count</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Unique Users</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Last Searched</th>
                </tr>
              </thead>
              <tbody>
                {friction.help_gaps.map((gap, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="text-left px-3 py-2 text-gray-700">{gap.question}</td>
                    <td className="text-center px-3 py-2 font-medium text-gray-700">{gap.search_count}</td>
                    <td className="text-center px-3 py-2 text-gray-600">{gap.unique_users}</td>
                    <td className="text-center px-3 py-2 text-gray-600">
                      {formatDaysAgo(gap.last_searched)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-4">No unanswered searches</div>
        )}
      </div>

      {/* Error Hotspots */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          Error Hotspots ({friction.error_hotspots.length})
        </h3>
        {friction.error_hotspots.length > 0 ? (
          <div className="space-y-4">
            {friction.error_hotspots.map((error, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-900">{error.location}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {error.error_count} errors · {error.affected_users} affected users
                    </div>
                  </div>
                  <div
                    className="flex-1 ml-4 h-1.5 bg-gray-200 rounded overflow-hidden"
                    style={{ minWidth: '100px' }}
                  >
                    <div
                      className="h-full bg-red-500"
                      style={{ width: (error.error_count / maxErrors) * 100 + '%' }}
                    />
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  <div className="font-medium text-gray-700 mb-1">Sample messages:</div>
                  {error.sample_messages.slice(0, 2).map((msg, msgIdx) => (
                    <div key={msgIdx} className="text-gray-600">
                      • {msg}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-4">No error hotspots</div>
        )}
      </div>

      {/* Session Duration Distribution */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-600" />
          Session Duration Distribution
        </h3>
        {friction.duration_distribution.length > 0 ? (
          <div className="space-y-2">
            {friction.duration_distribution.map((bucket, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-24 text-xs text-gray-600 font-medium">{bucket.bucket}</div>
                <div className="flex-1 h-6 bg-gray-100 rounded flex items-center">
                  <div
                    className="h-full bg-blue-500 rounded transition-all"
                    style={{ width: (bucket.count / maxDuration) * 100 + '%' }}
                  />
                </div>
                <div className="w-12 text-right text-xs font-medium text-gray-700">{bucket.count}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-4">No session data</div>
        )}
      </div>

      {/* Feature Usage */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-even-navy mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-600" />
          Least Used Features
        </h3>
        {friction.feature_usage.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Page/Feature</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Unique Users</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium">Total Views</th>
                </tr>
              </thead>
              <tbody>
                {friction.feature_usage
                  .sort((a, b) => a.unique_users - b.unique_users)
                  .map((feature, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="text-left px-3 py-2 text-gray-700">{feature.page}</td>
                      <td className="text-center px-3 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-1.5 bg-gray-200 rounded w-12">
                            <div
                              className="h-full bg-amber-500 rounded"
                              style={{ width: (feature.unique_users / maxFeatureUsers) * 100 + '%' }}
                            />
                          </div>
                          <span className="font-medium text-gray-700 w-6">{feature.unique_users}</span>
                        </div>
                      </td>
                      <td className="text-center px-3 py-2 text-gray-600">{feature.total_views}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-4">No feature usage data</div>
        )}
      </div>
    </div>
  );
}

// Main Page Component
export default function AdoptionPage() {
  const [userRole, setUserRole] = useState<string | null>(null);
  const [badges, setBadges] = useState<any[]>([]);
  const [healthBarData, setHealthBarData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'funnel' | 'departments' | 'friction'>('funnel');
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        // Fetch user role
        const profileRes = await fetch('/api/profiles/me');
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setUserRole(profileData.data?.role || 'staff');
        }

        // Fetch health bar data
        const healthRes = await fetch('/api/admin/health');
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          if (healthData.success) {
            setHealthBarData(healthData.data);
          }
        }

        // Fetch badges
        const badgesRes = await fetch('/api/admin/dashboard-stats');
        if (badgesRes.ok) {
          const badgesData = await badgesRes.json();
          if (badgesData.success && badgesData.data?.badges) {
            setBadges(badgesData.data.badges);
          }
        }
      } catch (err) {
        console.error('Error fetching metadata:', err);
      } finally {
        setDataLoading(false);
      }
    };

    fetchMetadata();
  }, []);

  if (dataLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading...</div>;
  }

  return (
    <AdminShell activeSection="adoption" userRole={userRole || 'staff'} badges={badges} health={healthBarData}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Adoption Deep Dive</h1>
            <p className="text-sm text-gray-600 mt-1">Analyze user engagement, department adoption, and adoption friction</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-gray-100 p-1 flex gap-1">
          <button
            onClick={() => setActiveTab('funnel')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'funnel'
                ? 'bg-even-blue text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4" />
              Funnel
            </span>
          </button>
          <button
            onClick={() => setActiveTab('departments')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'departments'
                ? 'bg-even-blue text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Departments
            </span>
          </button>
          <button
            onClick={() => setActiveTab('friction')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'friction'
                ? 'bg-even-blue text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Friction
            </span>
          </button>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'funnel' && <FunnelTab />}
          {activeTab === 'departments' && <DepartmentsTab />}
          {activeTab === 'friction' && <FrictionTab />}
        </div>
      </div>
    </AdminShell>
  );
}
