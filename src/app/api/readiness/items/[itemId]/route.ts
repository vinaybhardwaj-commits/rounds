// ============================================
// PATCH /api/readiness/items/[itemId] — confirm
// or flag a readiness item
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { updateReadinessItem } from '@/lib/db-v5';
import type { ReadinessStatus } from '@/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { itemId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = params;
    const body = await request.json();
    const { status, flagged_reason, notes, responsible_user_id } = body;

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'status is required (pending, confirmed, flagged, not_applicable)' },
        { status: 400 }
      );
    }

    const validStatuses: ReadinessStatus[] = ['pending', 'confirmed', 'flagged', 'not_applicable'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const updated = await updateReadinessItem(itemId, {
      status,
      confirmed_by: status === 'confirmed' ? user.profileId : undefined,
      flagged_reason: flagged_reason || undefined,
      notes: notes || undefined,
      responsible_user_id: responsible_user_id || undefined,
    });

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Readiness item not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: updated,
      message: `Readiness item ${status}`,
    });
  } catch (error) {
    console.error('PATCH /api/readiness/items/[itemId] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update readiness item' },
      { status: 500 }
    );
  }
}
