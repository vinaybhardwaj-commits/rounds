// ============================================
// POST /api/ot/postings/cleanup
// Cron: auto-complete surgeries from past dates
// that are still in 'posted' status
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { neon } from '@neondatabase/serverless';

export const POST = withTenancy('/api/ot/postings/cleanup', async (request: NextRequest, ctx) => {
  try {
    // Cron endpoint — all hospitals' postings, but super_admin gated
    if (ctx.user.role !== 'super_admin') {
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
        AND patient_thread_id IN (
          SELECT id FROM patient_threads
          WHERE hospital_id = ANY($2::uuid[])
        )
      RETURNING id, procedure_name, scheduled_date
    `, [today, ctx.accessibleHospitalIds]);

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
});
