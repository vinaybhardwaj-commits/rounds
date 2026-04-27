// ============================================
// GET /api/admin/help/analytics
// Help system analytics — questions, coverage, satisfaction, trends
// Protected: super_admin only
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { getAdminHospitalScope, isAdminRole } from '@/lib/admin-hospital-scope';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdminRole(user.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const scope = await getAdminHospitalScope(user.role, user.primary_hospital_id ?? '');

    const sql = neon(process.env.POSTGRES_URL!);

    // ── 1. Overall stats ──
    let overview: any = {};
    try {
      const result = await sql(`
        SELECT
          COUNT(*)::int as total_questions,
          COUNT(DISTINCT profile_id)::int as unique_users,
          SUM(CASE WHEN response_source = 'ai' THEN 1 ELSE 0 END)::int as ai_answers,
          SUM(CASE WHEN response_source = 'template' THEN 1 ELSE 0 END)::int as template_answers,
          SUM(CASE WHEN response_source IS NULL OR response_source = 'no_match' THEN 1 ELSE 0 END)::int as no_match,
          SUM(CASE WHEN helpful = true THEN 1 ELSE 0 END)::int as helpful_count,
          SUM(CASE WHEN helpful = false THEN 1 ELSE 0 END)::int as unhelpful_count,
          SUM(CASE WHEN helpful IS NOT NULL THEN 1 ELSE 0 END)::int as rated_count
        FROM help_interactions
      `);
      overview = result[0] || {};
    } catch { /* skip */ }

    // Calculate satisfaction rate
    const rated_count = overview.rated_count || 0;
    const helpful_count = overview.helpful_count || 0;
    const satisfaction_rate = rated_count > 0
      ? Math.round((helpful_count / rated_count) * 100)
      : 0;

    // ── 2. By source breakdown ──
    let bySource: any[] = [];
    try {
      bySource = await sql(`
        SELECT
          response_source,
          COUNT(*)::int as count,
          SUM(CASE WHEN helpful = true THEN 1 ELSE 0 END)::int as helpful_count,
          SUM(CASE WHEN helpful = false THEN 1 ELSE 0 END)::int as unhelpful_count
        FROM help_interactions
        GROUP BY response_source
        ORDER BY count DESC
      `);
    } catch { /* skip */ }

    // ── 3. By page breakdown ──
    let byPage: any[] = [];
    try {
      byPage = await sql(`
        SELECT
          context_page,
          COUNT(*)::int as count
        FROM help_interactions
        WHERE context_page IS NOT NULL
        GROUP BY context_page
        ORDER BY count DESC
      `);
    } catch { /* skip */ }

    // ── 4. Daily trend (last 30 days) ──
    let dailyTrend: any[] = [];
    try {
      dailyTrend = await sql(`
        SELECT
          DATE(created_at) as date,
          COUNT(*)::int as count
        FROM help_interactions
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `);
    } catch { /* skip */ }

    // ── 5. Top questions by frequency (group similar) ──
    let topQuestions: any[] = [];
    try {
      topQuestions = await sql(`
        SELECT
          question,
          COUNT(*)::int as count,
          MAX(response_source) as response_source,
          MAX(CASE WHEN helpful = true THEN true ELSE NULL END) as helpful
        FROM help_interactions
        WHERE question IS NOT NULL
        GROUP BY question
        ORDER BY count DESC
        LIMIT 10
      `);
    } catch { /* skip */ }

    // ── 6. Feature coverage (unnest matched_features array) ──
    let featureCoverage: any[] = [];
    try {
      featureCoverage = await sql(`
        SELECT
          feature,
          COUNT(*)::int as mention_count
        FROM (
          SELECT unnest(matched_features) as feature
          FROM help_interactions
          WHERE matched_features IS NOT NULL AND array_length(matched_features, 1) > 0
        ) features
        WHERE feature IS NOT NULL
        GROUP BY feature
        ORDER BY mention_count DESC
      `);
    } catch { /* skip */ }

    // ── 7. Recent questions (last 10) ──
    let recentQuestions: any[] = [];
    try {
      recentQuestions = await sql(`
        SELECT
          hi.id,
          hi.question,
          hi.response_source,
          hi.context_page,
          hi.helpful,
          p.full_name as profile_name,
          hi.created_at
        FROM help_interactions hi
        LEFT JOIN profiles p ON hi.profile_id = p.id
        ORDER BY hi.created_at DESC
        LIMIT 10
      `);
    } catch { /* skip */ }

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          total_questions: overview.total_questions || 0,
          unique_users: overview.unique_users || 0,
          ai_answers: overview.ai_answers || 0,
          template_answers: overview.template_answers || 0,
          no_match: overview.no_match || 0,
          satisfaction_rate,
          rated_count,
        },
        by_source: bySource.map((s: any) => ({
          response_source: s.response_source || 'unknown',
          count: s.count,
          helpful_count: s.helpful_count || 0,
          unhelpful_count: s.unhelpful_count || 0,
        })),
        by_page: byPage.map((p: any) => ({
          context_page: p.context_page,
          count: p.count,
        })),
        daily_trend: dailyTrend.map((d: any) => ({
          date: typeof d.date === 'string' ? d.date.split('T')[0] : new Date(d.date).toISOString().split('T')[0],
          count: d.count,
        })),
        top_questions: topQuestions.map((q: any) => ({
          question: q.question,
          count: q.count,
          response_source: q.response_source || 'unknown',
          helpful: q.helpful,
        })),
        feature_coverage: featureCoverage.map((f: any) => ({
          feature: f.feature,
          mention_count: f.mention_count,
        })),
        recent_questions: recentQuestions.map((r: any) => ({
          id: r.id,
          question: r.question,
          response_source: r.response_source || 'unknown',
          context_page: r.context_page,
          helpful: r.helpful,
          profile_name: r.profile_name,
          created_at: r.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/help/analytics error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch help analytics' },
      { status: 500 }
    );
  }
}
