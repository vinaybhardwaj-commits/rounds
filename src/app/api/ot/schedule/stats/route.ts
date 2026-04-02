// ============================================
// GET /api/ot/schedule/stats?date=YYYY-MM-DD
// Aggregate readiness stats for the day
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOTScheduleStats } from '@/lib/ot/surgery-postings';

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

    const stats = await getOTScheduleStats(date);
    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    console.error('GET /api/ot/schedule/stats error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get schedule stats' }, { status: 500 });
  }
}
