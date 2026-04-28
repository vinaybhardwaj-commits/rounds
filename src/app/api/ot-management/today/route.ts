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

interface EquipmentRow {
  request_id: string;
  case_id: string;
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  planned_surgery_date: string | null;
  planned_start_time: string | null;
  ot_room: number | null;
  surgeon_name: string | null;
  item_type: string;
  item_label: string;
  quantity: number;
  status: string;
  vendor_name: string | null;
  eta: string | null;
  notes: string | null;
  bucket: 'today' | 'tomorrow' | 'blocked';
}

interface KpiPayload {
  utilization_pct: number | null;
  utilization_basis: string;
  on_time_first_case_pct: number | null;
  on_time_first_case_basis: string;
  equipment_blocked_cancellations_7d: number;
  avg_pac_to_ot_days: number | null;
  avg_pac_to_ot_basis: string;
  asof: string;
}

interface NotesPayload {
  body: string;
  updated_by_name: string | null;
  updated_at: string | null;
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
              COALESCE(sp.full_name, '') AS surgeon_name,
              sc.assist_surgeon_name,
              sc.anaesthetist_name,
              sc.anae_type,
              sc.equipment_status,
              sc.consumables_status,
              sc.ot_remarks
         FROM surgical_cases sc
         JOIN patient_threads pt ON pt.id = sc.patient_thread_id
         LEFT JOIN profiles sp ON sp.id = sc.surgeon_id
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

    // ── 4. Equipment (today + tomorrow + currently-blocked) ────────────────
    // OT.0 recon: equipment_requests has no hospital_id; JOIN through
    // surgical_cases.hospital_id. "Currently-blocked" = status not yet
    // verified_ready AND eta has passed. Bucket each row for the UI.
    const equipment = await query<EquipmentRow>(
      `SELECT er.id::text         AS request_id,
              sc.id::text          AS case_id,
              sc.patient_thread_id::text AS patient_thread_id,
              pt.patient_name,
              pt.uhid,
              sc.planned_surgery_date::text AS planned_surgery_date,
              sc.planned_start_time::text   AS planned_start_time,
              sc.ot_room,
              COALESCE(sp.full_name, '') AS surgeon_name,
              er.item_type,
              er.item_label,
              er.quantity,
              er.status,
              er.vendor_name,
              er.eta::text         AS eta,
              er.notes,
              CASE
                WHEN sc.planned_surgery_date = CURRENT_DATE THEN 'today'
                WHEN sc.planned_surgery_date = CURRENT_DATE + INTERVAL '1 day' THEN 'tomorrow'
                ELSE 'blocked'
              END AS bucket
         FROM equipment_requests er
         JOIN surgical_cases sc ON sc.id = er.case_id
         JOIN patient_threads pt ON pt.id = sc.patient_thread_id
         LEFT JOIN profiles sp ON sp.id = sc.surgeon_id
        WHERE sc.hospital_id = $1::uuid
          AND sc.archived_at IS NULL
          AND sc.state NOT IN ('cancelled','postponed','completed')
          AND (
            sc.planned_surgery_date IN (CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day')
            OR (er.status <> 'verified_ready' AND er.eta IS NOT NULL AND er.eta < NOW())
          )
        ORDER BY
          CASE
            WHEN sc.planned_surgery_date = CURRENT_DATE THEN 0
            WHEN sc.planned_surgery_date = CURRENT_DATE + INTERVAL '1 day' THEN 1
            ELSE 2
          END,
          sc.planned_start_time NULLS LAST,
          er.status,
          er.item_label
        LIMIT 200`,
      [hospital.id]
    );

