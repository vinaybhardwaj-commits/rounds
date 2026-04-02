// ============================================
// PATCH /api/ot/equipment/[id]
// Update equipment status
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { updateEquipmentStatus } from '@/lib/ot/surgery-postings';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    if (!body.status) {
      return NextResponse.json({ success: false, error: 'status is required' }, { status: 400 });
    }

    const validStatuses = ['requested', 'ordered', 'shipped', 'delivered', 'verified', 'unavailable'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const result = await updateEquipmentStatus(id, body.status, {
      delivery_eta: body.delivery_eta,
      status_notes: body.status_notes,
      verified_by: body.status === 'verified' ? user.profileId : undefined,
    });

    if (!result) {
      return NextResponse.json({ success: false, error: 'Equipment item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('PATCH /api/ot/equipment/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update equipment' }, { status: 500 });
  }
}
