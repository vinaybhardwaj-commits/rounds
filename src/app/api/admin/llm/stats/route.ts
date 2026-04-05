// ============================================
// GET /api/admin/llm/stats
// LLM Observatory summary — usage, latency, error rates, trends
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

    // ── 1. Overall stats (7d) ──
    let overview: any = {};
    try {
      const result = await sql(`
        SELECT
          COUNT(*)::int as total_calls,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int as successful,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as errors,
          SUM(CASE WHEN fallback_used = true THEN 1 ELSE 0 END)::int as fallbacks,
          SUM(CASE WHEN cache_hit = true THEN 1 ELSE 0 END)::int as cache_hits,
          COALESCE(SUM(tokens_prompt), 0)::int as total_tokens_prompt,
          COALESCE(SUM(tokens_completion), 0)::int as total_tokens_completion,
          COALESCE(AVG(latency_ms), 0)::int as avg_latency_ms,
          COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::int as p50_latency,
          COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int as p95_latency,
          COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms), 0)::int as p99_latency
        FROM llm_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
      `);
      overview = result[0] || {};
    } catch { /* skip */ }

    // ── 2. Calls by analysis type (7d) ──
    let byType: any[] = [];
    try {
      byType = await sql(`
        SELECT
          analysis_type,
          COUNT(*)::int as call_count,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int as successful,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as errors,
          COALESCE(AVG(latency_ms), 0)::int as avg_latency_ms,
          COALESCE(SUM(tokens_prompt + tokens_completion), 0)::int as total_tokens
        FROM llm_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY analysis_type
        ORDER BY call_count DESC
      `);
    } catch { /* skip */ }

    // ── 3. Daily usage trend (14d) ──
    let dailyTrend: any[] = [];
    try {
      dailyTrend = await sql(`
        SELECT
          DATE(created_at) as date,
          COUNT(*)::int as calls,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as errors,
          COALESCE(AVG(latency_ms), 0)::int as avg_latency_ms,
          COALESCE(SUM(tokens_prompt + tokens_completion), 0)::int as tokens
        FROM llm_logs
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `);
    } catch { /* skip */ }

    // ── 4. Latency distribution (7d) ──
    let latencyDist: any[] = [];
    try {
      latencyDist = await sql(`
        SELECT bucket, SUM(cnt)::int as count FROM (
          SELECT
            CASE
              WHEN latency_ms < 500 THEN '< 500ms'
              WHEN latency_ms < 1000 THEN '500ms-1s'
              WHEN latency_ms < 2000 THEN '1-2s'
              WHEN latency_ms < 5000 THEN '2-5s'
              WHEN latency_ms < 10000 THEN '5-10s'
              ELSE '10s+'
            END as bucket,
            CASE
              WHEN latency_ms < 500 THEN 1
              WHEN latency_ms < 1000 THEN 2
              WHEN latency_ms < 2000 THEN 3
              WHEN latency_ms < 5000 THEN 4
              WHEN latency_ms < 10000 THEN 5
              ELSE 6
            END as sort_order,
            1 as cnt
          FROM llm_logs
          WHERE created_at > NOW() - INTERVAL '7 days'
        ) bucketed
        GROUP BY bucket, sort_order
        ORDER BY sort_order
      `);
    } catch { /* skip */ }

    // ── 5. Recent errors (last 10) ──
    let recentErrors: any[] = [];
    try {
      recentErrors = await sql(`
        SELECT
          ll.id,
          ll.analysis_type,
          ll.route,
          ll.error_message,
          ll.latency_ms,
          ll.model,
          ll.fallback_used,
          ll.created_at,
          p.full_name as triggered_by_name
        FROM llm_logs ll
        LEFT JOIN profiles p ON ll.triggered_by = p.id
        WHERE ll.status = 'error'
        ORDER BY ll.created_at DESC
        LIMIT 10
      `);
    } catch { /* skip */ }

    // ── 6. Model breakdown ──
    let modelBreakdown: any[] = [];
    try {
      modelBreakdown = await sql(`
        SELECT
          model,
          COUNT(*)::int as call_count,
          COALESCE(AVG(latency_ms), 0)::int as avg_latency_ms,
          COALESCE(SUM(tokens_prompt + tokens_completion), 0)::int as total_tokens,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as errors
        FROM llm_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY model
        ORDER BY call_count DESC
      `);
    } catch { /* skip */ }

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          total_calls: overview.total_calls || 0,
          successful: overview.successful || 0,
          errors: overview.errors || 0,
          fallbacks: overview.fallbacks || 0,
          cache_hits: overview.cache_hits || 0,
          total_tokens_prompt: overview.total_tokens_prompt || 0,
          total_tokens_completion: overview.total_tokens_completion || 0,
          total_tokens: (overview.total_tokens_prompt || 0) + (overview.total_tokens_completion || 0),
          avg_latency_ms: overview.avg_latency_ms || 0,
          p50_latency: overview.p50_latency || 0,
          p95_latency: overview.p95_latency || 0,
          p99_latency: overview.p99_latency || 0,
          success_rate: overview.total_calls > 0
            ? Math.round((overview.successful / overview.total_calls) * 100)
            : 0,
        },
        by_type: byType.map((t: any) => ({
          analysis_type: t.analysis_type,
          call_count: t.call_count,
          successful: t.successful,
          errors: t.errors,
          avg_latency_ms: t.avg_latency_ms,
          total_tokens: t.total_tokens,
        })),
        daily_trend: dailyTrend.map((d: any) => ({
          date: typeof d.date === 'string' ? d.date.split('T')[0] : new Date(d.date).toISOString().split('T')[0],
          calls: d.calls,
          errors: d.errors,
          avg_latency_ms: d.avg_latency_ms,
          tokens: d.tokens,
        })),
        latency_distribution: latencyDist.map((d: any) => ({
          bucket: d.bucket,
          count: d.count,
        })),
        recent_errors: recentErrors.map((e: any) => ({
          id: e.id,
          analysis_type: e.analysis_type,
          route: e.route,
          error_message: e.error_message,
          latency_ms: e.latency_ms,
          model: e.model,
          fallback_used: e.fallback_used,
          created_at: e.created_at,
          triggered_by_name: e.triggered_by_name,
        })),
        model_breakdown: modelBreakdown.map((m: any) => ({
          model: m.model,
          call_count: m.call_count,
          avg_latency_ms: m.avg_latency_ms,
          total_tokens: m.total_tokens,
          errors: m.errors,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/llm/stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch LLM stats' },
      { status: 500 }
    );
  }
}
