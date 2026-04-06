// ============================================
// GET /api/wa-analysis/rubric-stats
// Quick summary of the rubric state.
// Protected: any authenticated user.
// Phase: WA.2
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const sql = neon(process.env.POSTGRES_URL!);

    const rows = await sql(
      `SELECT
         count(*)::int as departments,
         coalesce(sum(jsonb_array_length(fields)), 0)::int as total_fields
       FROM wa_rubric
       WHERE slug != 'global-issues'`,
    ) as { departments: number; total_fields: number }[];

    return NextResponse.json({
      success: true,
      data: rows[0] || { departments: 0, total_fields: 0 },
    });
  } catch (error) {
    console.error('GET /api/wa-analysis/rubric-stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load rubric stats' },
      { status: 500 },
    );
  }
}
