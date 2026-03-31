// ============================================
// GET /api/readiness/completed — list confirmed
// readiness items for active patients
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCompletedReadinessItems } from '@/lib/db-v5';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const items = await getCompletedReadinessItems();
    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /api/readiness/completed error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch completed items' },
      { status: 500 }
    );
  }
}
