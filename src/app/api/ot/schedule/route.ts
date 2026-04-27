// ============================================
// GET /api/ot/schedule?date=YYYY-MM-DD&ot_room=N
// Daily OT schedule with readiness counts
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { getOTSchedule } from '@/lib/ot/surgery-postings';

export const GET = withTenancy('/api/ot/schedule', async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json({ success: false, error: 'date query parameter required (YYYY-MM-DD)' }, { status: 400 });
    }

    const otRoom = searchParams.get('ot_room') ? parseInt(searchParams.get('ot_room')!) : undefined;

    // Fetch schedule filtered to accessible hospitals
    const schedule = await query(
      `SELECT sp.* FROM surgery_postings sp
       JOIN patient_threads pt ON pt.id = sp.patient_thread_id
       WHERE sp.scheduled_date = $1::date
       AND pt.hospital_id = ANY($2::uuid[])
       ${otRoom ? `AND sp.ot_room = ${otRoom}` : ''}
       ORDER BY sp.scheduled_time ASC, sp.id`,
      [date, ctx.accessibleHospitalIds]
    );

    return NextResponse.json({ success: true, data: schedule });
  } catch (error) {
    console.error('GET /api/ot/schedule error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get OT schedule' }, { status: 500 });
  }
});
