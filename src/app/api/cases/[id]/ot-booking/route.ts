// =============================================================================
// POST /api/cases/[id]/ot-booking   (26 Apr 2026 — V's OT calendar redesign)
//
// Saves the full booking-card payload onto a surgical_case row and:
//   - Auto-transitions case state from {fit, fit_conds, optimizing, pac_scheduled,
//     pac_done, intake, draft} → 'scheduled'
//   - Auto-advances the patient stage to 'pre_op' when currently in
//     {opd, pre_admission, admitted, medical_management}
//   - Logs a case_state_events row when the case state changed
//
// Atomic via CTE chaining (no PL/pgSQL function needed).
//
// Body shape (all fields optional except date + ot_room + serial):
//   planned_surgery_date   YYYY-MM-DD
//   ot_room                integer (1..N)
//   case_serial_in_slot    integer ≥ 1
//   planned_start_time     "HH:MM"
//   planned_procedure      string
//   surgeon_name           string  (writes both surgeon_id=null + name)
//   assist_surgeon_name    string
//   anaesthetist_name      string
//   anae_type              "GA"|"SA"|"LA"|"Block"|"Other"
//   pac_cleared            boolean → maps onto case state when true: keep
//                           current state if already scheduled-eligible.
//   equipment_status       "Ready"|"CSSD"|"Outside"|"Other"
//   consumables_status     "Ready"|"Sourcing"|"Other"
//   ot_remarks             string
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { writePacFacts } from '@/lib/pac-workspace/facts';
import { recomputeNonFatal } from '@/lib/pac-workspace/engine-persistence';

// 26 Apr 2026 follow-up F3: V widened the gate.
// 'consultant' and 'surgeon' are not yet in UserRole enum — they remain
// here as a forward-compatibility marker for when those roles are added.

const VALID_ANAE = new Set(['GA', 'SA', 'LA', 'Block', 'Other']);
const VALID_EQUIP = new Set(['Ready', 'CSSD', 'Outside', 'Other']);
const VALID_CONS = new Set(['Ready', 'Sourcing', 'Other']);

