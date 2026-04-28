// =============================================================================
// GET /api/ot-management/today?hospital={slug}
//
// OT Management Module v1 — single fat aggregation endpoint (PRD D7).
// Returns { hospital, slate, booking_inbox, pac_queue, equipment, kpis,
// notes, generated_at } for the OT Coordinator's shift view.
//
// OT.2 ships `slate`, `booking_inbox`, `pac_queue` fully populated.
// `equipment`, `kpis`, `notes` ship as empty arrays/null in OT.2 — OT.3 wires
// them.
//
// Auth: any signed-in user (Glass mode, PRD D2). Hospital scoping enforced
// via user_accessible_hospital_ids(); 403 if user lacks access to the
// requested hospital.
//
// Default hospital: ?hospital= omitted → falls back to user's
// primary_hospital_slug from profiles.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface SlateRow {
  case_id: string;
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  pt_current_stage: string;
  case_state: string;
  urgency: string | null;
  planned_procedure: string | null;
  planned_start_time: string | null;
  ot_room: number | null;
  case_serial_in_slot: number | null;
  surgeon_name: string | null;
  assist_surgeon_name: string | null;
  anaesthetist_name: string | null;
  anae_type: string | null;
  equipment_status: string | null;
  consumables_status: string | null;
  ot_remarks: string | null;
}

interface InboxRow {
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  case_id: string;
  case_state: string;
  urgency: string | null;
  pac_cleared_at: string | null;
  primary_consultant_name: string | null;
  target_department: string | null;
  planned_procedure: string | null;
}

interface PacQueueRow {
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  case_id: string;
  case_state: string;
  urgency: string | null;
  pac_outcome: string | null;
  pac_published_at: string | null;
  primary_consultant_name: string | null;
  target_department: string | null;
}

interface HospitalLite {
  id: string;
  slug: string;
  name: string;
  ot_room_count: number;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const slugFromQuery = (searchParams.get('hospital') || '').trim().toLowerCase();

    // Resolve target hospital. If no slug, fall back to user's primary.
    let targetSlug = slugFromQuery;
    if (!targetSlug) {
      const me = await queryOne<{ slug: string | null }>(
        `SELECT h.slug
           FROM profiles p
           LEFT JOIN hospitals h ON h.id = p.primary_hospital_id
          WHERE p.id = $1::uuid`,
        [user.profileId]
      );
      targetSlug = me?.slug || 'ehrc';
    }

    const hospital = await queryOne<HospitalLite>(
      `SELECT id::text AS id, slug, name, COALESCE(ot_room_count, 3) AS ot_room_count
         FROM hospitals
        WHERE slug = $1
        LIMIT 1`,
      [targetSlug]
    );
    if (!hospital) {
      return NextResponse.json(
        { success: false, error: `Hospital '${targetSlug}' not found` },
        { status: 404 }
      );
    }

