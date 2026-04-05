// ============================================
// GET /api/admin/forms/analytics
// Form Analytics summary — submission volume, completion scores, trends by type and department
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

    // ── 1. Overall stats ──
    let overview: any = {};
    try {
      const result = await sql(`
        SELECT
          COUNT(*)::int as total_submissions,
          COUNT(DISTINCT form_type)::int as unique_form_types,
          COALESCE(AVG(completion_score), 0)::decimal as avg_completion_score,
          SUM(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as submissions_7d,
          SUM(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int as submissions_30d
        FROM form_submissions
      `);
      overview = result[0] || {};
    } catch { /* skip */ }

    // ── 2. Submissions by form type (7d) ──
    let byType: any[] = [];
    try {
      byType = await sql(`
        SELECT
          form_type,
          COUNT(*)::int as count,
          COALESCE(AVG(completion_score), 0)::decimal as avg_score,
          COALESCE(MIN(completion_score), 0)::decimal as min_score,
          COALESCE(MAX(completion_score), 0)::decimal as max_score,
          MAX(created_at) as latest_at
        FROM form_submissions
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY form_type
        ORDER BY count DESC
      `);
    } catch { /* skip */ }

    // ── 3. Submissions by department (7d) ──
    let byDepartment: any[] = [];
    try {
      byDepartment = await sql(`
        SELECT
          d.name as department_name,
          COUNT(*)::int as count,
          COALESCE(AVG(fs.completion_score), 0)::decimal as avg_score
        FROM form_submissions fs
        LEFT JOIN departments d ON fs.department_id = d.id
        WHERE fs.created_at > NOW() - INTERVAL '7 days'
        GROUP BY d.id, d.name
        ORDER BY count DESC
      `);
    } catch { /* skip */ }

    // ── 4. Daily trend (30d) ──
    let dailyTrend: any[] = [];
    try {
      dailyTrend = await sql(`
        SELECT
          DATE(created_at) as date,
          COUNT(*)::int as count
        FROM form_submissions
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `);
    } catch { /* skip */ }

    // ── 5. Completion distribution ──
    let completionDistribution: any[] = [];
    try {
      completionDistribution = await sql(`
        SELECT bucket, SUM(cnt)::int as count FROM (
          SELECT
            CASE
              WHEN completion_score < 0.25 THEN '0-25%'
              WHEN completion_score < 0.50 THEN '25-50%'
              WHEN completion_score < 0.75 THEN '50-75%'
              ELSE '75-100%'
            END as bucket,
            CASE
              WHEN completion_score < 0.25 THEN 1
              WHEN completion_score < 0.50 THEN 2
              WHEN completion_score < 0.75 THEN 3
              ELSE 4
            END as sort_order,
            1 as cnt
          FROM form_submissions
        ) bucketed
        GROUP BY bucket, sort_order
        ORDER BY sort_order
      `);
    } catch { /* skip */ }

    // ── 6. Recent submissions (last 10) ──
    let recentSubmissions: any[] = [];
    try {
      recentSubmissions = await sql(`
        SELECT
          fs.id,
          fs.form_type,
          fs.status,
          fs.completion_score,
          p.full_name as submitted_by_name,
          d.name as department_name,
          fs.created_at
        FROM form_submissions fs
        LEFT JOIN profiles p ON fs.submitted_by = p.id
        LEFT JOIN departments d ON fs.department_id = d.id
        ORDER BY fs.created_at DESC
        LIMIT 10
      `);
    } catch { /* skip */ }

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          total_submissions: overview.total_submissions || 0,
          unique_form_types: overview.unique_form_types || 0,
          avg_completion_score: parseFloat(overview.avg_completion_score || 0).toFixed(2),
          submissions_7d: overview.submissions_7d || 0,
          submissions_30d: overview.submissions_30d || 0,
        },
        by_type: byType.map((t: any) => ({
          form_type: t.form_type,
          count: t.count,
          avg_score: parseFloat(t.avg_score || 0).toFixed(2),
          min_score: parseFloat(t.min_score || 0).toFixed(2),
          max_score: parseFloat(t.max_score || 0).toFixed(2),
          latest_at: t.latest_at,
        })),
        by_department: byDepartment.map((d: any) => ({
          department_name: d.department_name || 'Unassigned',
          count: d.count,
          avg_score: parseFloat(d.avg_score || 0).toFixed(2),
        })),
        daily_trend: dailyTrend.map((d: any) => ({
          date: typeof d.date === 'string' ? d.date.split('T')[0] : new Date(d.date).toISOString().split('T')[0],
          count: d.count,
        })),
        completion_distribution: completionDistribution.map((d: any) => ({
          bucket: d.bucket,
          count: d.count,
        })),
        recent_submissions: recentSubmissions.map((s: any) => ({
          id: s.id,
          form_type: s.form_type,
          status: s.status,
          completion_score: parseFloat(s.completion_score || 0).toFixed(2),
          submitted_by_name: s.submitted_by_name || 'Unknown',
          department_name: s.department_name || 'Unassigned',
          created_at: s.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/forms/analytics error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch form analytics' },
      { status: 500 }
    );
  }
}
