// ============================================
// GET /api/admin/hospitals
// PATCH /api/admin/hospitals
//
// Admin surface for the hospitals registry. Currently used to flip
// is_active when EHBR or EHIN goes live (Sprints 4 + 5 per PRD §9).
//
// GET response: list of hospitals with member counts, channel counts,
// active surgical_cases counts — gives super_admin a one-glance overview.
//
// PATCH body:
//   { id: uuid, is_active: boolean }
//
// Access: super_admin only. Tenancy doesn't apply — the registry is
// global. Hospital-bound users have no business here.
//
// Sprint 3 Day 15 (24 April 2026).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface HospitalDetail {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  is_active: boolean;
  ot_room_count: number | null;
  primary_profile_count: number;
  department_count: number;
  active_case_count: number;
  created_at: string;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'super_admin required' }, { status: 403 });
    }

    const rows = await query<HospitalDetail>(
      `
      SELECT
        h.id, h.slug, h.name, h.display_name, h.is_active, h.ot_room_count,
        (SELECT COUNT(*)::int FROM profiles p WHERE p.primary_hospital_id = h.id) AS primary_profile_count,
        (SELECT COUNT(*)::int FROM departments d WHERE d.hospital_id = h.id) AS department_count,
        (SELECT COUNT(*)::int FROM surgical_cases sc
           WHERE sc.hospital_id = h.id
             AND sc.state NOT IN ('completed','cancelled','postponed')
             AND sc.archived_at IS NULL
        ) AS active_case_count,
        h.created_at
      FROM hospitals h
      ORDER BY h.is_active DESC, h.slug ASC
      `,
      []
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('GET /api/admin/hospitals error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load hospitals', detail: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'super_admin required' }, { status: 403 });
    }

    const body = (await request.json()) as { id?: string; is_active?: boolean };
    if (!body.id || !UUID_RE.test(body.id)) {
      return NextResponse.json({ success: false, error: 'id (UUID) required' }, { status: 400 });
    }
    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json({ success: false, error: 'is_active (boolean) required' }, { status: 400 });
    }

    // Safety: don't deactivate a hospital with active cases. Force the user
    // to either complete/cancel them first, or override (Sprint 3.5 might
    // add a force flag).
    if (body.is_active === false) {
      const r = await query<{ n: number }>(
        `
        SELECT COUNT(*)::int AS n FROM surgical_cases sc
        WHERE sc.hospital_id = $1
          AND sc.state NOT IN ('completed','cancelled','postponed')
          AND sc.archived_at IS NULL
        `,
        [body.id]
      );
      const activeCount = r[0]?.n ?? 0;
      if (activeCount > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot deactivate: hospital has ${activeCount} active surgical case(s). Resolve them first.`,
            active_case_count: activeCount,
          },
          { status: 409 }
        );
      }
    }

    await query(
      `UPDATE hospitals SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [body.is_active, body.id]
    );

    return NextResponse.json({
      success: true,
      data: { id: body.id, is_active: body.is_active },
    });
  } catch (error) {
    console.error('PATCH /api/admin/hospitals error:', error);
    return NextResponse.json(
      { success: false, error: 'Update failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
