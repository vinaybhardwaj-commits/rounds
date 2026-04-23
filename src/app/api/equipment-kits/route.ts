// ============================================
// GET /api/equipment-kits
//
// Lists active equipment_kits filtered by the caller's accessible hospitals
// (via user_accessible_hospital_ids). Powers the OT Calendar scheduler's
// "attach kit" picker + the Day 9 Equipment Kanban.
//
// Query params:
//   hospital_slug  — restrict further to a specific hospital
//
// Sprint 2 Day 8 (24 April 2026). Not flag-gated: read-only + no case_model
// linkage — fine to list kits even if the case surface is off.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface KitRow {
  id: string;
  hospital_id: string;
  hospital_slug: string;
  code: string;
  label: string;
  description: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hospitalSlugFilter = searchParams.get('hospital_slug');

    const whereClauses: string[] = [
      `ek.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))`,
      `ek.is_active = true`,
    ];
    const params: unknown[] = [user.profileId];

    if (hospitalSlugFilter) {
      params.push(hospitalSlugFilter);
      whereClauses.push(`h.slug = $${params.length}`);
    }

    const rows = await query<KitRow>(
      `
      SELECT
        ek.id,
        ek.hospital_id,
        h.slug AS hospital_slug,
        ek.code,
        ek.label,
        ek.description
      FROM equipment_kits ek
      JOIN hospitals h ON h.id = ek.hospital_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY h.slug, ek.label
      `,
      params
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('GET /api/equipment-kits error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list equipment kits' },
      { status: 500 }
    );
  }
}
