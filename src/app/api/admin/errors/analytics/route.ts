// ============================================
// GET /api/admin/errors/analytics
// Error Forensics API — comprehensive error analysis dashboard
// Protected: super_admin only
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // ── 1. Overall overview (all time) ──
    let overview: any = {};
    try {
      const result = await sql(`
        SELECT
          COUNT(*)::int as total_errors,
          SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END)::int as errors_24h,
          SUM(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as errors_7d,
          COUNT(DISTINCT message)::int as unique_messages,
          COUNT(DISTINCT profile_id)::int as affected_users,
          (SELECT severity FROM app_errors ORDER BY created_at DESC LIMIT 1) as top_severity
        FROM app_errors
      `);
      overview = result[0] || {};
    } catch { /* skip */ }

    // ── 2. Errors by severity ──
    let bySeverity: any[] = [];
    try {
      bySeverity = await sql(`
        SELECT
          severity,
          COUNT(*)::int as count
        FROM app_errors
        GROUP BY severity
        ORDER BY count DESC
      `);
    } catch { /* skip */ }

    // ── 3. Errors by component ──
    let byComponent: any[] = [];
    try {
      byComponent = await sql(`
        SELECT
          component,
          COUNT(*)::int as count,
          MAX(created_at) as latest_at
        FROM app_errors
        WHERE component IS NOT NULL AND component != ''
        GROUP BY component
        ORDER BY count DESC
      `);
    } catch { /* skip */ }

    // ── 4. Errors by URL ──
    let byUrl: any[] = [];
    try {
      byUrl = await sql(`
        SELECT
          url,
          COUNT(*)::int as count
        FROM app_errors
        WHERE url IS NOT NULL AND url != ''
        GROUP BY url
        ORDER BY count DESC
      `);
    } catch { /* skip */ }

    // ── 5. Daily trend (last 30 days) ──
    let dailyTrend: any[] = [];
    try {
      dailyTrend = await sql(`
        SELECT
          DATE(created_at) as date,
          COUNT(*)::int as count
        FROM app_errors
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);
    } catch { /* skip */ }

    // ── 6. Error clusters (top 20 by message) ──
    let errorClusters: any[] = [];
    try {
      errorClusters = await sql(`
        SELECT
          SUBSTRING(message, 1, 200) as message,
          component,
          url,
          severity,
          COUNT(*)::int as count,
          MIN(created_at) as first_seen,
          MAX(created_at) as last_seen,
          COUNT(DISTINCT profile_id)::int as affected_users
        FROM app_errors
        GROUP BY SUBSTRING(message, 1, 200), component, url, severity
        ORDER BY count DESC
        LIMIT 20
      `);
    } catch { /* skip */ }

    // ── 7. Recent errors (last 20) ──
    let recentErrors: any[] = [];
    try {
      recentErrors = await sql(`
        SELECT
          ae.id,
          ae.message,
          ae.component,
          ae.url,
          ae.severity,
          p.full_name as profile_name,
          ae.user_role,
          ae.created_at
        FROM app_errors ae
        LEFT JOIN profiles p ON ae.profile_id = p.id
        ORDER BY ae.created_at DESC
        LIMIT 20
      `);
    } catch { /* skip */ }

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          total_errors: overview.total_errors || 0,
          errors_24h: overview.errors_24h || 0,
          errors_7d: overview.errors_7d || 0,
          unique_messages: overview.unique_messages || 0,
          affected_users: overview.affected_users || 0,
          top_severity: overview.top_severity || 'unknown',
        },
        by_severity: bySeverity.map((s: any) => ({
          severity: s.severity,
          count: s.count,
        })),
        by_component: byComponent.map((c: any) => ({
          component: c.component,
          count: c.count,
          latest_at: c.latest_at,
        })),
        by_url: byUrl.map((u: any) => ({
          url: u.url,
          count: u.count,
        })),
        daily_trend: dailyTrend.map((d: any) => ({
          date: typeof d.date === 'string' ? d.date.split('T')[0] : new Date(d.date).toISOString().split('T')[0],
          count: d.count,
        })),
        error_clusters: errorClusters.map((e: any) => ({
          message: e.message,
          component: e.component,
          url: e.url,
          severity: e.severity,
          count: e.count,
          first_seen: e.first_seen,
          last_seen: e.last_seen,
          affected_users: e.affected_users,
        })),
        recent_errors: recentErrors.map((e: any) => ({
          id: e.id,
          message: e.message,
          component: e.component,
          url: e.url,
          severity: e.severity,
          profile_name: e.profile_name,
          user_role: e.user_role,
          created_at: e.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/errors/analytics error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch error analytics' },
      { status: 500 }
    );
  }
}
