// ============================================
// POST /api/cases/[caseId]/equipment
//
// Create a new equipment_requests row for a case. Non-kit path — for items
// Arul adds manually via the Equipment Kanban. Kit-based rows are auto-created
// by POST /api/cases/:id/schedule.
//
// Body:
//   {
//     item_type: 'specialty' | 'rental' | 'implant' | 'blood' | 'imaging',
//     item_label: string,
//     quantity?: number (default 1),
//     vendor_name?: string,
//     vendor_phone?: string,
//     eta?: ISO8601 timestamp,
//     notes?: string,
//     status?: 'requested' | 'vendor_confirmed' | 'in_transit' | 'delivered' | 'verified_ready'
//               (default 'requested')
//   }
//
// Access control:
//   - case's hospital_id must be in user_accessible_hospital_ids(caller)
//   - caller's role must be biomedical_engineer OR ot_coordinator OR super_admin
//
// Sprint 2 Day 9 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';

const CREATE_ROLES = new Set(['biomedical_engineer', 'ot_coordinator', 'super_admin']);
const VALID_ITEM_TYPES = new Set(['specialty', 'rental', 'implant', 'blood', 'imaging']);
const VALID_STATUSES = new Set(['requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface CreateBody {
  item_type?: string;
  item_label?: string;
  quantity?: number;
  vendor_name?: string;
  vendor_phone?: string;
  eta?: string;
  notes?: string;
  status?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    if (!CREATE_ROLES.has(user.role)) {
      return NextResponse.json(
        { success: false, error: `Role ${user.role} cannot create equipment requests. Required: ${[...CREATE_ROLES].join(' or ')}.` },
        { status: 403 }
      );
    }

    const { id: caseId } = params;  // keep internal var name for clarity — the URL param is `id`
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as CreateBody;

    if (!body.item_type || !VALID_ITEM_TYPES.has(body.item_type)) {
      return NextResponse.json(
        { success: false, error: `item_type must be one of: ${[...VALID_ITEM_TYPES].join(', ')}` },
        { status: 400 }
      );
    }
    const label = typeof body.item_label === 'string' ? body.item_label.trim() : '';
    if (!label || label.length > 200) {
      return NextResponse.json(
        { success: false, error: 'item_label required, max 200 chars' },
        { status: 400 }
      );
    }
    const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));
    const status = body.status && VALID_STATUSES.has(body.status) ? body.status : 'requested';

    // Tenancy: case exists + accessible.
    const c = await queryOne<{ id: string; hospital_id: string }>(
      `
      SELECT sc.id, sc.hospital_id
      FROM surgical_cases sc
      WHERE sc.id = $1
        AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))
      `,
      [caseId, user.profileId]
    );
    if (!c) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    const row = await queryOne<{ id: string; created_at: string }>(
      `
      INSERT INTO equipment_requests
        (case_id, item_type, item_label, quantity, status, vendor_name, vendor_phone, eta, notes, auto_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
      RETURNING id, created_at
      `,
      [
        caseId,
        body.item_type,
        label,
        quantity,
        status,
        body.vendor_name ?? null,
        body.vendor_phone ?? null,
        body.eta ?? null,
        body.notes ?? null,
      ]
    );

    return NextResponse.json({
      success: true,
      data: {
        id: row?.id ?? null,
        created_at: row?.created_at ?? null,
      },
    });
  } catch (error) {
    console.error('POST /api/cases/[caseId]/equipment error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create equipment request' },
      { status: 500 }
    );
  }
}
