// ============================================
// GET /api/equipment-requests
//
// Cross-case equipment view for Arul's Kanban. Lists equipment_requests rows
// joined to their case + hospital + patient, filtered by the caller's
// accessible hospitals. Supports status filter for kanban column queries
// and hospital_slug filter.
//
// Query params:
//   status         — one of requested|vendor_confirmed|in_transit|delivered|verified_ready
//   hospital_slug  — restrict further to a single hospital
//   case_id        — UUID of a specific case (used by drawer Track 3 if ever needed)
//   limit          — default 200, max 1000
//
// Sprint 2 Day 9 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';

const VALID_STATUSES = new Set(['requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready']);

interface Row {
  id: string;
  case_id: string | null;
  hospital_id: string;
  hospital_slug: string;
  patient_name: string | null;
  planned_surgery_date: string | null;
  ot_room: number | null;
  case_state: string | null;
  item_type: string;
  item_label: string;
  quantity: number;
  status: string;
  vendor_name: string | null;
  vendor_phone: string | null;
  eta: string | null;
  notes: string | null;
  kit_id: string | null;
  auto_verified: boolean;
  is_rental: boolean;
  rental_description: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        feature_enabled: false,
        message: 'FEATURE_CASE_MODEL_ENABLED is off',
      });
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');
    const hospitalSlugFilter = searchParams.get('hospital_slug');
    const caseIdFilter = searchParams.get('case_id');
    const rawLimit = parseInt(searchParams.get('limit') || '200', 10);
    const limit = Math.max(1, Math.min(1000, isNaN(rawLimit) ? 200 : rawLimit));

    if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
      return NextResponse.json(
        { success: false, error: `Invalid status: ${statusFilter}` },
        { status: 400 }
      );
    }

    // 26 Apr 2026 follow-up F1: kanban now lists null-case requests too.
    // Tenancy now uses the denormalized er.hospital_id added in
    // migration-equipment-case-optional.sql.
    const where: string[] = [`er.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))`];
    const params: unknown[] = [user.profileId];

    if (statusFilter) {
      params.push(statusFilter);
      where.push(`er.status = $${params.length}`);
    }
    if (hospitalSlugFilter) {
      params.push(hospitalSlugFilter);
      where.push(`h.slug = $${params.length}`);
    }
    if (caseIdFilter) {
      params.push(caseIdFilter);
      where.push(`er.case_id = $${params.length}::UUID`);
    }
    params.push(limit);

    const rows = await query<Row>(
      `
      SELECT
        er.id, er.case_id,
        er.hospital_id,
        h.slug AS hospital_slug,
        pt.patient_name,
        sc.planned_surgery_date,
        sc.ot_room,
        sc.state AS case_state,
        er.item_type, er.item_label, er.quantity, er.status,
        er.vendor_name, er.vendor_phone, er.eta, er.notes,
        er.kit_id, er.auto_verified,
        er.is_rental, er.rental_description,
        er.created_at, er.updated_at
      FROM equipment_requests er
      JOIN hospitals h ON h.id = er.hospital_id
      LEFT JOIN surgical_cases sc ON sc.id = er.case_id
      LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE er.status
          WHEN 'requested'        THEN 1
          WHEN 'vendor_confirmed' THEN 2
          WHEN 'in_transit'       THEN 3
          WHEN 'delivered'        THEN 4
          WHEN 'verified_ready'   THEN 5
          ELSE 9
        END,
        sc.planned_surgery_date NULLS LAST,
        er.created_at ASC
      LIMIT $${params.length}
      `,
      params
    );

    return NextResponse.json({
      success: true,
      data: rows,
      count: rows.length,
      feature_enabled: true,
    });
  } catch (error) {
    console.error('GET /api/equipment-requests error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list equipment requests' },
      { status: 500 }
    );
  }
}

