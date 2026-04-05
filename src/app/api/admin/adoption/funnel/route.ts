// ============================================
// GET /api/admin/adoption/funnel
// Lifecycle funnel with cohort analysis
// Protected: admin/super_admin only
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'all'; // 7d, 14d, 30d, all

    // Build period filter — only allow known safe values
    let periodFilter = '';
    const periodDays: Record<string, number> = { '7d': 7, '14d': 14, '30d': 30 };
    if (period !== 'all' && periodDays[period]) {
      periodFilter = `AND created_at > NOW() - INTERVAL '${periodDays[period]} days'`;
    }

    // ── 1. Overall funnel counts ──
    const funnelResult = await sql(`
      SELECT
        COUNT(*)::int as signed_up,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int as approved,
        SUM(CASE WHEN first_login_at IS NOT NULL THEN 1 ELSE 0 END)::int as first_login,
        SUM(CASE WHEN last_active_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as active_7d,
        SUM(CASE WHEN login_count >= 5 AND last_active_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int as regular_30d
      FROM profiles
      WHERE 1=1 ${periodFilter}
    `);

    const funnel = funnelResult[0] || {
      signed_up: 0, approved: 0, first_login: 0, active_7d: 0, regular_30d: 0,
    };

    // ── 2. Cohort analysis (by signup week) ──
    const cohorts = await sql(`
      SELECT
        DATE_TRUNC('week', created_at)::date as cohort_week,
        COUNT(*)::int as signed_up,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int as approved,
        SUM(CASE WHEN first_login_at IS NOT NULL THEN 1 ELSE 0 END)::int as first_login,
        SUM(CASE WHEN last_active_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as active_7d,
        SUM(CASE WHEN login_count >= 5 AND last_active_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int as regular_30d
      FROM profiles
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY cohort_week DESC
      LIMIT 12
    `);

    // ── 3. Stuck users (at each stage for 7+ days without progressing) ──
    const stuckApproved = await sql(`
      SELECT id, full_name, email, created_at, approved_at
      FROM profiles
      WHERE status = 'active'
        AND first_login_at IS NULL
        AND approved_at < NOW() - INTERVAL '7 days'
      ORDER BY approved_at ASC
      LIMIT 20
    `);

    const stuckFirstLogin = await sql(`
      SELECT id, full_name, email, first_login_at, last_active_at, login_count
      FROM profiles
      WHERE first_login_at IS NOT NULL
        AND (last_active_at IS NULL OR last_active_at < NOW() - INTERVAL '7 days')
        AND login_count < 5
      ORDER BY first_login_at ASC
      LIMIT 20
    `);

    // ── 4. Stage user lists (for drill-down) ──
    const stageParam = searchParams.get('stage');
    let stageUsers: any[] = [];

    if (stageParam) {
      let stageQuery = '';
      switch (stageParam) {
        case 'signed_up':
          stageQuery = `SELECT id, full_name, email, d.name as department_name, created_at, status
            FROM profiles p LEFT JOIN departments d ON p.department_id = d.id
            ORDER BY created_at DESC LIMIT 50`;
          break;
        case 'approved':
          stageQuery = `SELECT p.id, full_name, email, d.name as department_name, approved_at, first_login_at
            FROM profiles p LEFT JOIN departments d ON p.department_id = d.id
            WHERE status = 'active'
            ORDER BY approved_at DESC LIMIT 50`;
          break;
        case 'first_login':
          stageQuery = `SELECT p.id, full_name, email, d.name as department_name, first_login_at, login_count, last_active_at
            FROM profiles p LEFT JOIN departments d ON p.department_id = d.id
            WHERE first_login_at IS NOT NULL
            ORDER BY first_login_at DESC LIMIT 50`;
          break;
        case 'active_7d':
          stageQuery = `SELECT p.id, full_name, email, d.name as department_name, last_active_at, login_count, total_session_seconds
            FROM profiles p LEFT JOIN departments d ON p.department_id = d.id
            WHERE last_active_at > NOW() - INTERVAL '7 days'
            ORDER BY last_active_at DESC LIMIT 50`;
          break;
        case 'regular_30d':
          stageQuery = `SELECT p.id, full_name, email, d.name as department_name, last_active_at, login_count, total_session_seconds
            FROM profiles p LEFT JOIN departments d ON p.department_id = d.id
            WHERE login_count >= 5 AND last_active_at > NOW() - INTERVAL '30 days'
            ORDER BY login_count DESC LIMIT 50`;
          break;
      }
      if (stageQuery) {
        stageUsers = await sql(stageQuery);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        funnel,
        cohorts: cohorts.map((c: any) => ({
          week: c.cohort_week,
          signed_up: c.signed_up,
          approved: c.approved,
          first_login: c.first_login,
          active_7d: c.active_7d,
          regular_30d: c.regular_30d,
        })),
        stuck: {
          approved_no_login: stuckApproved.map((u: any) => ({
            id: u.id, full_name: u.full_name, email: u.email,
            created_at: u.created_at, approved_at: u.approved_at,
          })),
          logged_in_inactive: stuckFirstLogin.map((u: any) => ({
            id: u.id, full_name: u.full_name, email: u.email,
            first_login_at: u.first_login_at, last_active_at: u.last_active_at,
            login_count: u.login_count,
          })),
        },
        stage_users: stageUsers,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/adoption/funnel error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch funnel data' },
      { status: 500 }
    );
  }
}
