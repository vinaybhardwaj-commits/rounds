// ============================================
// GET /api/wa-analysis/list
// Paginated list of WhatsApp analyses.
// Protected: any authenticated user.
// Phase: WA.2
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const sql = neon(process.env.POSTGRES_URL!);

    const rows = await sql(
      `SELECT
         a.id, a.source_filename, a.source_group, a.status,
         a.total_messages_parsed, a.new_messages_processed,
         a.duplicate_messages_skipped, a.departments_with_data,
         a.date_range_start, a.date_range_end,
         a.processing_time_ms, a.model_used,
         a.created_at, a.completed_at,
         p.full_name as uploaded_by_name
       FROM wa_analyses a
       LEFT JOIN profiles p ON a.uploaded_by = p.id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countResult = await sql(
      'SELECT count(*)::int as total FROM wa_analyses',
    ) as { total: number }[];

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        total: countResult[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('GET /api/wa-analysis/list error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list analyses';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
