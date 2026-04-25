// =============================================================================
// POST /api/cases/schedule-pac
//
// V's 26 Apr 2026 ask: anaesthetists should be able to pull a patient into
// the PAC queue directly, without waiting for an IPD coordinator's hand-off.
//
// Behaviour:
//   - Body: { patient_thread_id }
//   - If the patient has no surgical_case → CREATE one in state='pac_scheduled'
//   - If the patient has a case in state ∈ {draft, intake} → UPDATE state
//     to 'pac_scheduled' (no-op if already scheduled, conflict if past PAC)
//   - In both branches a case_state_events row is written atomically (CTE
//     chaining; same pattern as POST /api/cases per audit fix P1-1).
//
// Tenancy: case + patient must be in caller's accessible hospitals.
// Role gate: anesthesiologist + super_admin (auto-pass via hasRole).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { query, queryOne } from '@/lib/db';

const SCHEDULE_ROLES = new Set(['anesthesiologist']);

// Case states from which scheduling for PAC is allowed.
const SCHEDULABLE_FROM = new Set(['draft', 'intake']);
// States that already-scheduled / past-PAC. We refuse to overwrite these to
// avoid resetting a published PAC outcome.
const TERMINAL_OR_DOWNSTREAM = new Set([
  'pac_scheduled', 'pac_done',
  'fit', 'fit_conds', 'defer', 'unfit', 'optimizing',
  'scheduled', 'confirmed', 'verified', 'in_theatre',
  'completed', 'postponed', 'cancelled',
]);

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Body {
  patient_thread_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    if (!hasRole(user.role, SCHEDULE_ROLES)) {
      return NextResponse.json(
        { success: false, error: `Role ${user.role} cannot schedule a case for PAC. Required: anesthesiologist or super_admin.` },
        { status: 403 }
      );
    }

    const body = (await request.json()) as Body;
    if (!body.patient_thread_id || !UUID_RE.test(body.patient_thread_id)) {
      return NextResponse.json({ success: false, error: 'patient_thread_id is required' }, { status: 400 });
    }

    // Tenancy check on the patient.
    const patient = await queryOne<{ id: string; hospital_id: string | null }>(
      `SELECT id, hospital_id FROM patient_threads
        WHERE id = $1
          AND archived_at IS NULL
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [body.patient_thread_id, user.profileId]
    );
    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found or not accessible' }, { status: 404 });
    }
    if (!patient.hospital_id) {
      return NextResponse.json({ success: false, error: 'Patient has no hospital_id; cannot schedule PAC' }, { status: 400 });
    }

    // Look up the latest active case (if any) to decide create vs transition.
    const existing = await queryOne<{ id: string; state: string }>(
      `SELECT id, state FROM surgical_cases
        WHERE patient_thread_id = $1 AND archived_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [body.patient_thread_id]
    );

    const metadataJson = JSON.stringify({
      via: 'POST /api/cases/schedule-pac',
      reason: 'anaesthetist self-assigned via search',
    });

    if (!existing) {
      // No case yet — atomic CREATE in pac_scheduled.
      const created = await queryOne<{ id: string; state: string }>(
        `WITH new_case AS (
           INSERT INTO surgical_cases
             (hospital_id, patient_thread_id, state, urgency, created_by, created_at, updated_at)
           VALUES ($1, $2, 'pac_scheduled', 'elective', $3, NOW(), NOW())
           RETURNING id, state
         ),
         new_event AS (
           INSERT INTO case_state_events
             (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
           SELECT id, NULL, state, 'anaesthetist_self_schedule', $3, $4::jsonb FROM new_case
           RETURNING case_id
         )
         SELECT id, state FROM new_case`,
        [patient.hospital_id, body.patient_thread_id, user.profileId, metadataJson]
      );
      return NextResponse.json({
        success: true,
        action: 'created',
        data: created,
      });
    }

    // Case exists — only transition if currently in {draft, intake}.
    if (existing.state === 'pac_scheduled') {
      return NextResponse.json({
        success: true,
        action: 'noop',
        data: existing,
        message: 'Already scheduled for PAC.',
      });
    }
    if (TERMINAL_OR_DOWNSTREAM.has(existing.state) && existing.state !== 'pac_scheduled') {
      return NextResponse.json({
        success: false,
        error: `Case is already at state '${existing.state}'. Cannot reset to pac_scheduled.`,
      }, { status: 409 });
    }
    if (!SCHEDULABLE_FROM.has(existing.state)) {
      return NextResponse.json({
        success: false,
        error: `Case state '${existing.state}' is not in the schedulable-from set.`,
      }, { status: 409 });
    }

    // Atomic UPDATE + state event.
    const updated = await queryOne<{ id: string; state: string }>(
      `WITH transitioned AS (
         UPDATE surgical_cases
            SET state = 'pac_scheduled', updated_at = NOW()
          WHERE id = $1
          RETURNING id, state
       ),
       new_event AS (
         INSERT INTO case_state_events
           (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
         SELECT id, $2, state, 'anaesthetist_self_schedule', $3, $4::jsonb FROM transitioned
         RETURNING case_id
       )
       SELECT id, state FROM transitioned`,
      [existing.id, existing.state, user.profileId, metadataJson]
    );

    return NextResponse.json({
      success: true,
      action: 'transitioned',
      data: updated,
    });
  } catch (error) {
    console.error('POST /api/cases/schedule-pac error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to schedule case for PAC' },
      { status: 500 }
    );
  }
}
