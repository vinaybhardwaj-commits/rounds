// ============================================
// GET /api/ot/readiness/overdue
// List all overdue readiness items
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOverdueOTItems } from '@/lib/ot/surgery-postings';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const items = await getOverdueOTItems();
    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /api/ot/readiness/overdue error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get overdue items' }, { status: 500 });
  }
}
