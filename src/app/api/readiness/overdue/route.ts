// ============================================
// GET /api/readiness/overdue
// Returns all pending readiness items past their due_by date.
// Step 6.2: Tasks view data source.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOverdueReadinessItems } from '@/lib/db-v5';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const items = await getOverdueReadinessItems();
    return NextResponse.json({ success: true, data: items || [] });
  } catch (error) {
    console.error('GET /api/readiness/overdue error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch overdue items' },
      { status: 500 }
    );
  }
}
