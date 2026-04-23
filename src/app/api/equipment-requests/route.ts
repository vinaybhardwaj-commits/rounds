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
import { query } from '@/lib/db';

const VALID_STATUSES = new Set(['requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready']);

interface Row {
  id: string;
  case_id: string;
  hospital_slug: string;
  patient_name: string | null;
  planned_surgery_date: string | null;
  ot_room: number | null;
  case_state: string;
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

    const where: string[] = [`sc.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))`];
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
        h.slug AS hospital_slug,
        pt.patient_name,
        sc.planned_surgery_date,
        sc.ot_room,
        sc.state AS case_state,
        er.item_type, er.item_label, er.quantity, er.status,
        er.vendor_name, er.vendor_phone, er.eta, er.notes,
        er.kit_id, er.auto_verified,
        er.created_at, er.updated_at
      FROM equipment_requests er
      JOIN surgical_cases sc ON sc.id = er.case_id
      JOIN hospitals h ON h.id = sc.hospital_id
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