// 26 Apr 2026 audit follow-up: POST handler additions for case-optional path.
// 26 Apr 2026 follow-up F3: V added nurses, anaesthetists, consultants and
// surgeons to the create gate. 'charge_nurse', 'consultant', 'surgeon' are
// not yet in UserRole enum — they remain here as a forward-compatibility
// marker.
const CREATE_ROLES = new Set([
  'biomedical_engineer', // legacy — not yet in UserRole enum
  'ot_coordinator',
  'nurse',
  'charge_nurse', // not yet in UserRole enum
  'anesthesiologist',
  'consultant',   // not yet in UserRole enum
  'surgeon',      // not yet in UserRole enum
]);
const VALID_ITEM_TYPES = new Set([
  'specialty', 'rental', 'implant', 'blood', 'imaging',
  'surgical_equipment', 'infrastructure', 'consumable', 'kit',
  'instrument', 'other',
]);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface CreateBody {
  case_id?: string | null;
  hospital_id?: string;
  item_type?: string;
  item_label?: string;
  quantity?: number;
  vendor_name?: string;
  vendor_phone?: string;
  eta?: string;
  notes?: string;
  status?: string;
  inventory_item_id?: string | null;
  is_rental?: boolean;
  rental_description?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    if (!hasRole(user.role, CREATE_ROLES)) {
      return NextResponse.json(
        { success: false, error: `Role ${user.role} cannot create equipment requests. Required: ${[...CREATE_ROLES].join(', ')} or super_admin.` },
        { status: 403 }
      );
    }

    const body = (await request.json()) as CreateBody;

    // hospital_id is required (denormalized).
    if (!body.hospital_id || !UUID_RE.test(body.hospital_id)) {
      return NextResponse.json(
        { success: false, error: 'hospital_id is required' },
        { status: 400 }
      );
    }

    // Tenancy: caller must have access to the supplied hospital_id.
    const hospitalAccessible = await queryOne<{ id: string }>(
      `SELECT id FROM hospitals
        WHERE id = $1
          AND id = ANY(user_accessible_hospital_ids($2::UUID))
        LIMIT 1`,
      [body.hospital_id, user.profileId]
    );
    if (!hospitalAccessible) {
      return NextResponse.json(
        { success: false, error: 'Hospital not found or not accessible' },
        { status: 404 }
      );
    }

    // Optional case_id — when present, validate tenancy + hospital match.
    let caseId: string | null = null;
    if (body.case_id) {
      if (!UUID_RE.test(body.case_id)) {
        return NextResponse.json({ success: false, error: 'Invalid case_id' }, { status: 400 });
      }
      const c = await queryOne<{ id: string; hospital_id: string }>(
        `SELECT sc.id, sc.hospital_id
           FROM surgical_cases sc
          WHERE sc.id = $1
            AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
        [body.case_id, user.profileId]
      );
      if (!c) {
        return NextResponse.json(
          { success: false, error: 'Case not found or access denied' },
          { status: 404 }
        );
      }
      if (c.hospital_id !== body.hospital_id) {
        return NextResponse.json(
          { success: false, error: 'Case belongs to a different hospital than supplied hospital_id' },
          { status: 400 }
        );
      }
      caseId = c.id;
    }

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

    // Inventory cross-hospital validation (P1-3).
    if (body.inventory_item_id) {
      if (!UUID_RE.test(body.inventory_item_id)) {
        return NextResponse.json({ success: false, error: 'Invalid inventory_item_id' }, { status: 400 });
      }
      const item = await queryOne<{ id: string; hospital_id: string; is_active: boolean }>(
        `SELECT id, hospital_id, is_active FROM equipment_inventory WHERE id = $1`,
        [body.inventory_item_id]
      );
      if (!item) {
        return NextResponse.json({ success: false, error: 'Inventory item not found' }, { status: 404 });
      }
      if (!item.is_active) {
        return NextResponse.json({ success: false, error: 'Inventory item is inactive' }, { status: 400 });
      }
      if (item.hospital_id !== body.hospital_id) {
        return NextResponse.json(
          { success: false, error: 'Inventory item belongs to a different hospital' },
          { status: 400 }
        );
      }
    }

    // Rental sanity: require a description when is_rental is true. Avoids
    // saving rental requests with no clue what's being rented.
    const isRental = !!body.is_rental;
    let rentalDescription: string | null = null;
    if (isRental) {
      const rd = typeof body.rental_description === 'string' ? body.rental_description.trim() : '';
      if (!rd || rd.length > 500) {
        return NextResponse.json(
          { success: false, error: 'rental_description required when is_rental is true (max 500 chars)' },
          { status: 400 }
        );
      }
      rentalDescription = rd;
    }

    const row = await queryOne<{ id: string; created_at: string }>(
      `
      INSERT INTO equipment_requests
        (hospital_id, case_id, item_type, item_label, quantity, status,
         vendor_name, vendor_phone, eta, notes, auto_verified,
         inventory_item_id, is_rental, rental_description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false,
              $11::UUID, $12::BOOLEAN, $13)
      RETURNING id, created_at
      `,
      [
        body.hospital_id,
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
        isRental,
        rentalDescription,
      ]
    );

    return NextResponse.json({
      success: true,
      data: {
        id: row?.id ?? null,
        created_at: row?.created_at ?? null,
        case_attached: !!caseId,
      },
    });
  } catch (error) {
    console.error('POST /api/equipment-requests error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create equipment request' },
      { status: 500 }
    );
  }
}
