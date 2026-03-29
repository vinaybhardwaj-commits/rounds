// ============================================
// GET /api/readiness/[formId] — all readiness
// items for a form submission
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listReadinessItems, getReadinessAggregate } from '@/lib/db-v5';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { formId } = await params;
    const items = await listReadinessItems(formId);
    const aggregate = await getReadinessAggregate(formId);

    return NextResponse.json({
      success: true,
      data: { items, aggregate },
    });
  } catch (error) {
    console.error('GET /api/readiness/[formId] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list readiness items' },
      { status: 500 }
    );
  }
}
