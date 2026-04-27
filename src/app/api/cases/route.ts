// ============================================
// GET /api/cases
//
// Lists surgical_cases filtered by the caller's hospital access via the
// user_accessible_hospital_ids() SQL function. Behind FEATURE_CASE_MODEL_ENABLED
// — when the flag is off, always returns an empty array.
//
// Query params:
//   state          — filter by lifecycle state (one of the 16 values)
//   urgency        — elective | urgent | emergency
//   hospital_slug  — restrict further to a specific hospital (must be within
//                     the caller's accessible set)
//   include_archived — '1' to include soft-deleted cases (default: excluded)
//   limit          — max rows, default 50, cap 500
//
// Response:
//   { success: true, data: [...], count, feature_enabled: boolean }
//
// Sprint 1 Day 4 (23 April 2026) — Decision M2 (role scope): every row the
// caller sees has hospital_id in user_accessible_hospital_ids(profileId).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withApiTelemetry } from '@/lib/api-telemetry';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

const VALID_STATES = new Set([
  'draft', 'intake', 'pac_scheduled', 'pac_done',
  'fit', 'fit_conds', 'defer', 'unfit',
  'optimizing', 'scheduled', 'confirmed', 'verified',
  'in_theatre', 'completed', 'postponed', 'cancelled',
]);
const VALID_URGENCIES = new Set(['elective', 'urgent', 'emergency']);

interface CaseRow {
  id: string;
  hospital_id: string;
  hospital_slug: string;
  patient_thread_id: string;
  patient_name: string | null;
  handoff_submission_id: string | null;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  ot_room: number | null;
  surgeon_id: string | null;
  surgeon_name: string | null;
  anaesthetist_id: string | null;
  urgency: string | null;
  state: string;
  // 26 Apr 2026 OT-booking redesign columns:
  planned_start_time: string | null;
  case_serial_in_slot: number | null;
  assist_surgeon_name: string | null;
  anaesthetist_name: string | null;
  anae_type: string | null;
  equipment_status: string | null;
  consumables_status: string | null;
  ot_remarks: string | null;
  kx_case_id: string | null;
  kx_pac_record_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  archived_at: string | null;
}

