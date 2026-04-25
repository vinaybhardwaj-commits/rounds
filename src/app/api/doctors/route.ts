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
// 26 Apr 2026 audit fix (P1-6): single source of truth for surgical specialties.
import { SURGICAL_SPECIALTIES } from '@/lib/clinical-specialties';

const DOCTOR_ROLE_PATTERNS = [
  'doctor',
  'consultant',
  'specialist',
  'resident',
  'senior_resident',
  'anaesthesiologist',  // matches reference_doctors.association only
  'anesthesiologist',   // matches profiles.role (canonical US spelling)
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
  specialty: string | null;
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
    // 26 Apr 2026 audit fix (P1-2): server-side hospital tenancy gate.
    // Doctors with NULL primary_hospital_id remain visible (legacy data /
    // floating consultants) — UI-side filter handles patient-level scoping.
    // 26 Apr 2026 audit fix (P1-4): dedup UNION ALL by case-insensitive
    // full_name — when a doctor exists in BOTH profiles (app user) and
    // reference_doctors (HR roster), prefer the profiles row (richer data:
    // email, can sign in). The reference_doctors entry is suppressed.
    const rows = await query<DoctorRow>(
      `
      WITH
        profiles_doctors AS (
          SELECT
            p.id,
            p.full_name,
            p.email,
            p.role,
            p.primary_hospital_id,
            h.slug AS primary_hospital_slug,
            NULL::text AS specialty
          FROM profiles p
          LEFT JOIN hospitals h ON h.id = p.primary_hospital_id
          WHERE p.role = ANY($2::text[])
            AND (
              p.primary_hospital_id IS NULL
              OR p.primary_hospital_id = ANY(user_accessible_hospital_ids($1::UUID))
            )
        ),
        ref_doctors AS (
          SELECT
            rd.id,
            rd.full_name,
            NULL::text AS email,
            COALESCE(rd.association, 'consultant') AS role,
            rd.primary_hospital_id,
            h2.slug AS primary_hospital_slug,
            rd.specialty
          FROM reference_doctors rd
          LEFT JOIN hospitals h2 ON h2.id = rd.primary_hospital_id
          WHERE rd.is_active = TRUE
            AND (
              rd.primary_hospital_id IS NULL
              OR rd.primary_hospital_id = ANY(user_accessible_hospital_ids($1::UUID))
            )
        )
      SELECT id, full_name, email, role, primary_hospital_id, primary_hospital_slug, specialty
        FROM profiles_doctors
      UNION ALL
      SELECT id, full_name, email, role, primary_hospital_id, primary_hospital_slug, specialty
        FROM ref_doctors
        WHERE LOWER(TRIM(COALESCE(full_name, ''))) NOT IN (
          SELECT LOWER(TRIM(COALESCE(full_name, ''))) FROM profiles_doctors WHERE full_name IS NOT NULL
        )
      ORDER BY full_name NULLS LAST
      `,
      [user.profileId, DOCTOR_ROLE_PATTERNS]
    );

    // 26 Apr 2026 audit fix (P1-6): SURGICAL_SPECIALTIES imported from
    // @/lib/clinical-specialties — single source of truth across the app.
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.full_name || r.email || 'Unknown',
        email: r.email,
        role: r.role,
        primary_hospital_id: r.primary_hospital_id,
        primary_hospital_slug: r.primary_hospital_slug,
        specialty: r.specialty,
        is_surgical: r.specialty ? SURGICAL_SPECIALTIES.has(r.specialty) : false,
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