const SCHEDULE_FROM = new Set([
  'draft', 'intake', 'pac_scheduled', 'pac_done',
  'fit', 'fit_conds', 'optimizing', 'defer', 'scheduled',
]);
// 1 May 2026 (sub-sprint C): PRE_OP_BLOCKING_STAGES set + auto-advance to
// 'pre_op' removed. The pre_op stage is retired; OT booking no longer
// moves the patient through any journey stage.

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Body {
  planned_surgery_date?: string;
  ot_room?: number;
  case_serial_in_slot?: number;
  planned_start_time?: string;
  planned_procedure?: string;
  surgeon_name?: string;
  assist_surgeon_name?: string;
  anaesthetist_name?: string;
  anae_type?: string;
  equipment_status?: string;
  consumables_status?: string;
  ot_remarks?: string;
}

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
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    const { id: caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as Body;

    // Validate enums (only when supplied — null leaves the field blank).
    if (body.anae_type && !VALID_ANAE.has(body.anae_type)) {
      return NextResponse.json({ success: false, error: 'Invalid anae_type' }, { status: 400 });
    }
    if (body.equipment_status && !VALID_EQUIP.has(body.equipment_status)) {
      return NextResponse.json({ success: false, error: 'Invalid equipment_status' }, { status: 400 });
    }
    if (body.consumables_status && !VALID_CONS.has(body.consumables_status)) {
      return NextResponse.json({ success: false, error: 'Invalid consumables_status' }, { status: 400 });
    }
    if (body.ot_room != null && (!Number.isInteger(body.ot_room) || body.ot_room < 1)) {
      return NextResponse.json({ success: false, error: 'ot_room must be a positive integer' }, { status: 400 });
    }
    if (body.case_serial_in_slot != null && (!Number.isInteger(body.case_serial_in_slot) || body.case_serial_in_slot < 1)) {
      return NextResponse.json({ success: false, error: 'case_serial_in_slot must be a positive integer' }, { status: 400 });
    }
    if (body.planned_surgery_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.planned_surgery_date)) {
      return NextResponse.json({ success: false, error: 'planned_surgery_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (body.planned_start_time && !/^\d{1,2}:\d{2}$/.test(body.planned_start_time)) {
      return NextResponse.json({ success: false, error: 'planned_start_time must be HH:MM' }, { status: 400 });
    }

    // Tenancy + load existing case state.
    const c = await queryOne<{ id: string; hospital_id: string; state: string; patient_thread_id: string }>(
      `SELECT sc.id, sc.hospital_id, sc.state, sc.patient_thread_id
         FROM surgical_cases sc
        WHERE sc.id = $1
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [caseId, user.profileId]
    );
    if (!c) {
      return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
    }

    // State transition: if currently in a schedulable-from set, move to 'scheduled'.
    // If already 'scheduled' or further, leave alone (re-edits don't roll state back).
    const willTransition = SCHEDULE_FROM.has(c.state) && c.state !== 'scheduled';
    const newState = willTransition ? 'scheduled' : c.state;

    const metadataJson = JSON.stringify({
      via: 'POST /api/cases/[id]/ot-booking',
      previous_state: c.state,
    });

    // Atomic update + (optional) state event in one statement via CTE.
    const updated = await queryOne<{
      id: string;
      state: string;
      planned_surgery_date: string | null;
      ot_room: number | null;
      case_serial_in_slot: number | null;
    }>(
      `WITH updated AS (
         UPDATE surgical_cases SET
           state                = $2,
           planned_surgery_date = COALESCE($3::DATE, planned_surgery_date),
           ot_room              = COALESCE($4::INT, ot_room),
           case_serial_in_slot  = COALESCE($5::INT, case_serial_in_slot),
           planned_start_time   = COALESCE($6, planned_start_time),
           planned_procedure    = COALESCE($7, planned_procedure),
           assist_surgeon_name  = COALESCE($8, assist_surgeon_name),
           anaesthetist_name    = COALESCE($9, anaesthetist_name),
           anae_type            = COALESCE($10, anae_type),
           equipment_status     = COALESCE($11, equipment_status),
           consumables_status   = COALESCE($12, consumables_status),
           ot_remarks           = COALESCE($13, ot_remarks),
           updated_at           = NOW()
         WHERE id = $1
         RETURNING id, state, planned_surgery_date, ot_room, case_serial_in_slot, patient_thread_id
       ),
       maybe_event AS (
         INSERT INTO case_state_events
           (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
         SELECT id, $14, state, 'ot_booking', $15, $16::jsonb
           FROM updated
          WHERE $17::boolean = TRUE
         RETURNING case_id
       )
       SELECT id, state, planned_surgery_date, ot_room, case_serial_in_slot
         FROM updated`,
      [
        caseId,
        newState,
        body.planned_surgery_date ?? null,
        body.ot_room ?? null,
        body.case_serial_in_slot ?? null,
        body.planned_start_time ?? null,
        body.planned_procedure ?? null,
        body.assist_surgeon_name ?? null,
        body.anaesthetist_name ?? null,
        body.anae_type ?? null,
        body.equipment_status ?? null,
        body.consumables_status ?? null,
        body.ot_remarks ?? null,
        c.state,
        user.profileId,
        metadataJson,
        willTransition,
      ]
    );

    // 1 May 2026 (sub-sprint C): patient-stage auto-advance removed.
    // Previously OT booking bumped current_stage to 'pre_op' if the patient
    // was in opd/pre_admission/admitted/medical_management. Per V's
    // direction, the pre_op stage is retired and booking no longer moves
    // the patient through any stage — booking creates the OT appointment;
    // the patient stays at admitted (or earlier) until they actually go
    // into surgery (manual transition or future day-of trigger).
    const stageAdvanced = false;


    // GLASS.4 audit wiring — GUARANTEED mode (OT booking is reversible but critical)
    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: c.hospital_id,
        action: 'case.book_ot',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: 'OT booking scheduled',
        payloadBefore: { scheduled_date: c.planned_surgery_date ?? null, ot_room: c.ot_room ?? null },
        payloadAfter: { scheduled_date: updated.planned_surgery_date, ot_room: updated.ot_room, scheduled_start_time: body.planned_start_time, scheduled_end_time: null },
        request,
        mode: 'guaranteed',
      });
    } catch (auditErr) {
      console.error('[audit:guaranteed] case.book_ot:', auditErr instanceof Error ? auditErr.message : auditErr);
      return NextResponse.json({ success: false, error: 'Audit logging failed; please retry. Mutation may need manual rollback.' }, { status: 503 });
    }

    // ── PCW2.1 (2 May 2026) — pac_facts hook for ot_booking ──
    // Per PRD §5.1 ot_booking row: writes surgery.anaesthesia_type,
    // surgery.equipment_status, surgery.consumables_status, surgery.target_date,
    // surgery.ot_room, and risk.flagged_high_risk (if computed). source_form_
    // submission_id is NULL since ot_booking is not a form_submission row.
    // Non-fatal: a fact-write failure must not invalidate a successfully-
    // committed (and audited) booking.
    try {
      const written = await writePacFacts({
        caseId,
        sourceFormType: 'ot_booking',
        sourceFormSubmissionId: null,
        formData: body as Record<string, unknown>,
      });
      if (written.written > 0) {
        console.log(
          `[pcw2.1] wrote ${written.written} pac_facts rows for case ${caseId} from ot_booking`
        );
      }
      // PCW2.3 — recompute after fact write. Non-fatal.
      await recomputeNonFatal(caseId, 'ot_booking');
    } catch (factErr) {
      console.error(
        '[pcw2.1] pac_facts write failed (non-fatal) for ot_booking:',
        (factErr as Error).message
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
      action: willTransition ? 'scheduled' : 'updated',
      stage_advanced: stageAdvanced,
    });
  } catch (error) {
    console.error('POST /api/cases/[id]/ot-booking error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save OT booking' },
      { status: 500 }
    );
  }
}
