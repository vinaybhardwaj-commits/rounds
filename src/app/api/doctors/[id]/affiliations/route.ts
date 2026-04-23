// ============================================
// GET /api/doctors/[id]/affiliations
//
// Returns all hospital affiliations for a doctor profile. The Marketing
// Handoff form's Picker B uses this when the user selects an
// admitting_doctor_id — the primary affiliation's hospital_slug auto-fills
// the target_hospital dropdown.
//
// Response: { success, data: [{ hospital_id, hospital_slug, hospital_name, is_primary, created_at }], primary_hospital_slug? }
//
// Auth: any authenticated user.
//
// Sprint 1 Day 4 (23 April 2026).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface AffiliationRow {
  hospital_id: string;
  hospital_slug: string;
  hospital_name: string;
  is_primary: boolean;
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;

    const rows = await query<AffiliationRow>(
      `
      SELECT
        dha.hospital_id,
        h.slug  AS hospital_slug,
        h.name  AS hospital_name,
        dha.is_primary,
        dha.created_at
      FROM doctor_hospital_affiliations dha
      JOIN hospitals h ON h.id = dha.hospital_id
      WHERE dha.profile_id = $1
      ORDER BY dha.is_primary DESC, h.name
      `,
      [id]
    );

    const primary = rows.find((r) => r.is_primary);

    return NextResponse.json({
      success: true,
      data: rows,
      count: rows.length,
      primary_hospital_slug: primary?.hospital_slug ?? null,
    });
  } catch (error) {
    console.error('GET /api/doctors/[id]/affiliations error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list affiliations' },
      { status: 500 }
    );
  }
}
