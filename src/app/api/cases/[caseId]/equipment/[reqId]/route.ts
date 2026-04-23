// ============================================
// PATCH /api/cases/[caseId]/equipment/[reqId]
// DELETE /api/cases/[caseId]/equipment/[reqId]
//
// Mutate one equipment_requests row — status chain transitions (drag-drop
// between Kanban columns), vendor/eta/notes edits, or remove.
//
// PATCH body:
//   {
//     status?: 'requested' | 'vendor_confirmed' | 'in_transit' | 'delivered' | 'verified_ready',
//     vendor_name?: string,
//     vendor_phone?: string,
//     eta?: ISO8601 | null,      // null clears
//     notes?: string | null      // null clears
//   }
//
// Access control:
//   - tenancy via user_accessible_hospital_ids(caller)
//   - PATCH: biomedical_engineer OR ot_coordinator OR super_admin
//   - DELETE: biomedical_engineer OR ot_coordinator OR super_admin
//
// Sprint 2 Day 9 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const MUTATE_ROLES = new Set(['biomedical_engineer', 'ot_coordinator', 'super_admin']);
const VALID_STATUSES = new Set(['requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface PatchBody {
  status?: string;
  vendor_name?: string | null;
  vendor_phone?: string | null;
  eta?: string | null;
  notes?: string | null;
}

async function guard(
  caseId: string,
  reqId: string,
  userId: string,
  role: string
) {
  if (!UUID_RE.test(caseId) || !UUID_RE.test(reqId)) {
    return { error: 'Invalid id', status: 400 as const };
  }
  if (!MUTATE_ROLES.has(role)) {
    return {
      error: `Role ${role} cannot mutate equipment. Required: ${[...MUTATE_ROLES].join(' or ')}.`,
      status: 403 as const,
    };
  }
  const row = await queryOne<{ id: string; status: string; case_id: string }>(
    `
    SELECT er.id, er.status, er.case_id
    FROM equipment_requests er
    JOIN surgical_cases sc ON sc.id = er.case_id
    WHERE er.id = $1
      AND er.case_id = $2
      AND sc.hospital_id = ANY(user_accessible_hospital_ids($3::UUID))
    `,
    [reqId, caseId, userId]
  );
  if (!row) return { error: 'Equipment request not found or access denied', status: 404 as const };
  return { row };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { caseId: string; reqId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    const g = await guard(params.caseId, params.reqId, user.profileId, user.role);
    if ('error' in g) {
      return NextResponse.json({ success: false, error: g.error }, { status: g.status });
    }

    const body = (await request.json()) as PatchBody;

    // Build dynamic SET clauses. Only update fields present in body.
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (body.status !== undefined) {
      if (!VALID_STATUSES.has(body.status)) {
        return NextResponse.json(
          { success: false, error: `Invalid status. Allowed: ${[...VALID_STATUSES].join(', ')}` },
          { status: 400 }
        );
      }
      sets.push(`status = $${i++}`);
      vals.push(body.status);
    }
    if ('vendor_name' in body) {
      sets.push(`vendor_name = $${i++}`);
      vals.push(body.vendor_name);
    }
    if ('vendor_phone' in body) {
      sets.push(`vendor_phone = $${i++}`);
      vals.push(body.vendor_phone);
    }
    if ('eta' in body) {
      sets.push(`eta = $${i++}`);
      vals.push(body.eta);
    }
    if ('notes' in body) {
      sets.push(`notes = $${i++}`);
      vals.push(body.notes);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    sets.push(`updated_at = NOW()`);
    vals.push(params.reqId);

    await query(
      `UPDATE equipment_requests SET ${sets.join(', ')} WHERE id = $${i}`,
      vals
    );

    return NextResponse.json({
      success: true,
      data: { id: params.reqId, status_changed: body.status !== undefined },
    });
  } catch (error) {
    console.error('PATCH /api/cases/[caseId]/equipment/[reqId] error:', error);
    return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { caseId: string; reqId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    const g = await guard(params.caseId, params.reqId, user.profileId, user.role);
    if ('error' in g) {
      return NextResponse.json({ success: false, error: g.error }, { status: g.status });
    }

    await query(`DELETE FROM equipment_requests WHERE id = $1`, [params.reqId]);

    return NextResponse.json({ success: true, data: { id: params.reqId, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/cases/[caseId]/equipment/[reqId] error:', error);
    return NextResponse.json({ success: false, error: 'Delete failed' }, { status: 500 });
  }
}
