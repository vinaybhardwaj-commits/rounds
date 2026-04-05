// ============================================
// GET /api/admin/llm/logs
// Paginated LLM call log with filters
// Protected: super_admin only
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = (page - 1) * limit;
    const status = searchParams.get('status'); // success, error, fallback
    const analysisType = searchParams.get('type'); // gap_analysis, briefing, prediction, etc.
    const search = searchParams.get('search'); // search in prompts/responses
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');

    // Build WHERE
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`ll.status = $${idx}`);
      params.push(status);
      idx++;
    }

    if (analysisType) {
      conditions.push(`ll.analysis_type = $${idx}`);
      params.push(analysisType);
      idx++;
    }

    if (search) {
      conditions.push(`(ll.response_raw ILIKE $${idx} OR ll.error_message ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    if (dateFrom) {
      conditions.push(`ll.created_at >= $${idx}::timestamptz`);
      params.push(dateFrom);
      idx++;
    }

    if (dateTo) {
      conditions.push(`ll.created_at <= $${idx}::timestamptz`);
      params.push(dateTo);
      idx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Main query
    const logsQuery = `
      SELECT
        ll.id,
        ll.route,
        ll.analysis_type,
        ll.model,
        ll.tokens_prompt,
        ll.tokens_completion,
        ll.latency_ms,
        ll.status,
        ll.error_message,
        ll.cache_hit,
        ll.fallback_used,
        ll.source_type,
        ll.created_at,
        p.full_name as triggered_by_name,
        p.email as triggered_by_email
      FROM llm_logs ll
      LEFT JOIN profiles p ON ll.triggered_by = p.id
      ${whereClause}
      ORDER BY ll.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);

    const logs = await sql(logsQuery, params);

    // Count
    const countParams = params.slice(0, -2);
    const countQuery = `SELECT COUNT(*)::int as total FROM llm_logs ll ${whereClause}`;
    const countResult = await sql(countQuery, countParams);

    return NextResponse.json({
      success: true,
      data: {
        logs: logs.map((l: any) => ({
          id: l.id,
          route: l.route,
          analysis_type: l.analysis_type,
          model: l.model,
          tokens_prompt: l.tokens_prompt || 0,
          tokens_completion: l.tokens_completion || 0,
          tokens_total: (l.tokens_prompt || 0) + (l.tokens_completion || 0),
          latency_ms: l.latency_ms,
          status: l.status,
          error_message: l.error_message,
          cache_hit: l.cache_hit,
          fallback_used: l.fallback_used,
          source_type: l.source_type,
          triggered_by_name: l.triggered_by_name,
          triggered_by_email: l.triggered_by_email,
          created_at: l.created_at,
        })),
        pagination: {
          page,
          limit,
          total: countResult[0]?.total || 0,
          totalPages: Math.ceil((countResult[0]?.total || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error('GET /api/admin/llm/logs error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch LLM logs' },
      { status: 500 }
    );
  }
}
