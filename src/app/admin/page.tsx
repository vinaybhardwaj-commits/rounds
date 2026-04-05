'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { LifecycleFunnel } from '@/components/admin/LifecycleFunnel';
import { DepartmentHeatmap } from '@/components/admin/DepartmentHeatmap';
import { AdoptionSignalsFeed } from '@/components/admin/AdoptionSignalsFeed';
import { LiveActivityStream } from '@/components/admin/LiveActivityStream';
import { ErrorSummaryCompact } from '@/components/admin/ErrorSummaryCompact';
import { LLMQuickStatus } from '@/components/admin/LLMQuickStatus';
import { QuickActionsGrid } from '@/components/admin/QuickActionsGrid';

interface DashboardData {
  funnel: {
    signed_up: number;
    approved: number;
    first_login: number;
    active_7d: number;
    regular_30d: number;
  };
  departments: Array<{
    name: string;
    total_users: number;
    active_users: number;
    forms_submitted_7d: number;
    sparkline_14d: number[];
  }>;
  signals: Array<{
    type: string;
    severity: string;
    message: string;
    action: string;
    meta?: Record<string, unknown>;
  }>;
  errors_summary: Array<{
    message: string;
    count: number;
    affected_users: number;
    is_new: boolean;
    last_seen: string;
  }>;
  llm_recent: Array<{
    id: string;
    created_at: string;
    analysis_type: string;
    latency_ms: number;
    tokens_prompt: number;
    tokens_completion: number;
    status: string;
  }>;
  health: {
    active_sessions: number;
    forms_today: number;
    forms_yesterday: number;
    error_count_1h: number;
    error_sparkline_6h: number[];
  };
}

interface HealthData {
  llm: { status: 'healthy' | 'degraded' | 'down'; latency_ms: number };
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, admissions: 0, escalations: 0 });

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard-stats');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        }
      }
    } catch {}
    setLoading(false);
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/health');
      if (res.ok) {
        const json = await res.json();
        setHealthData({ llm: { status: json.status || 'down', latency_ms: json.latency_ms || 0 } });
      }
    } catch {
      setHealthData({ llm: { status: 'down', latency_ms: 0 } });
    }
  }, []);

  const fetchBadges = useCallback(async () => {
    try {
      const [approvals, escalations, admissions] = await Promise.all([
        fetch('/api/admin/approvals').then(r => r.json()).catch(() => ({ data: [] })),
        fetch('/api/escalation/log?resolved=false').then(r => r.json()).catch(() => ({ data: [] })),
        fetch('/api/admission-tracker').then(r => r.json()).catch(() => ({ data: [] })),
      ]);
      setBadges({
        approvals: approvals.data?.length || 0,
        escalations: escalations.data?.length || 0,
        admissions: admissions.data?.length || 0,
      });
    } catch {}
  }, []);

  // Detect user role from profiles/me or cookie
  useEffect(() => {
    fetch('/api/profiles/me')
      .then(r => r.json())
      .then(d => { if (d.success && d.data?.role) setUserRole(d.data.role); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchHealth();
    fetchBadges();

    // Refresh dashboard stats every 30 seconds
    const dashInterval = setInterval(fetchDashboard, 30000);
    // Refresh health every 30 seconds
    const healthInterval = setInterval(fetchHealth, 30000);

    return () => {
      clearInterval(dashInterval);
      clearInterval(healthInterval);
    };
  }, [fetchDashboard, fetchHealth, fetchBadges]);

  // Build health bar data
  const healthBarData = {
    llm: healthData?.llm || { status: 'down' as const, latency_ms: 0 },
    errors_1h: data?.health?.error_count_1h || 0,
    error_sparkline: data?.health?.error_sparkline_6h || [],
    active_sessions: data?.health?.active_sessions || 0,
    api_p95_ms: 0, // TODO: implement API latency tracking
    api_trend: 'stable' as const,
    forms_today: data?.health?.forms_today || 0,
    forms_yesterday: data?.health?.forms_yesterday || 0,
    last_deploy: { time: '', sha: '' }, // TODO: wire up Vercel API
  };

  // Transform LLM data for the quick status component
  const llmCalls = (data?.llm_recent || []).map(call => ({
    id: call.id,
    time: call.created_at,
    analysis_type: call.analysis_type,
    latency_ms: call.latency_ms,
    tokens: (call.tokens_prompt || 0) + (call.tokens_completion || 0),
    status: call.status,
  }));

  return (
    <AdminShell
      activeSection="dashboard"
      userRole={userRole}
      badges={badges}
      health={healthBarData}
    >
      {/* Two-column layout: 58% / 42% */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* LEFT COLUMN: Adoption Intelligence (58%) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Section A: Lifecycle Funnel */}
          <LifecycleFunnel data={data?.funnel} loading={loading} />

          {/* Section B: Department Heatmap */}
          <DepartmentHeatmap departments={data?.departments} loading={loading} />

          {/* Section C: Adoption Signals */}
          <AdoptionSignalsFeed signals={data?.signals as any} loading={loading} />
        </div>

        {/* RIGHT COLUMN: System & Activity Intelligence (42%) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Section D: Live Activity Stream */}
          <LiveActivityStream />

          {/* Section E: Error Summary */}
          <ErrorSummaryCompact errors={data?.errors_summary} loading={loading} />

          {/* Section F: LLM Quick Status */}
          <LLMQuickStatus calls={llmCalls} loading={loading} />
        </div>
      </div>

      {/* Below the fold: Quick Actions Grid */}
      <div className="mt-6">
        <QuickActionsGrid badges={badges} userRole={userRole} />
      </div>
    </AdminShell>
  );
}
