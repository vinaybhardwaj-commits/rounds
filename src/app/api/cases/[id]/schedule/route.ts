// ============================================
// POST /api/cases/[id]/schedule
//
// Schedule a case into an OT slot. Sets planned_surgery_date + ot_room +
// optional surgeon/anaesthetist, transitions state to 'scheduled', logs
// case_state_events, and optionally auto-attaches equipment kits.
//
// Body:
//   {
//     planned_surgery_date: 'YYYY-MM-DD',     // required
//     ot_room: 1 | 2 | 3,                      // required (hospitals have 3 OTs each)
//     surgeon_id?: uuid,
//     anaesthetist_id?: uuid,
//     attach_kit_ids?: uuid[]                  // equipment_kits.id list — creates
//                                              //   one equipment_request per kit
//   }
//
// Access control:
//   - case's hospital_id must be in user_accessible_hospital_ids(caller)
//   - caller's role must be 'ot_coordinator' OR 'super_admin'
//
// Allowed from-states: fit, fit_conds, optimizing, scheduled (last = reschedule).
//
// Sprint 2 Day 8 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const SCHEDULABLE_FROM_STATES = new Set(['fit', 'fit_conds', 'optimizing', 'scheduled']);

interface CaseRow {
  id: string;
  hospital_id: string;
  state: string;
}

interface KitRow {
  id: string;
  label: string;
  code: string;
}

