// ============================================
// GET /api/ot/schedule?date=YYYY-MM-DD&ot_room=N
// Daily OT schedule with readiness counts
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOTSchedule } from '@/lib/ot/surgery-postings';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json({ success: false, error: 'date query parameter required (YYYY-MM-DD)' }, { status: 400 });
    }

    const otRoom = searchParams.get('ot_room') ? parseInt(searchParams.get('ot_room')!) : undefined;
    const schedule = await getOTSchedule(date, otRoom);

    return NextResponse.json({ success: true, data: schedule });
  } catch (error) {
    console.error('GET /api/ot/schedule error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get OT schedule' }, { status: 500 });
  }
}
