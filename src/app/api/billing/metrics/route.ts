// ============================================
// /api/billing/metrics
//
// GET — Aggregated billing intelligence dashboard.
//       Optional query params: from, to (ISO dates)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getBillingDashboard } from '@/lib/billing-metrics';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    const dashboard = await getBillingDashboard(from, to);

    return NextResponse.json({
      success: true,
      data: dashboard,
      message: `Billing intelligence for ${dashboard.period.from} to ${dashboard.period.to}`,
    });
  } catch (error) {
    console.error('GET /api/billing/metrics error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch billing metrics' },
      { status: 500 }
    );
  }
}
