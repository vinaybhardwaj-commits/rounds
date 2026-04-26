// =============================================================================
// GET /api/patients/searchable  (CT.6 — Chat Tasks PRD v1.4 §4.2)
//
// Generic patient typeahead for the CreateTaskModal patient picker. Broader
// than /api/patients/searchable-for-pac (no PAC-stage filter) — returns any
// active patient in the caller's accessible hospitals. Search by
// patient_name / uhid / phone / whatsapp_number.
//
// Query params:
//   q     — search string (≥ 2 chars). Empty / short returns [].
//   limit — default 8, max 25.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { withApiTelemetry } from '@/lib/api-telemetry';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface Row {
  id: string;
  patient_name: string | null;
  uhid: string | null;
  current_stage: string;
  hospital_id: string;
  hospital_slug: string | null;
  phone: string | null;
}

async function GET_inner(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const limitRaw = parseInt(searchParams.get('limit') || '8', 10);
    const limit = Math.max(1, Math.min(25, isNaN(limitRaw) ? 8 : limitRaw));

    if (q.length < 2) {
      return NextResponse.json({ success: true, data: [], count: 0 });
    }

    const like = `%${q}%`;

    const rows = await query<Row>(
      `SELECT pt.id, pt.patient_name, pt.uhid, pt.current_stage,
              pt.hospital_id, h.slug AS hospital_slug, pt.phone
         FROM patient_threads pt
         LEFT JOIN hospitals h ON h.id = pt.hospital_id
        WHERE pt.archived_at IS NULL
          AND pt.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))
          AND (pt.patient_name    ILIKE $2
            OR pt.uhid            ILIKE $2
            OR pt.phone           ILIKE $2
            OR pt.whatsapp_number ILIKE $2)
        ORDER BY
          -- exact UHID match first, then name-prefix, then rest
          CASE WHEN pt.uhid ILIKE $3 THEN 0
               WHEN pt.patient_name ILIKE $3 THEN 1
               ELSE 2 END,
          pt.patient_name NULLS LAST
        LIMIT $4`,
      [user.profileId, like, `${q}%`, limit]
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('GET /api/patients/searchable error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search patients' },
      { status: 500 }
    );
  }
}

// AP.3 — telemetry-wrapped exports (auto-applied)
export const GET = withApiTelemetry('/api/patients/searchable', GET_inner);
