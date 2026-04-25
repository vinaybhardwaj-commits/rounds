// =============================================================================
// GET /api/ot-calendar/eligible-patients
//
// Source for the OT Calendar's left-pane patient list (V's 26 Apr 2026 ask:
// "all active patients regardless of state, with state badge").
//
// Returns active patients eligible for OT booking. Excludes patients whose
// LATEST active surgical_case is already in {scheduled, confirmed, verified,
// in_theatre, completed, cancelled, postponed} — those are either already on
// the calendar or terminal.
//
// Query params:
//   q              — search string (≥ 2 chars). Empty / short returns all.
//   focus_id       — UUID of the patient the user entered through. Always
//                    surfaced first when present (regardless of search hits).
//   limit          — default 50, max 200.
//
// Response includes a `pac_status` flag derived from case state so the UI
// can color-code: green if PAC cleared, amber if pending, gray otherwise.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
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
  case_id: string | null;
  case_state: string | null;
  pac_status: string | null;
  primary_consultant_name: string | null;
  target_department: string | null;
}

const ON_CALENDAR_OR_PAST = [
  'scheduled', 'confirmed', 'verified', 'in_theatre',
  'completed', 'cancelled', 'postponed',
];

const PAC_CLEARED_STATES = ['fit', 'fit_conds', 'optimizing'];
const PAC_PENDING_STATES = ['pac_scheduled', 'pac_done', 'defer', 'unfit'];

function deriveBadge(stateOrNull: string | null): string {
  if (!stateOrNull) return 'no_case';
  if (PAC_CLEARED_STATES.includes(stateOrNull)) return 'pac_cleared';
  if (PAC_PENDING_STATES.includes(stateOrNull)) return 'pac_pending';
  return stateOrNull;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const focusId = (searchParams.get('focus_id') || '').trim();
    const limitRaw = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.max(1, Math.min(200, isNaN(limitRaw) ? 50 : limitRaw));

    // We want to ALWAYS include the focus patient (entered-through patient)
    // even if they fall outside the search filter. Done via a UNION below.
    const useSearch = q.length >= 2;
    const like = `%${q}%`;

    const sql = `
      WITH latest_case AS (
        SELECT DISTINCT ON (patient_thread_id)
               patient_thread_id, id AS case_id, state AS case_state
          FROM surgical_cases
         WHERE archived_at IS NULL
         ORDER BY patient_thread_id, created_at DESC
      ),
      base AS (
        SELECT pt.id,
               pt.patient_name,
               pt.uhid,
               pt.current_stage,
               pt.hospital_id,
               h.slug AS hospital_slug,
               pt.phone,
               pt.primary_consultant_name,
               pt.target_department,
               lc.case_id,
               lc.case_state,
               -- Sort key: 0 if focus, 1 otherwise — keeps focus at the top.
               CASE WHEN pt.id::text = $4 THEN 0 ELSE 1 END AS sort_focus
          FROM patient_threads pt
          LEFT JOIN hospitals h    ON h.id = pt.hospital_id
          LEFT JOIN latest_case lc ON lc.patient_thread_id = pt.id
         WHERE pt.archived_at IS NULL
           AND pt.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))
           AND (lc.case_state IS NULL OR NOT (lc.case_state = ANY($2::text[])))
           AND (
                $3::text IS NULL
             OR pt.id::text = $4
             OR pt.patient_name      ILIKE $3
             OR pt.uhid              ILIKE $3
             OR pt.phone             ILIKE $3
             OR pt.whatsapp_number   ILIKE $3
           )
      )
      SELECT * FROM base
      ORDER BY sort_focus,
               -- exact UHID first, then name-prefix
               CASE WHEN $3::text IS NOT NULL AND uhid ILIKE $5 THEN 0
                    WHEN $3::text IS NOT NULL AND patient_name ILIKE $5 THEN 1
                    ELSE 2 END,
               patient_name NULLS LAST
      LIMIT $6
    `;

    const rows = await query<Row & { sort_focus: number }>(
      sql,
      [
        user.profileId,
        ON_CALENDAR_OR_PAST,
        useSearch ? like : null,
        focusId || '',
        useSearch ? `${q}%` : '',
        limit,
      ]
    );

    const data = rows.map((r) => ({
      id: r.id,
      patient_name: r.patient_name,
      uhid: r.uhid,
      current_stage: r.current_stage,
      hospital_id: r.hospital_id,
      hospital_slug: r.hospital_slug,
      phone: r.phone,
      primary_consultant_name: r.primary_consultant_name,
      target_department: r.target_department,
      case_id: r.case_id,
      case_state: r.case_state,
      pac_status: deriveBadge(r.case_state),
      is_focus: r.sort_focus === 0,
    }));

    return NextResponse.json({ success: true, data, count: data.length });
  } catch (error) {
    console.error('GET /api/ot-calendar/eligible-patients error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load eligible patients' },
      { status: 500 }
    );
  }
}