async function GET_inner(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const featureEnabled = process.env.FEATURE_CASE_MODEL_ENABLED === 'true';

    if (!featureEnabled) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        feature_enabled: false,
        message: 'FEATURE_CASE_MODEL_ENABLED is off — /api/cases returns empty.',
      });
    }

    const { searchParams } = new URL(request.url);
    const stateFilter = searchParams.get('state');
    const urgencyFilter = searchParams.get('urgency');
    const hospitalSlugFilter = searchParams.get('hospital_slug');
    const patientThreadIdFilter = searchParams.get('patient_thread_id');
    const includeArchived = searchParams.get('include_archived') === '1';
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.max(1, Math.min(500, isNaN(rawLimit) ? 50 : rawLimit));

    // Validate filters (defence against bad client input).
    if (stateFilter && !VALID_STATES.has(stateFilter)) {
      return NextResponse.json({ success: false, error: `Invalid state: ${stateFilter}` }, { status: 400 });
    }
    if (urgencyFilter && !VALID_URGENCIES.has(urgencyFilter)) {
      return NextResponse.json({ success: false, error: `Invalid urgency: ${urgencyFilter}` }, { status: 400 });
    }

    // Build WHERE clauses dynamically. The critical tenancy guard is
    // hospital_id = ANY(user_accessible_hospital_ids($1)) — everything else is additive.
    const whereClauses: string[] = [
      `sc.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))`,
    ];
    const params: unknown[] = [user.profileId];

    if (!includeArchived) {
      whereClauses.push(`sc.archived_at IS NULL`);
    }
    if (stateFilter) {
      params.push(stateFilter);
      whereClauses.push(`sc.state = $${params.length}`);
    }
    if (urgencyFilter) {
      params.push(urgencyFilter);
      whereClauses.push(`sc.urgency = $${params.length}`);
    }
    if (hospitalSlugFilter) {
      params.push(hospitalSlugFilter);
      whereClauses.push(`h.slug = $${params.length}`);
    }
    if (patientThreadIdFilter) {
      // 26 Apr 2026 follow-up F4 (P3-2): validate UUID before pushing into the
      // query — malformed input would otherwise cause PG ::UUID cast to throw
      // and surface as a generic 500.
      const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (!UUID_RE.test(patientThreadIdFilter)) {
        return NextResponse.json({ success: false, error: 'Invalid patient_thread_id' }, { status: 400 });
      }
      // Added Sprint 2 Day 6.B — CasePanel uses this to find a patient's active case.
      params.push(patientThreadIdFilter);
      whereClauses.push(`sc.patient_thread_id = $${params.length}::UUID`);
    }

    params.push(limit);

    const sql = `
      SELECT
        sc.id,
        sc.hospital_id,
        h.slug AS hospital_slug,
        sc.patient_thread_id,
        pt.patient_name,
        sc.handoff_submission_id,
        sc.planned_procedure,
        sc.planned_surgery_date,
        sc.ot_room,
        sc.surgeon_id,
        sc.anaesthetist_id,
        sc.urgency,
        sc.state,
        -- 26 Apr 2026 OT-booking redesign: surface the new columns so the
        -- calendar can render multi-booking cells without a second fetch.
        sc.planned_start_time,
        sc.case_serial_in_slot,
        sc.assist_surgeon_name,
        sc.anaesthetist_name,
        sc.anae_type,
        sc.equipment_status,
        sc.consumables_status,
        sc.ot_remarks,
        sc.kx_case_id,
        sc.kx_pac_record_id,
        sc.created_at,
        sc.updated_at,
        sc.created_by,
        sc.archived_at,
        rd.full_name AS surgeon_name
      FROM surgical_cases sc
      LEFT JOIN reference_doctors rd ON rd.id = sc.surgeon_id
      JOIN hospitals h ON h.id = sc.hospital_id
      LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY
        CASE sc.state
          WHEN 'in_theatre' THEN 1
          WHEN 'verified'   THEN 2
          WHEN 'confirmed'  THEN 3
          WHEN 'scheduled'  THEN 4
          WHEN 'optimizing' THEN 5
          WHEN 'pac_done'   THEN 6
          WHEN 'pac_scheduled' THEN 7
          WHEN 'intake'     THEN 8
          WHEN 'draft'      THEN 9
          ELSE 10
        END,
        sc.planned_surgery_date NULLS LAST,
        sc.created_at DESC
      LIMIT $${params.length}
    `;

    const rows = await query<CaseRow>(sql, params);

    return NextResponse.json({
      success: true,
      data: rows,
      count: rows.length,
      feature_enabled: true,
      filters: {
        state: stateFilter,
        urgency: urgencyFilter,
        hospital_slug: hospitalSlugFilter,
        patient_thread_id: patientThreadIdFilter,
        include_archived: includeArchived,
        limit,
      },
    });
  } catch (error) {
    console.error('GET /api/cases error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list cases' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST /api/cases
//
// Manual creation of a surgical_case for a patient that doesn't yet have one.
// Used by the Patient Overview "Create surgical case" button (25 Apr 2026).
//
// Idempotent: if an active case already exists for this patient, returns it
// instead of creating a duplicate.
//
// Body:
//   patient_thread_id (required)
//   urgency           (optional, default 'elective')
//   planned_procedure (optional)
//
// Auth: any user with mutate access on the patient's hospital. Defensive
// hospital_id resolution: derived from the patient's hospital_id (single
// source of truth).
// =============================================================================

import { queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

async function POST_inner(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const featureEnabled = process.env.FEATURE_CASE_MODEL_ENABLED === 'true';
    if (!featureEnabled) {
      return NextResponse.json({
        success: false,
        error: 'FEATURE_CASE_MODEL_ENABLED is off',
      }, { status: 400 });
    }

    const body = await request.json();
    const patientThreadId = body.patient_thread_id;
    if (!patientThreadId) {
      return NextResponse.json({ success: false, error: 'patient_thread_id is required' }, { status: 400 });
    }

    const urgency = ['elective', 'urgent', 'emergency'].includes(body.urgency) ? body.urgency : 'elective';
    const plannedProcedure = typeof body.planned_procedure === 'string' && body.planned_procedure.trim()
      ? body.planned_procedure.trim()
      : null;

    // Tenancy + existence check on the patient.
    // 26 Apr 2026 follow-up F2 (P2-1): hydrate auto-created cases from
    // patient_threads (consultant + dept) so the OT panel/tab metadata row
    // isn't blank for the empty-state-button path. Falls back gracefully
    // when fields are NULL.
    const patient = await queryOne<{
      id: string;
      hospital_id: string | null;
      current_stage: string;
      primary_consultant_id: string | null;
      primary_consultant_name: string | null;
      target_department: string | null;
    }>(
      `SELECT id, hospital_id, current_stage,
              primary_consultant_id, primary_consultant_name, target_department
         FROM patient_threads
        WHERE id = $1
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [patientThreadId, user.profileId]
    );
    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found or not accessible' }, { status: 404 });
    }
    if (!patient.hospital_id) {
      return NextResponse.json({ success: false, error: 'Patient has no hospital_id; cannot create case' }, { status: 400 });
    }

    // Idempotency: return existing active case if one exists.
    // 26 Apr 2026 audit fix (P1-5): exclude terminal states (cancelled,
    // postponed) — those are 'done' from the user's perspective, so a
    // 'Create surgical case' button click after a cancellation should
    // create a fresh case, not return the cancelled one.
    const existing = await queryOne<{ id: string; state: string }>(
      `SELECT id, state FROM surgical_cases
        WHERE patient_thread_id = $1
          AND archived_at IS NULL
          AND state NOT IN ('cancelled', 'postponed')
        ORDER BY created_at DESC LIMIT 1`,
      [patientThreadId]
    );
    if (existing) {
      return NextResponse.json({
        success: true,
        data: existing,
        action: 'existing',
        message: 'Returning existing active case for this patient.',
      });
    }

    // State inferred from current_stage (consistent with backfill migration).
    const inferredState = (() => {
      switch (patient.current_stage) {
        case 'admitted':
        case 'pre_op':
          return 'pac_scheduled';
        case 'surgery':
          return 'in_theatre';
        case 'post_op':
        case 'post_op_care':
        case 'discharge':
          return 'completed';
        default:
          return 'draft';
      }
    })();

    // 26 Apr 2026 follow-up F2 (P2-1): pull procedure from latest Marketing
    // Handoff if the body didn't supply one. Best-effort — fails open if the
    // form_submissions table layout changes.
    let hydratedProcedure = plannedProcedure;
    if (!hydratedProcedure) {
      try {
        const mh = await queryOne<{ form_data: Record<string, unknown> }>(
          `SELECT form_data FROM form_submissions
            WHERE patient_thread_id = $1
              AND form_type = 'consolidated_marketing_handoff'
              AND status = 'submitted'
            ORDER BY submitted_at DESC NULLS LAST, created_at DESC
            LIMIT 1`,
          [patientThreadId]
        );
        const fd = mh?.form_data as Record<string, unknown> | undefined;
        if (fd) {
          const proc = (fd.proposed_procedure ?? fd.clinical_summary ?? '') as string;
          if (typeof proc === 'string' && proc.trim()) {
            hydratedProcedure = proc.trim().slice(0, 500);
          }
        }
      } catch (e) {
        console.warn('[POST /api/cases] MH hydration skipped:', e instanceof Error ? e.message : e);
      }
    }
    // Resolve the primary consultant — prefer profiles, fall back to reference_doctors.
    let surgeonId: string | null = null;
    if (patient.primary_consultant_id) {
      const sid = await queryOne<{ id: string }>(
        `SELECT id FROM profiles WHERE id = $1
         UNION
         SELECT id FROM reference_doctors WHERE id = $1
         LIMIT 1`,
        [patient.primary_consultant_id]
      );
      if (sid) surgeonId = sid.id;
    }

    // 26 Apr 2026 audit fix (P1-1): atomize the surgical_cases INSERT and the
    // case_state_events INSERT into a single statement via CTE chaining.
    const metadataJson = JSON.stringify({
      via: 'POST /api/cases',
      hydrated: {
        procedure_from_mh: hydratedProcedure !== plannedProcedure,
        consultant_resolved: surgeonId !== null,
      },
    });
    const inserted = await queryOne<{ id: string; state: string }>(
      `WITH new_case AS (
         INSERT INTO surgical_cases
           (hospital_id, patient_thread_id, state, urgency, planned_procedure,
            surgeon_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $8::UUID, $6, NOW(), NOW())
         RETURNING id, state
       ),
       new_event AS (
         INSERT INTO case_state_events
           (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
         SELECT id, NULL, state, 'manual_create', $6, $7::jsonb FROM new_case
         RETURNING case_id
       )
       SELECT id, state FROM new_case`,
      [patient.hospital_id, patientThreadId, inferredState, urgency, hydratedProcedure, user.profileId, metadataJson, surgeonId]
    );

    await audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: patient.hospital_id,
      action: 'case.create',
      targetType: 'surgical_case',
      targetId: inserted.id,
      summary: `Created surgical case for patient ${patientThreadId}`,
      payloadAfter: { patient_thread_id: patientThreadId, planned_procedure: hydratedProcedure, urgency, state: inserted.state },
      request,
    }).catch((e) => console.error('[audit] case.create failed (fire_and_forget):', e instanceof Error ? e.message : e));

    return NextResponse.json({
      success: true,
      data: inserted,
      action: 'created',
    });
  } catch (error) {
    console.error('POST /api/cases error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create case' },
      { status: 500 }
    );
  }
}

// AP.3 — telemetry-wrapped exports (auto-applied)
export const GET = withApiTelemetry('/api/cases', GET_inner);
export const POST = withApiTelemetry('/api/cases', POST_inner);
