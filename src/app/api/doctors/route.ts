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
  name: string | null;
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

    const rows = await query<DoctorRow>(
      `
      SELECT
        p.id,
        p.name,
        p.email,
        p.role,
        p.primary_hospital_id,
        h.slug AS primary_hospital_slug
      FROM profiles p
      LEFT JOIN hospitals h ON h.id = p.primary_hospital_id
      WHERE p.role = ANY($1::text[])
      ORDER BY p.name NULLS LAST, p.email
      `,
      [DOCTOR_ROLE_PATTERNS]
    );

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name || r.email || 'Unknown',
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
