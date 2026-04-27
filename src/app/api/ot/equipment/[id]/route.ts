// ============================================
// PATCH /api/ot/equipment/[id]
// Update equipment status
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { updateEquipmentStatus } from '@/lib/ot/surgery-postings';

interface RouteParams {
  id: string;
}

export const PATCH = withTenancy<RouteParams>('/api/ot/equipment/[id]', async (request, ctx) => {
  try {
    const { id } = ctx.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid equipment ID format' }, { status: 400 });
    }

    // Verify tenancy before mutation
    const tenancyCheck = await query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM ot_equipment_items oei
        JOIN patient_threads pt ON pt.id = oei.patient_thread_id
        WHERE oei.id = $1::uuid AND pt.hospital_id = ANY($2::uuid[])
      ) AS ok`,
      [id, ctx.accessibleHospitalIds]
    );
    if (!tenancyCheck?.[0]?.ok) {
      return NextResponse.json({ success: false, error: 'Equipment item not found' }, { status: 404 });
    }

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
      verified_by: body.status === 'verified' ? ctx.user.profileId : undefined,
    });

    if (!result) {
      return NextResponse.json({ success: false, error: 'Equipment item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('PATCH /api/ot/equipment/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update equipment' }, { status: 500 });
  }
});
