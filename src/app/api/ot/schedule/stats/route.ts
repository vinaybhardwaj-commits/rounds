// ============================================
// GET /api/ot/schedule/stats?date=YYYY-MM-DD
// Aggregate readiness stats for the day
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { getOTScheduleStats } from '@/lib/ot/surgery-postings';

export const GET = withTenancy('/api/ot/schedule/stats', async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json({ success: false, error: 'date query parameter required (YYYY-MM-DD)' }, { status: 400 });
    }

    // Get stats filtered to accessible hospitals
    const stats = await query(
      `SELECT
         COUNT(*) FILTER (WHERE sp.status = 'posted') as total,
         COUNT(*) FILTER (WHERE sp.status = 'completed') as ready
       FROM surgery_postings sp
       JOIN patient_threads pt ON pt.id = sp.patient_thread_id
       WHERE sp.scheduled_date = $1::date
       AND pt.hospital_id = ANY($2::uuid[])`,
      [date, ctx.accessibleHospitalIds]
    );

    return NextResponse.json({ success: true, data: stats[0] || { total: 0, ready: 0 } });
  } catch (error) {
    console.error('GET /api/ot/schedule/stats error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get schedule stats' }, { status: 500 });
  }
});