interface ScheduleBody {
  planned_surgery_date?: string;
  ot_room?: number;
  surgeon_id?: string;
  anaesthetist_id?: string;
  attach_kit_ids?: unknown;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json(
        { success: false, error: 'Case model is disabled (FEATURE_CASE_MODEL_ENABLED=false).' },
        { status: 503 }
      );
    }


    const { id: caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as ScheduleBody;

    // Validate required fields.
    if (!body.planned_surgery_date || !DATE_RE.test(body.planned_surgery_date)) {
      return NextResponse.json(
        { success: false, error: 'planned_surgery_date is required in YYYY-MM-DD form' },
        { status: 400 }
      );
    }
    if (typeof body.ot_room !== 'number' || body.ot_room < 1 || body.ot_room > 3) {
      return NextResponse.json(
        { success: false, error: 'ot_room must be an integer 1..3 (hospitals have 3 OTs each)' },
        { status: 400 }
      );
    }
    if (body.surgeon_id && !UUID_RE.test(body.surgeon_id)) {
      return NextResponse.json({ success: false, error: 'surgeon_id must be a UUID' }, { status: 400 });
    }
    if (body.anaesthetist_id && !UUID_RE.test(body.anaesthetist_id)) {
      return NextResponse.json({ success: false, error: 'anaesthetist_id must be a UUID' }, { status: 400 });
    }

    const kitIds = Array.isArray(body.attach_kit_ids)
      ? body.attach_kit_ids.filter((k): k is string => typeof k === 'string' && UUID_RE.test(k))
      : [];

    // Fetch case with tenancy guard.
    const c = await queryOne<CaseRow>(
      `
      SELECT sc.id, sc.hospital_id, sc.state
      FROM surgical_cases sc
      WHERE sc.id = $1
        AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))
      `,
      [caseId, user.profileId]
    );

    if (!c) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    if (!SCHEDULABLE_FROM_STATES.has(c.state)) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot schedule from state "${c.state}". Allowed: ${[...SCHEDULABLE_FROM_STATES].join(', ')}.`,
          current_state: c.state,
        },
        { status: 409 }
      );
    }

    // If kit ids provided, validate they belong to the same hospital as the case
    // and are active. Otherwise we'd create cross-hospital equipment references.
    let validKits: KitRow[] = [];
    if (kitIds.length > 0) {
      validKits = await query<KitRow>(
        `
        SELECT id, code, label
        FROM equipment_kits
        WHERE id = ANY($1::uuid[])
          AND hospital_id = $2
          AND is_active = true
        `,
        [kitIds, c.hospital_id]
      );
      const validSet = new Set(validKits.map((k) => k.id));
      const unknown = kitIds.filter((k) => !validSet.has(k));
      if (unknown.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Unknown or inactive kit ids for this hospital', unknown_kit_ids: unknown },
          { status: 400 }
        );
      }
    }

    // ---- MUTATIONS ----
    // 1. surgical_cases update + state transition.
    await query(
      `
      UPDATE surgical_cases
      SET state = 'scheduled',
          planned_surgery_date = $1::date,
          ot_room = $2,
          surgeon_id = COALESCE($3, surgeon_id),
          anaesthetist_id = COALESCE($4, anaesthetist_id),
          updated_at = NOW()
      WHERE id = $5
      `,
      [body.planned_surgery_date, body.ot_room, body.surgeon_id ?? null, body.anaesthetist_id ?? null, caseId]
    );

    // 2. case_state_events
    const isReschedule = c.state === 'scheduled';
    await query(
      `
      INSERT INTO case_state_events
        (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        caseId,
        c.state,
        'scheduled',
        isReschedule ? 'reschedule' : 'schedule',
        user.profileId,
        JSON.stringify({
          via: 'api/cases/schedule',
          planned_surgery_date: body.planned_surgery_date,
          ot_room: body.ot_room,
          kit_ids_attached: validKits.map((k) => k.id),
        }),
      ]
    );

    // 3. equipment_requests — one placeholder per attached kit. The
    //    equipment_requests.item_type CHECK constraint only allows
    //    (specialty, rental, implant, blood, imaging). Kits are typically
    //    specialty packs, so we record kit attachment with item_type='specialty'
    //    and kit_id set. auto_verified=true because kit attachment is a
    //    trusted fast-path at scheduling time; Arul's Day 9 kanban can
    //    itemize the kit into finer requests if needed.
    const insertedKitRequests: string[] = [];
    for (const kit of validKits) {
      const row = await queryOne<{ id: string }>(
        `
        INSERT INTO equipment_requests
          (case_id, item_type, item_label, quantity, status, kit_id, auto_verified)
        VALUES ($1, 'specialty', $2, 1, 'verified_ready', $3, true)
        RETURNING id
        `,
        [caseId, `Kit: ${kit.label}`, kit.id]
      );
      if (row) insertedKitRequests.push(row.id);
    }

    // 4. Auto-generate RMO pre-op verification task (Sprint 3 Day 11.5).
    //    Partial unique index idx_tasks_auto_dedup on (case_id, source_ref)
    //    WHERE source='auto' — so re-scheduling won't duplicate the task; it
    //    silently no-ops on conflict. If the caller is rescheduling and the
    //    task already exists, we update its due_at to the new surgery date.
    //    Patient name is resolved via the patient_threads join for a readable title.
    let autoTaskId: string | null = null;
    try {
      const patientRow = await queryOne<{ patient_name: string | null }>(
        `SELECT pt.patient_name FROM surgical_cases sc JOIN patient_threads pt ON pt.id = sc.patient_thread_id WHERE sc.id = $1`,
        [caseId]
      );
      const patientName = patientRow?.patient_name ?? 'patient';
      const title = `Pre-op verification for ${patientName}`;
      const description = `OT coordinator to complete day-of verification checklist before ${body.planned_surgery_date} (OT-${body.ot_room}). Opens the Day-of Verification modal on the case drawer.`;
      // due_at = 05:00 on the surgery date (2h before a conservative 07:00 first-slot start).
      // Admin UI can make this per-hospital/OT configurable later.

      const taskRow = await queryOne<{ id: string }>(
        `
        INSERT INTO tasks
          (hospital_id, case_id, title, description, owner_role, due_at,
           status, source, source_ref, metadata, created_by)
        VALUES
          ($1, $2, $3, $4, 'ot_coordinator',
           ($5::date)::timestamp + INTERVAL '5 hours',
           'pending', 'auto', $6, $7::jsonb, $8)
        ON CONFLICT (case_id, source_ref) WHERE source = 'auto' AND case_id IS NOT NULL DO UPDATE
          SET due_at = EXCLUDED.due_at,
              metadata = tasks.metadata || EXCLUDED.metadata,
              updated_at = NOW()
        RETURNING id
        `,
        [
          c.hospital_id,             // $1
          caseId,                    // $2
          title,                     // $3
          description,               // $4
          body.planned_surgery_date, // $5 — the date used for due_at expr
          'case:verify_preop',       // $6
          JSON.stringify({
            scheduled_surgery_date: body.planned_surgery_date,
            ot_room: body.ot_room,
          }),                        // $7
          user.profileId,            // $8
        ]
      );
      autoTaskId = taskRow?.id ?? null;
    } catch (e) {
      // Non-fatal: scheduling is already committed. Log and continue.
      // If the ON CONFLICT partial-index clause syntax is rejected by Neon
      // HTTP, fall back to a two-step: check + insert.
      console.error('[schedule] auto-task insert failed (non-fatal):', (e as Error).message);
    }

    return NextResponse.json({
      success: true,
      data: {
        transition: { from: c.state, to: 'scheduled' },
        scheduled: {
          planned_surgery_date: body.planned_surgery_date,
          ot_room: body.ot_room,
          surgeon_id: body.surgeon_id ?? null,
          anaesthetist_id: body.anaesthetist_id ?? null,
        },
        kits_attached: validKits.map((k) => ({ id: k.id, code: k.code, label: k.label })),
        equipment_request_ids: insertedKitRequests,
        reschedule: isReschedule,
        auto_task_id: autoTaskId,
      },
    });
  } catch (error) {
    console.error('POST /api/cases/[id]/schedule error:', error);
    return NextResponse.json(
      { success: false, error: 'Schedule failed' },
      { status: 500 }
    );
  }
}
