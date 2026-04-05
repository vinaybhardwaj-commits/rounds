// ============================================
// GET /api/admin/llm/logs/[id]
// Full detail for a single LLM call — including prompts and responses
// Protected: super_admin only
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const logId = params.id;

    const result = await sql(
      `SELECT
        ll.*,
        p.full_name as triggered_by_name,
        p.email as triggered_by_email,
        p.role as triggered_by_role
      FROM llm_logs ll
      LEFT JOIN profiles p ON ll.triggered_by = p.id
      WHERE ll.id = $1`,
      [logId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'LLM log not found' },
        { status: 404 }
      );
    }

    const log = result[0] as any;

    return NextResponse.json({
      success: true,
      data: {
        id: log.id,
        route: log.route,
        analysis_type: log.analysis_type,
        prompt_messages: log.prompt_messages,
        response_raw: log.response_raw,
        response_parsed: log.response_parsed,
        model: log.model,
        tokens_prompt: log.tokens_prompt || 0,
        tokens_completion: log.tokens_completion || 0,
        tokens_total: (log.tokens_prompt || 0) + (log.tokens_completion || 0),
        latency_ms: log.latency_ms,
        status: log.status,
        error_message: log.error_message,
        cache_hit: log.cache_hit,
        fallback_used: log.fallback_used,
        source_id: log.source_id,
        source_type: log.source_type,
        triggered_by_name: log.triggered_by_name,
        triggered_by_email: log.triggered_by_email,
        triggered_by_role: log.triggered_by_role,
        metadata: log.metadata,
        created_at: log.created_at,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/llm/logs/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch LLM log detail' },
      { status: 500 }
    );
  }
}
