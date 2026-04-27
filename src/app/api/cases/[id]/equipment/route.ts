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

// 27 Apr 2026 (GLASS.5): clinical role gate removed — any authenticated user.
// 26 Apr 2026 follow-up F3: V added nurses, anaesthetists, consultants and
// surgeons to the create gate. 'charge_nurse', 'consultant', 'surgeon' are
// not yet in UserRole enum — they remain here as a forward-compatibility
// marker.
// Expanded item_types after the equipment_inventory migration. The DB CHECK
// was relaxed in the same migration to accept these.
const VALID_ITEM_TYPES = new Set([
  'specialty', 'rental', 'implant', 'blood', 'imaging',
  'surgical_equipment', 'infrastructure', 'consumable', 'kit',
  'instrument', 'other',
]);
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
  // 25 Apr 2026: optional FK to equipment_inventory + is_rental flag.
  inventory_item_id?: string;
  is_rental?: boolean;
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

    // 26 Apr 2026 audit fix (P1-3): cross-hospital inventory pollution.
    // If the modal sent an inventory_item_id, verify it belongs to the same
    // hospital as the case. Otherwise a multi-hospital user could attach
    // EHRC inventory to an EHIN case, polluting downstream reporting.
    if (body.inventory_item_id) {
      if (!UUID_RE.test(body.inventory_item_id)) {
        return NextResponse.json(
          { success: false, error: 'Invalid inventory_item_id' },
          { status: 400 }
        );
      }
      const item = await queryOne<{ id: string; hospital_id: string; is_active: boolean }>(
        `SELECT id, hospital_id, is_active FROM equipment_inventory WHERE id = $1`,
        [body.inventory_item_id]
      );
      if (!item) {
        return NextResponse.json(
          { success: false, error: 'Inventory item not found' },
          { status: 404 }
        );
      }
      if (!item.is_active) {
        return NextResponse.json(
          { success: false, error: 'Inventory item is inactive' },
          { status: 400 }
        );
      }
      if (item.hospital_id !== c.hospital_id) {
        return NextResponse.json(
          { success: false, error: 'Inventory item belongs to a different hospital than this case' },
          { status: 400 }
        );
      }
    }

    const row = await queryOne<{ id: string; created_at: string }>(
      `
      INSERT INTO equipment_requests
        (case_id, item_type, item_label, quantity, status, vendor_name, vendor_phone, eta, notes, auto_verified, inventory_item_id, is_rental)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10::UUID, $11::BOOLEAN)
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
        body.inventory_item_id ?? null,
        !!body.is_rental,
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
