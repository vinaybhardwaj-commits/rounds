// ============================================
// GET /api/admin/adoption/friction
// Friction analysis: form drop-offs, bounces, help gaps, error hotspots
// Protected: admin/super_admin only
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // ── 1. Form Abandonment Analysis ──
    let formDropoffs: any[] = [];
    try {
      // Get form completion rates by type
      formDropoffs = await sql(`
        SELECT
          form_type,
          COUNT(*)::int as total,
          SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::int as completed,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END)::int as abandoned,
          ROUND(
            SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::numeric /
            NULLIF(COUNT(*), 0) * 100, 1
          ) as completion_rate
        FROM form_submissions
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY form_type
        ORDER BY completion_rate ASC NULLS LAST
      `);
    } catch { /* skip */ }

    // ── 2. Bounce Sessions (first session < 60s, never returned) ──
    let bounceSessions: any[] = [];
    try {
      bounceSessions = await sql(`
        SELECT
          p.id, p.full_name, p.email,
          d.name as department_name,
          p.first_login_at,
          p.total_session_seconds,
          p.login_count
        FROM profiles p
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.login_count = 1
          AND p.total_session_seconds < 60
          AND p.first_login_at IS NOT NULL
        ORDER BY p.first_login_at DESC
        LIMIT 20
      `);
    } catch { /* skip */ }

    // ── 3. Help System Gaps (searches with no results) ──
    let helpGaps: any[] = [];
    try {
      helpGaps = await sql(`
        SELECT
          question,
          COUNT(*)::int as search_count,
          COUNT(DISTINCT profile_id)::int as unique_users,
          MAX(created_at) as last_searched
        FROM help_interactions
        WHERE response_source = 'no-match'
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY question
        ORDER BY search_count DESC
        LIMIT 15
      `);
    } catch { /* skip */ }

    // ── 4. Error Hotspots (pages/features with highest error rates) ──
    let errorHotspots: any[] = [];
    try {
      errorHotspots = await sql(`
        SELECT
          COALESCE(component, url, 'Unknown') as location,
          COUNT(*)::int as error_count,
          COUNT(DISTINCT profile_id)::int as affected_users,
          MAX(created_at) as last_seen,
          ARRAY_AGG(DISTINCT SUBSTRING(message FROM 1 FOR 80)) as sample_messages
        FROM app_errors
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY COALESCE(component, url, 'Unknown')
        ORDER BY error_count DESC
        LIMIT 10
      `);
    } catch { /* skip */ }

    // ── 5. Feature Discovery Gaps ──
    // Pages visited at least once vs available pages
    let featureUsage: any[] = [];
    try {
      featureUsage = await sql(`
        SELECT
          page,
          COUNT(DISTINCT profile_id)::int as unique_users,
          COUNT(*)::int as total_views,
          MAX(created_at) as last_accessed
        FROM session_events
        WHERE event_type = 'page_view'
          AND page IS NOT NULL
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY page
        ORDER BY unique_users ASC
      `);
    } catch { /* skip */ }

    // ── 6. Session Duration Distribution ──
    let durationDist: any[] = [];
    try {
      durationDist = await sql(`
        SELECT
          CASE
            WHEN duration < 30 THEN '< 30s'
            WHEN duration < 60 THEN '30s-1m'
            WHEN duration < 300 THEN '1-5m'
            WHEN duration < 600 THEN '5-10m'
            WHEN duration < 1800 THEN '10-30m'
            ELSE '30m+'
          END as bucket,
          COUNT(*)::int as count
        FROM (
          SELECT
            session_id,
            EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))::int as duration
          FROM session_events
          WHERE created_at > NOW() - INTERVAL '30 days'
          GROUP BY session_id
        ) sessions
        GROUP BY bucket
        ORDER BY
          CASE bucket
            WHEN '< 30s' THEN 1
            WHEN '30s-1m' THEN 2
            WHEN '1-5m' THEN 3
            WHEN '5-10m' THEN 4
            WHEN '10-30m' THEN 5
            ELSE 6
          END
      `);
    } catch { /* skip */ }

    return NextResponse.json({
      success: true,
      data: {
        form_dropoffs: formDropoffs.map((f: any) => ({
          form_type: f.form_type,
          total: f.total,
          completed: f.completed,
          abandoned: f.abandoned,
          completion_rate: parseFloat(f.completion_rate) || 0,
        })),
        bounce_sessions: bounceSessions.map((b: any) => ({
          id: b.id,
          full_name: b.full_name,
          email: b.email,
          department_name: b.department_name,
          first_login_at: b.first_login_at,
          total_session_seconds: b.total_session_seconds,
          login_count: b.login_count,
        })),
        help_gaps: helpGaps.map((h: any) => ({
          question: h.question,
          search_count: h.search_count,
          unique_users: h.unique_users,
          last_searched: h.last_searched,
        })),
        error_hotspots: errorHotspots.map((e: any) => ({
          location: e.location,
          error_count: e.error_count,
          affected_users: e.affected_users,
          last_seen: e.last_seen,
          sample_messages: e.sample_messages?.slice(0, 3) || [],
        })),
        feature_usage: featureUsage.map((f: any) => ({
          page: f.page,
          unique_users: f.unique_users,
          total_views: f.total_views,
          last_accessed: f.last_accessed,
        })),
        duration_distribution: durationDist.map((d: any) => ({
          bucket: d.bucket,
          count: d.count,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/adoption/friction error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch friction data' },
      { status: 500 }
    );
  }
}