    // ── 5. KPIs ─────────────────────────────────────────────────────────────
    // Approximations documented in *_basis fields so V's UAT can sanity-check:
    //   • utilization_pct = yesterday's bookings / (ot_room_count * 8 slots)
    //     where 8 is a v1 hardcoded "slots per OT per day" (8h shift, ~1h/case).
    //     Refine in v1.x when actual slot capacity is configured.
    //   • on_time_first_case_pct = % of yesterday's first-case-of-day-per-room
    //     where in_theatre transition occurred within ±15min of planned_start_time.
    //   • equipment_blocked_cancellations_7d = case_state_events to_state='cancelled'
    //     AND transition_reason ILIKE '%equipment%' in the last 7 days.
    //   • avg_pac_to_ot_days = avg(planned_surgery_date - latest pac_event date)
    //     for cases booked in the last 30 days with both PAC + scheduled date.
    const kpiRows = await queryOne<{
      yesterday_bookings: number;
      first_case_total: number;
      first_case_on_time: number;
      cancellations_7d: number;
      avg_lag_days: number | null;
    }>(
      `WITH yesterday_cases AS (
         SELECT id, planned_start_time, ot_room
           FROM surgical_cases
          WHERE hospital_id = $1::uuid
            AND archived_at IS NULL
            AND planned_surgery_date = CURRENT_DATE - INTERVAL '1 day'
            AND state IN ('scheduled','confirmed','verified','in_theatre','completed')
       ),
       first_per_room AS (
         SELECT DISTINCT ON (ot_room)
                id, planned_start_time, ot_room
           FROM yesterday_cases
          WHERE ot_room IS NOT NULL AND planned_start_time IS NOT NULL
          ORDER BY ot_room, planned_start_time ASC
       ),
       first_in_theatre AS (
         SELECT cse.case_id, MIN(cse.occurred_at) AS started_at
           FROM case_state_events cse
           JOIN first_per_room fpr ON fpr.id = cse.case_id
          WHERE cse.to_state = 'in_theatre'
          GROUP BY cse.case_id
       ),
       cancellations AS (
         SELECT COUNT(*)::int AS n
           FROM case_state_events cse
           JOIN surgical_cases sc ON sc.id = cse.case_id
          WHERE sc.hospital_id = $1::uuid
            AND cse.to_state = 'cancelled'
            AND cse.transition_reason ILIKE '%equipment%'
            AND cse.occurred_at >= NOW() - INTERVAL '7 days'
       ),
       latest_pac AS (
         SELECT DISTINCT ON (case_id) case_id, published_at::date AS pac_date
           FROM pac_events
          ORDER BY case_id, published_at DESC
       ),
       lag AS (
         SELECT AVG((sc.planned_surgery_date - lp.pac_date))::numeric AS avg_days
           FROM surgical_cases sc
           JOIN latest_pac lp ON lp.case_id = sc.id
          WHERE sc.hospital_id = $1::uuid
            AND sc.archived_at IS NULL
            AND sc.planned_surgery_date IS NOT NULL
            AND sc.planned_surgery_date >= CURRENT_DATE - INTERVAL '30 days'
       )
       SELECT (SELECT COUNT(*)::int FROM yesterday_cases) AS yesterday_bookings,
              (SELECT COUNT(*)::int FROM first_per_room)  AS first_case_total,
              (SELECT COUNT(*)::int
                 FROM first_per_room fpr
                 JOIN first_in_theatre fit ON fit.case_id = fpr.id
                WHERE ABS(EXTRACT(EPOCH FROM (
                  fit.started_at::timestamp -
                  ((CURRENT_DATE - INTERVAL '1 day')::timestamp + fpr.planned_start_time::time)
                ))) <= 15 * 60)                                AS first_case_on_time,
              (SELECT n FROM cancellations)                AS cancellations_7d,
              (SELECT avg_days FROM lag)                   AS avg_lag_days`,
      [hospital.id]
    );

    const slotsPerDay = (hospital.ot_room_count || 3) * 8;
    const kpis: KpiPayload = {
      utilization_pct: kpiRows
        ? Math.round((Number(kpiRows.yesterday_bookings) / slotsPerDay) * 100)
        : null,
      utilization_basis: `${kpiRows?.yesterday_bookings ?? 0}/${slotsPerDay} (yesterday bookings / ot_rooms*8h)`,
      on_time_first_case_pct: kpiRows && kpiRows.first_case_total > 0
        ? Math.round((Number(kpiRows.first_case_on_time) / Number(kpiRows.first_case_total)) * 100)
        : null,
      on_time_first_case_basis: `${kpiRows?.first_case_on_time ?? 0}/${kpiRows?.first_case_total ?? 0} first cases within ±15min`,
      equipment_blocked_cancellations_7d: Number(kpiRows?.cancellations_7d ?? 0),
      avg_pac_to_ot_days: kpiRows?.avg_lag_days != null
        ? Math.round(Number(kpiRows.avg_lag_days) * 10) / 10
        : null,
      avg_pac_to_ot_basis: 'avg(planned_surgery_date - latest_pac_date) over last 30 days',
      asof: new Date().toISOString(),
    };

    // ── 6. Notes ────────────────────────────────────────────────────────────
    // Glass: any signed-in user can read. Graceful degrade if the table
    // hasn't been migrated yet (V's manual /api/admin/migrate step pending).
    let notes: NotesPayload = { body: '', updated_by_name: null, updated_at: null };
    try {
      const noteRow = await queryOne<{ body: string; updated_by_name: string | null; updated_at: string }>(
        `SELECT body, updated_by_name, updated_at::text AS updated_at
           FROM ot_coordinator_notes
          WHERE hospital_id = $1::uuid
          LIMIT 1`,
        [hospital.id]
      );
      if (noteRow) notes = noteRow;
    } catch (e) {
      // Likely "relation does not exist" until V applies the migration.
      console.warn('[ot-management/today] notes read skipped:', e instanceof Error ? e.message : e);
    }

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
        equipment,
        kpis,
        notes,
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
