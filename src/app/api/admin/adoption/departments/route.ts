// ============================================
// GET /api/admin/adoption/departments
// Department-level adoption metrics with user breakdown
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

    // ── 1. Department summary metrics ──
    const departments = await sql(`
      SELECT
        d.id as department_id,
        d.name as department_name,
        d.slug,
        COUNT(p.id)::int as total_users,
        SUM(CASE WHEN p.first_login_at IS NOT NULL THEN 1 ELSE 0 END)::int as logged_in_users,
        SUM(CASE WHEN p.last_active_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as active_7d,
        SUM(CASE WHEN p.login_count >= 5 AND p.last_active_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int as regular_users,
        COALESCE(AVG(p.total_session_seconds) FILTER (WHERE p.total_session_seconds > 0), 0)::int as avg_session_seconds,
        MAX(p.last_active_at) as last_activity
      FROM departments d
      LEFT JOIN profiles p ON p.department_id = d.id AND p.status = 'active'
      WHERE d.is_active = true
      GROUP BY d.id, d.name, d.slug
      ORDER BY d.name
    `);

    // ── 2. Forms submitted per department (7d) ──
    let deptForms: any[] = [];
    try {
      deptForms = await sql(`
        SELECT d.slug, COUNT(fs.id)::int as forms_7d
        FROM departments d
        JOIN profiles p ON p.department_id = d.id
        JOIN form_submissions fs ON fs.submitted_by = p.id AND fs.created_at > NOW() - INTERVAL '7 days'
        WHERE d.is_active = true
        GROUP BY d.slug
      `);
    } catch {
      try {
        deptForms = await sql(`
          SELECT d.slug, COUNT(fs.id)::int as forms_7d
          FROM departments d
          JOIN form_submissions fs ON fs.department_id = d.id AND fs.created_at > NOW() - INTERVAL '7 days'
          WHERE d.is_active = true
          GROUP BY d.slug
        `);
      } catch { /* skip */ }
    }
    const formsMap = new Map(deptForms.map((r: any) => [r.slug, r.forms_7d]));

    // ── 3. Help interactions per department (7d) ──
    let deptHelp: any[] = [];
    try {
      deptHelp = await sql(`
        SELECT d.slug, COUNT(hi.id)::int as help_count
        FROM departments d
        JOIN profiles p ON p.department_id = d.id
        JOIN help_interactions hi ON hi.profile_id = p.id AND hi.created_at > NOW() - INTERVAL '7 days'
        WHERE d.is_active = true
        GROUP BY d.slug
      `);
    } catch { /* skip */ }
    const helpMap = new Map(deptHelp.map((r: any) => [r.slug, r.help_count]));

    // ── 4. 14-day activity sparkline per dept ──
    const sparkData = await sql(`
      SELECT d.slug, DATE(se.created_at) as date, COUNT(DISTINCT se.session_id)::int as sessions
      FROM departments d
      JOIN profiles p ON p.department_id = d.id
      JOIN session_events se ON se.profile_id = p.id AND se.created_at > NOW() - INTERVAL '14 days'
      WHERE d.is_active = true
      GROUP BY d.slug, DATE(se.created_at)
      ORDER BY d.slug, date
    `);

    const sparkMap = new Map<string, Map<string, number>>();
    for (const row of sparkData) {
      if (!sparkMap.has(row.slug)) sparkMap.set(row.slug, new Map());
      const dateStr = typeof row.date === 'string' ? row.date.split('T')[0] : new Date(row.date).toISOString().split('T')[0];
      sparkMap.get(row.slug)!.set(dateStr, row.sessions);
    }

    const today = new Date();

    // ── 5. User-level breakdown per department ──
    const userBreakdown = await sql(`
      SELECT
        p.id, p.full_name, p.email, p.role,
        d.slug as department_slug,
        p.status, p.first_login_at, p.last_active_at,
        p.login_count, p.total_session_seconds
      FROM profiles p
      JOIN departments d ON p.department_id = d.id
      WHERE d.is_active = true AND p.status = 'active'
      ORDER BY d.slug, p.last_active_at DESC NULLS LAST
    `);

    // Group users by department
    const usersByDept = new Map<string, any[]>();
    for (const u of userBreakdown) {
      const slug = u.department_slug;
      if (!usersByDept.has(slug)) usersByDept.set(slug, []);
      usersByDept.get(slug)!.push({
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        role: u.role,
        first_login_at: u.first_login_at,
        last_active_at: u.last_active_at,
        login_count: u.login_count || 0,
        total_session_seconds: u.total_session_seconds || 0,
      });
    }

    // Assemble department data
    const result = departments.map((dept: any) => {
      const deptSparkMap = sparkMap.get(dept.slug) || new Map();
      const sparkline: number[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        sparkline.push(deptSparkMap.get(d.toISOString().split('T')[0]) || 0);
      }

      return {
        department_id: dept.department_id,
        department_name: dept.department_name,
        slug: dept.slug,
        total_users: dept.total_users,
        logged_in_users: dept.logged_in_users,
        active_7d: dept.active_7d,
        regular_users: dept.regular_users,
        avg_session_seconds: dept.avg_session_seconds,
        last_activity: dept.last_activity,
        forms_7d: formsMap.get(dept.slug) || 0,
        help_count_7d: helpMap.get(dept.slug) || 0,
        sparkline_14d: sparkline,
        users: usersByDept.get(dept.slug) || [],
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/admin/adoption/departments error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch department data' },
      { status: 500 }
    );
  }
}
