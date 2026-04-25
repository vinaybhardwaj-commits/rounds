// =============================================================================
// GET /api/patients/searchable-for-pac
//
// Typeahead source for the Anaesthetist Queue page (V's 26 Apr 2026 ask).
// Returns active patients eligible to be pulled into PAC scheduling — the
// anaesthetist can search by name / UHID / phone / whatsapp and pick a
// patient even if no IPD coordinator has assigned them yet.
//
// Eligibility:
//   - patient_threads.archived_at IS NULL
//   - hospital_id ∈ user_accessible_hospital_ids(caller)
//   - latest active surgical_case state IS NULL (no case) or
//     ∈ {'draft', 'intake'}.  Excludes patients already pac_scheduled / done /
//     fit / etc — V said "not already assigned for PAC or who has not already
//     had a PAC on this admission".
//
// Search fields: patient_name, uhid, phone, whatsapp_number (case-insensitive).
//
// Query params:
//   q      — search string. ≥ 2 chars to actually run; shorter returns [].
//   limit  — default 8, max 25.
//
// Response:
//   { success: true, data: [{ id, patient_name, uhid, current_stage,
//                              hospital_slug, phone, case_id|null, case_state|null }] }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface Row {
  id: string;
  patient_name: string | null;
  uhid: string | null;
  current_stage: string;
  hospital_slug: string | null;
  phone: string | null;
  case_id: string | null;
  case_state: string | null;
}

const ELIGIBLE_CASE_STATES = ['draft', 'intake'];

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const limitRaw = parseInt(searchParams.get('limit') || '8', 10);
    const limit = Math.max(1, Math.min(25, isNaN(limitRaw) ? 8 : limitRaw));

    // Reject short queries — every keystroke up to 2 chars would otherwise
    // pull half the table. Empty list is the right UX.
    if (q.length < 2) {
      return NextResponse.json({ success: true, data: [], count: 0 });
    }

    const like = `%${q}%`;

    const rows = await query<Row>(
      `
      WITH latest_case AS (
        SELECT DISTINCT ON (patient_thread_id)
               patient_thread_id, id AS case_id, state AS case_state
          FROM surgical_cases
         WHERE archived_at IS NULL
         ORDER BY patient_thread_id, created_at DESC
      )
      SELECT pt.id,
             pt.patient_name,
             pt.uhid,
             pt.current_stage,
             h.slug AS hospital_slug,
             pt.phone,
             lc.case_id,
             lc.case_state
        FROM patient_threads pt
        LEFT JOIN hospitals h ON h.id = pt.hospital_id
        LEFT JOIN latest_case lc ON lc.patient_thread_id = pt.id
       WHERE pt.archived_at IS NULL
         AND pt.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))
         AND (lc.case_state IS NULL OR lc.case_state = ANY($2::text[]))
         AND (
              pt.patient_name      ILIKE $3
           OR pt.uhid              ILIKE $3
           OR pt.phone             ILIKE $3
           OR pt.whatsapp_number   ILIKE $3
         )
       ORDER BY
         -- Exact UHID matches first, then name-prefix matches, then everything else.
         CASE WHEN pt.uhid ILIKE $4 THEN 0
              WHEN pt.patient_name ILIKE $4 THEN 1
              ELSE 2 END,
         pt.patient_name NULLS LAST
       LIMIT $5
      `,
      [user.profileId, ELIGIBLE_CASE_STATES, like, `${q}%`, limit]
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('GET /api/patients/searchable-for-pac error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search patients' },
      { status: 500 }
    );
  }
}
