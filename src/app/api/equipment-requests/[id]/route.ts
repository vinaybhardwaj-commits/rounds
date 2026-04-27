// =============================================================================
// PATCH /api/equipment-requests/[id]
//
// Generic equipment-request mutation endpoint that works for BOTH case-bound
// and case-less rows. Supersedes the case-scoped PATCH path for the kanban
// status-drag flow (case_id is no longer guaranteed after the 26 Apr 2026
// modal redesign).
//
// Tenancy gate uses the row's denormalized hospital_id directly.
//
// Body:
//   { status?, vendor_name?, vendor_phone?, eta?, notes?, rental_description? }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

const VALID_STATUSES = new Set([
  'requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready',
]);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface PatchBody {
  status?: string;
  vendor_name?: string | null;
  vendor_phone?: string | null;
  eta?: string | null;
  notes?: string | null;
  rental_description?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid request id' }, { status: 400 });
    }

    // Tenancy: row exists in caller's accessible hospitals.
    const row = await queryOne<{ id: string; hospital_id: string; status: string }>(
      `SELECT id, hospital_id, status FROM equipment_requests
        WHERE id = $1
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [id, user.profileId]
    );
    if (!row) {
      return NextResponse.json({ success: false, error: 'Request not found or access denied' }, { status: 404 });
    }

    const body = (await request.json()) as PatchBody;

    // Build SET clause dynamically — only include fields that were supplied.
    const sets: string[] = [];
    const args: unknown[] = [];

    if (body.status !== undefined) {
      if (!VALID_STATUSES.has(body.status)) {
        return NextResponse.json(
          { success: false, error: `Invalid status: ${body.status}` },
          { status: 400 }
        );
      }
      args.push(body.status);
      sets.push(`status = $${args.length}`);
    }
    if (body.vendor_name !== undefined) {
      args.push(body.vendor_name);
      sets.push(`vendor_name = $${args.length}`);
    }
    if (body.vendor_phone !== undefined) {
      args.push(body.vendor_phone);
      sets.push(`vendor_phone = $${args.length}`);
    }
    if (body.eta !== undefined) {
      args.push(body.eta);
      sets.push(`eta = $${args.length}`);
    }
    if (body.notes !== undefined) {
      args.push(body.notes);
      sets.push(`notes = $${args.length}`);
    }
    if (body.rental_description !== undefined) {
      const rd = body.rental_description;
      if (rd && rd.length > 500) {
        return NextResponse.json({ success: false, error: 'rental_description too long' }, { status: 400 });
      }
      args.push(rd);
      sets.push(`rental_description = $${args.length}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, error: 'No mutable fields supplied' }, { status: 400 });
    }

    sets.push(`updated_at = NOW()`);
    args.push(id);
    await query(
      `UPDATE equipment_requests SET ${sets.join(', ')} WHERE id = $${args.length}`,
      args
    );
    // Fire-and-forget audit for equipment request update
    const changedFields: Record<string, unknown> = {};
    if (body.status !== undefined) changedFields.status = body.status;
    if (body.vendor_name !== undefined) changedFields.vendor_name = body.vendor_name;
    if (body.vendor_phone !== undefined) changedFields.vendor_phone = body.vendor_phone;
    if (body.eta !== undefined) changedFields.eta = body.eta;
    if (body.notes !== undefined) changedFields.notes = body.notes;
    if (body.rental_description !== undefined) changedFields.rental_description = body.rental_description;

    await audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: row.hospital_id,
      action: 'equipment.request_update',
      targetType: 'equipment_request',
      targetId: id,
      summary: `Updated equipment request ${id}: ${Object.keys(changedFields).join(', ')}`,
      payloadBefore: { status: row.status },
      payloadAfter: changedFields,
      request,
    }).catch((e) => console.error('[audit] equipment.request_update failed:', e));

    return NextResponse.json({ success: true, data: { id, prev_status: row.status } });
  } catch (error) {
    console.error('PATCH /api/equipment-requests/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update equipment request' },
      { status: 500 }
    );
  }
}
