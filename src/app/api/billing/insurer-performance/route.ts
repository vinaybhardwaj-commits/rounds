// ============================================
// /api/billing/insurer-performance
//
// GET — Per-insurer benchmarks: TAT, recovery,
//       denial rates, query frequency.
//       Optional query params: from, to (ISO dates)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getInsurerPerformance } from '@/lib/billing-metrics';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    const insurers = await getInsurerPerformance(from, to);

    return NextResponse.json({
      success: true,
      data: {
        insurers,
        count: insurers.length,
      },
      message: `${insurers.length} insurer(s) with claim data`,
    });
  } catch (error) {
    console.error('GET /api/billing/insurer-performance error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch insurer performance' },
      { status: 500 }
    );
  }
}
