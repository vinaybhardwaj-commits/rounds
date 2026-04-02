// ============================================
// GET /api/ot/readiness/mine
// My pending readiness items (role-filtered)
// Supports ?count_only=true for badge count
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMyReadinessItems } from '@/lib/ot/surgery-postings';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const countOnly = searchParams.get('count_only') === 'true';

    const result = await getMyReadinessItems(user.role, user.profileId, countOnly);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/ot/readiness/mine error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get my readiness items' }, { status: 500 });
  }
}
