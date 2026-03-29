// ============================================
// GET /api/forms/[id] — get form submission
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getFormSubmission, listReadinessItems, getReadinessAggregate } from '@/lib/db-v5';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const form = await getFormSubmission(id);
    if (!form) {
      return NextResponse.json({ success: false, error: 'Form submission not found' }, { status: 404 });
    }

    // Fetch readiness items if any exist for this form
    const readinessItems = await listReadinessItems(id);
    const readinessAggregate = readinessItems.length > 0
      ? await getReadinessAggregate(id)
      : null;

    return NextResponse.json({
      success: true,
      data: {
        ...form,
        readiness_items: readinessItems,
        readiness_aggregate: readinessAggregate,
      },
    });
  } catch (error) {
    console.error('GET /api/forms/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get form submission' },
      { status: 500 }
    );
  }
}
