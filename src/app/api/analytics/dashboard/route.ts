// ============================================
// GET /api/analytics/dashboard — Admin analytics
// Returns DAU, feature adoption, page views,
// session data. super_admin only.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7') || 7, 1), 30);

    // Use parameterized query with interval arithmetic instead of string interpolation
    // NOW() - make_interval(days => $1) is safe from SQL injection

    // 1. Daily active users (last N days)
    const dau = await sql(
      `SELECT DATE(created_at) as date, COUNT(DISTINCT profile_id)::int as users
      FROM session_events
      WHERE event_type = 'session_start'
        AND created_at > NOW() - make_interval(days => $1)
      GROUP BY DATE(created_at)
      ORDER BY date DESC`,
      [days]
    );

    // 2. Feature adoption (top features in last N days)
    const features = await sql(
      `SELECT feature, COUNT(*)::int as uses, COUNT(DISTINCT profile_id)::int as users
      FROM session_events
      WHERE event_type = 'feature_use'
        AND feature IS NOT NULL
        AND created_at > NOW() - make_interval(days => $1)
      GROUP BY feature
      ORDER BY uses DESC
      LIMIT 30`,
      [days]
    );

    // 3. Page views (top pages in last N days)
    const pages = await sql(
      `SELECT page, COUNT(*)::int as views, COUNT(DISTINCT profile_id)::int as users
      FROM session_events
      WHERE event_type = 'page_view'
        AND page IS NOT NULL
        AND created_at > NOW() - make_interval(days => $1)
      GROUP BY page
      ORDER BY views DESC
      LIMIT 30`,
      [days]
    );

    // 4. Session stats
    const sessions = await sql(
      `SELECT
        COUNT(DISTINCT session_id)::int as total_sessions,
        COUNT(DISTINCT profile_id)::int as unique_users,
        ROUND(AVG(
          CASE WHEN event_type = 'session_end' AND (detail->>'duration_seconds')::int > 0
               THEN (detail->>'duration_seconds')::int END
        ))::int as avg_session_seconds
      FROM session_events
      WHERE created_at > NOW() - make_interval(days => $1)`,
      [days]
    );

    // 5. User engagement ranking (most active users)
    const userRanking = await sql(
      `SELECT se.profile_id, p.full_name, p.role, p.email,
             COUNT(*)::int as events,
             COUNT(DISTINCT se.session_id)::int as sessions,
             COUNT(DISTINCT DATE(se.created_at))::int as active_days
      FROM session_events se
      JOIN profiles p ON p.id = se.profile_id
      WHERE se.created_at > NOW() - make_interval(days => $1)
      GROUP BY se.profile_id, p.full_name, p.role, p.email
      ORDER BY events DESC
      LIMIT 20`,
      [days]
    );

    // 6. Error summary (last N days)
    const errors = await sql(
      `SELECT severity, COUNT(*)::int as count,
             COUNT(DISTINCT message)::int as unique_errors
      FROM app_errors
      WHERE created_at > NOW() - make_interval(days => $1)
      GROUP BY severity
      ORDER BY count DESC`,
      [days]
    );

    return NextResponse.json({
      success: true,
      data: {
        period_days: days,
        dau,
        features,
        pages,
        sessions: sessions[0] || { total_sessions: 0, unique_users: 0, avg_session_seconds: 0 },
        userRanking,
        errors,
      },
    });
  } catch (error) {
    console.error('GET /api/analytics/dashboard error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
