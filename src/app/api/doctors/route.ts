// ============================================
// GET /api/doctors
//
// Lists profiles whose role is doctor-shaped (used by the Marketing Handoff
// form's admitting_doctor_id picker). Returns id + display name + primary
// hospital slug so the UI can render + filter by hospital.
//
// Auth: any authenticated user.
//
// Sprint 1 Day 4 (23 April 2026).
// Sprint 2 follow-up #27 (24 Apr 2026): fixed 500 caused by selecting
//   p.name — the profiles column is p.full_name (see /api/auth/me). Picker B
//   fell back to free-text field gracefully, but dropdown was always empty.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

const DOCTOR_ROLE_PATTERNS = [
  'doctor',
  'consultant',
  'specialist',
  'resident',
  'senior_resident',
  'anaesthesiologist',
  'anaesthetist',
  'surgeon',
  'rmo',
  'registrar',
];

interface DoctorRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  primary_hospital_id: string | null;
  primary_hospital_slug: string | null;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 24 Apr 2026: picker now unions profiles (app users with
    // doctor-shaped roles) + reference_doctors (external HR roster).
    // Response shape is unchanged; reference_doctors entries have
    // email=NULL and role derived from association (or 'consultant').
    const rows = await query<DoctorRow>(
      `
      SELECT
        p.id,
        p.full_name,
        p.email,
        p.role,
        p.primary_hospital_id,
        h.slug AS primary_hospital_slug
      FROM profiles p
      LEFT JOIN hospitals h ON h.id = p.primary_hospital_id
      WHERE p.role = ANY($1::text[])

      UNION ALL

      SELECT
        rd.id,
        rd.full_name,
        NULL::text AS email,
        COALESCE(rd.association, 'consultant') AS role,
        rd.primary_hospital_id,
        h2.slug AS primary_hospital_slug
      FROM reference_doctors rd
      LEFT JOIN hospitals h2 ON h2.id = rd.primary_hospital_id
      WHERE rd.is_active = true

      ORDER BY full_name NULLS LAST
      `,
      [DOCTOR_ROLE_PATTERNS]
    );

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.full_name || r.email || 'Unknown',
        email: r.email,
        role: r.role,
        primary_hospital_id: r.primary_hospital_id,
        primary_hospital_slug: r.primary_hospital_slug,
      })),
      count: rows.length,
    });
  } catch (error) {
    console.error('GET /api/doctors error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list doctors' },
      { status: 500 }
    );
  }
}