    // Confirm user can read this hospital's data.
    const access = await queryOne<{ allowed: boolean }>(
      `SELECT $1::uuid = ANY(user_accessible_hospital_ids($2::uuid)) AS allowed`,
      [hospital.id, user.profileId]
    );
    if (!access?.allowed) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: hospital not accessible' },
        { status: 403 }
      );
    }

    // ── 1. Today's slate ────────────────────────────────────────────────────
    // Bookings on the OT grid for CURRENT_DATE (in server tz). Excludes
    // terminal states so completed/cancelled cases don't crowd today's view.
    const slate = await query<SlateRow>(
      `SELECT sc.id AS case_id,
              sc.patient_thread_id,
              pt.patient_name,
              pt.uhid,
              pt.age,
              pt.gender,
              pt.current_stage AS pt_current_stage,
              sc.state AS case_state,
              sc.urgency,
              sc.planned_procedure,
              sc.planned_start_time::text AS planned_start_time,
              sc.ot_room,
              sc.case_serial_in_slot,
              sc.surgeon_name,
              sc.assist_surgeon_name,
              sc.anaesthetist_name,
              sc.anae_type,
              sc.equipment_status,
              sc.consumables_status,
              sc.ot_remarks
         FROM surgical_cases sc
         JOIN patient_threads pt ON pt.id = sc.patient_thread_id
        WHERE sc.hospital_id = $1::uuid
          AND sc.planned_surgery_date = CURRENT_DATE
          AND sc.archived_at IS NULL
          AND sc.state NOT IN ('cancelled','postponed','completed')
        ORDER BY sc.planned_start_time NULLS LAST,
                 sc.ot_room NULLS LAST,
                 sc.case_serial_in_slot NULLS LAST`,
      [hospital.id]
    );

    // ── 2. Booking inbox (PAC-cleared, no slot yet) ─────────────────────────
    // PRD Q4: urgency DESC (emergency first) → pac_cleared_at ASC (oldest first).
    // Cases in 'fit' or 'fit_conds' state are PAC done but not yet booked.
    const inbox = await query<InboxRow>(
      `WITH latest_case AS (
         SELECT DISTINCT ON (patient_thread_id)
                patient_thread_id, id AS case_id, state AS case_state,
                urgency, planned_procedure, hospital_id, created_at
           FROM surgical_cases
          WHERE archived_at IS NULL
          ORDER BY patient_thread_id, created_at DESC
       ),
       latest_pac AS (
         SELECT DISTINCT ON (case_id)
                case_id, published_at
           FROM pac_events
          ORDER BY case_id, published_at DESC
       )
       SELECT pt.id::text AS patient_thread_id,
              pt.patient_name,
              pt.uhid,
              pt.age,
              pt.gender,
              lc.case_id::text AS case_id,
              lc.case_state,
              lc.urgency,
              lp.published_at::text AS pac_cleared_at,
              pt.primary_consultant_name,
              pt.target_department,
              lc.planned_procedure
         FROM patient_threads pt
         JOIN latest_case lc ON lc.patient_thread_id = pt.id
         LEFT JOIN latest_pac lp ON lp.case_id = lc.case_id
        WHERE pt.archived_at IS NULL
          AND lc.hospital_id = $1::uuid
          AND lc.case_state IN ('fit','fit_conds')
        ORDER BY
          CASE lc.urgency
            WHEN 'emergency' THEN 0
            WHEN 'urgent' THEN 1
            ELSE 2
          END,
          lp.published_at ASC NULLS LAST,
          pt.patient_name NULLS LAST
        LIMIT 100`,
      [hospital.id]
    );

    // ── 3. PAC queue (5 states: fit_conds, optimizing, pac_scheduled,
    //      defer, unfit) ────────────────────────────────────────────────────
    // OT.0 recon: PRD D10 said 4 states using PRD-informal naming; real schema
    // adds `defer` (PAC outcome requiring rescheduling). 5 states total.
    // PRD Q2: flat list, state-grouped — UI sorts by state priority then
    // recency.
    const pacQueue = await query<PacQueueRow>(
      `WITH latest_case AS (
         SELECT DISTINCT ON (patient_thread_id)
                patient_thread_id, id AS case_id, state AS case_state,
                urgency, hospital_id, created_at
           FROM surgical_cases
          WHERE archived_at IS NULL
          ORDER BY patient_thread_id, created_at DESC
       ),
       latest_pac AS (
         SELECT DISTINCT ON (case_id)
                case_id, published_at, outcome
           FROM pac_events
          ORDER BY case_id, published_at DESC
       )
       SELECT pt.id::text AS patient_thread_id,
              pt.patient_name,
              pt.uhid,
              pt.age,
              pt.gender,
              lc.case_id::text AS case_id,
              lc.case_state,
              lc.urgency,
              lp.outcome AS pac_outcome,
              lp.published_at::text AS pac_published_at,
              pt.primary_consultant_name,
              pt.target_department
         FROM patient_threads pt
         JOIN latest_case lc ON lc.patient_thread_id = pt.id
         LEFT JOIN latest_pac lp ON lp.case_id = lc.case_id
        WHERE pt.archived_at IS NULL
          AND lc.hospital_id = $1::uuid
          AND lc.case_state IN ('fit_conds','optimizing','pac_scheduled','defer','unfit')
        ORDER BY
          CASE lc.case_state
            WHEN 'fit_conds' THEN 0
            WHEN 'optimizing' THEN 1
            WHEN 'pac_scheduled' THEN 2
            WHEN 'defer' THEN 3
            WHEN 'unfit' THEN 4
            ELSE 5
          END,
          lp.published_at DESC NULLS LAST,
          pt.patient_name NULLS LAST
        LIMIT 200`,
      [hospital.id]
    );

    return NextResponse.json({
      success: true,
      data: {
        hospital: {
          id: hospital.id,
          slug: hospital.slug,
          name: hospital.name,
          ot_room_count: hospital.ot_room_count,
        },
        slate,
        booking_inbox: inbox,
        pac_queue: pacQueue,
        // OT.3 will populate these:
        equipment: [],
        kpis: null,
        notes: null,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('GET /api/ot-management/today error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
