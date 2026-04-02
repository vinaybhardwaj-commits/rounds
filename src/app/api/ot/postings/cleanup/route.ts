// ============================================
// POST /api/ot/postings/cleanup
// Cron: auto-complete surgeries from past dates
// that are still in 'posted' status
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // Auto-complete postings from yesterday or earlier that are still 'posted'
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const today = istDate.toISOString().split('T')[0];

    const result = await sql(`
      UPDATE surgery_postings
      SET status = 'completed', updated_at = NOW()
      WHERE status = 'posted'
        AND scheduled_date < $1
      RETURNING id, procedure_name, scheduled_date
    `, [today]);

    return NextResponse.json({
      success: true,
      data: {
        completed_count: result.length,
        postings: result,
      },
    });
  } catch (error) {
    console.error('POST /api/ot/postings/cleanup error:', error);
    return NextResponse.json({ success: false, error: 'Cleanup failed' }, { status: 500 });
  }
}
