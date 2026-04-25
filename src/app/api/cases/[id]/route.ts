// ============================================
// GET /api/cases/[id]
//
// Case detail — single payload that powers the Shape A+C drawer (Sprint 2 Day 6).
// Returns the surgical_case + hospital + patient thread + all related collections
// (state history, PAC events, condition cards, equipment requests) in one shot so
// the drawer renders without a waterfall of fetches.
//
// Behind FEATURE_CASE_MODEL_ENABLED — returns 503 when the flag is off.
//
// Access control:
//   - caller must be authenticated
//   - case's hospital_id must be in user_accessible_hospital_ids(caller)
//   - 404 if not accessible (not 403 — don't leak the existence of other hospitals' cases)
//
// Response:
//   {
//     success: true,
//     feature_enabled: true,
//     data: {
//       case: { ... surgical_cases row + case_code },
//       hospital: { id, slug, name, display_name, is_active },
//       patient: { id, patient_name, kx_uhid, age, gender, mobile, created_at } | null,
//       state_history: [ { from_state, to_state, actor, transition_reason, created_at } ... ],
//       pac_events: [...],
//       condition_cards: [...],
//       equipment_requests: [...],
//       handoff_submission: { id, submitted_at, submitter_name, form_type } | null
//     }
//   }
//
// Sprint 2 Day 6 (24 April 2026).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';

interface CaseRow {
  id: string;
  hospital_id: string;
  patient_thread_id: string;
  handoff_submission_id: string | null;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  ot_room: number | null;
  surgeon_id: string | null;
  anaesthetist_id: string | null;
  urgency: string | null;
  state: string;
  kx_case_id: string | null;
  kx_pac_record_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  archived_at: string | null;
  // joined
  hospital_slug: string;
  hospital_name: string;
  hospital_display_name: string | null;
  hospital_is_active: boolean;
  patient_name: string | null;
}

interface StateEvent {
  id: string;
  from_state: string | null;
  to_state: string;
  transition_reason: string | null;
  actor_profile_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface PacEventRow {
  id: string;
  case_id: string;
  published_at: string;
  outcome: string;
  anaesthetist_id: string;
  anaesthetist_name: string | null;
  notes: string | null;
  kx_pac_record_id: string | null;
}

interface ConditionCardRow {
  id: string;
  case_id: string;
  library_code: string | null;
  custom_label: string | null;
  status: string;
  note: string | null;
  owner_profile_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
}

interface EquipmentRequestRow {
  id: string;
  case_id: string;
  kit_id: string | null;
  item_type: string;
  item_label: string;
  quantity: number;
  status: string;
  vendor_name: string | null;
  vendor_phone: string | null;
  eta: string | null;
  notes: string | null;
  auto_verified: boolean;
  created_at: string;
  updated_at: string;
}

interface HandoffRow {
  id: string;
  form_type: string;
  submitted_at: string;
  submitter_profile_id: string | null;
  submitter_name: string | null;
}

function formatCaseCode(hospitalSlug: string, caseCreatedAt: string, rowId: string): string {
  // EHRC-SC-2026-00142 — year + 5-digit suffix from UUID tail.
  // We don't have a sequence column in Sprint 1's schema, so derive a stable
  // short code from the uuid. Good enough for drawer display; Sprint 3 can
  // swap in a real monotonic sequence if we need the strict numbering.
  const year = new Date(caseCreatedAt).getUTCFullYear();
  const tail = rowId.replace(/-/g, '').slice(-5).toUpperCase();
  return `${hospitalSlug.toUpperCase()}-SC-${year}-${tail}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json(
        {
          success: false,
          feature_enabled: false,
          error: 'Case model is disabled (FEATURE_CASE_MODEL_ENABLED=false).',
        },
        { status: 503 }
      );
    }

    const { id } = params;

    // UUID sanity check — surgical_cases.id is a UUID. Reject obvious garbage
    // up front so we don't generate a SQL error the user sees as a 500.
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    // Primary fetch: case + hospital + patient thread in one query.
    // Tenancy gate enforced via user_accessible_hospital_ids($2) — if caller
    // can't see the case's hospital, row is filtered out → 404.
    const c = await queryOne<CaseRow>(
      `
      SELECT
        sc.id, sc.hospital_id, sc.patient_thread_id, sc.handoff_submission_id,
        sc.planned_procedure, sc.planned_surgery_date, sc.ot_room,
        sc.surgeon_id, sc.anaesthetist_id, sc.urgency, sc.state,
        sc.kx_case_id, sc.kx_pac_record_id,
        sc.created_at, sc.updated_at, sc.created_by, sc.archived_at,
        h.slug AS hospital_slug,
        h.name AS hospital_name,
        h.name AS hospital_display_name,
        h.is_active AS hospital_is_active,
        pt.patient_name
      FROM surgical_cases sc
      JOIN hospitals h ON h.id = sc.hospital_id
      LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
      WHERE sc.id = $1
        AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))
      `,
      [id, user.profileId]
    );

    if (!c) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    // Parallel related-data fetches. Each returns [] if the table is empty for
    // this case — drawer handles empty gracefully.
    const [stateHistory, pacEvents, conditionCards, equipmentRequests, handoff, patient] =
      await Promise.all([
        query<StateEvent>(
          // 25 Apr 2026 fix: case_state_events column is 'occurred_at' (per
          // migration-surgical-cases.sql), not 'created_at'. Aliased to keep
          // StateEvent.created_at on the JS side.
          `
          SELECT
            cse.id, cse.from_state, cse.to_state, cse.transition_reason,
            cse.actor_profile_id, p.full_name AS actor_name,
            cse.metadata, cse.occurred_at AS created_at
          FROM case_state_events cse
          LEFT JOIN profiles p ON p.id = cse.actor_profile_id
          WHERE cse.case_id = $1
          ORDER BY cse.occurred_at ASC
          `,
          [id]
        ),
        query<PacEventRow>(
          `
          SELECT
            pe.id, pe.case_id, pe.published_at, pe.outcome,
            pe.anaesthetist_id, p.full_name AS anaesthetist_name,
            pe.notes, pe.kx_pac_record_id
          FROM pac_events pe
          LEFT JOIN profiles p ON p.id = pe.anaesthetist_id
          WHERE pe.case_id = $1
          ORDER BY pe.published_at DESC
          `,
          [id]
        ),
        query<ConditionCardRow>(
          `
          SELECT
            id, case_id, library_code, custom_label, status,
            note, owner_profile_id, completed_at, completed_by, created_at
          FROM condition_cards
          WHERE case_id = $1
          ORDER BY created_at ASC
          `,
          [id]
        ),
        query<EquipmentRequestRow>(
          `
          SELECT
            id, case_id, kit_id, item_type, item_label, quantity, status,
            vendor_name, vendor_phone, eta, notes, auto_verified,
            created_at, updated_at
          FROM equipment_requests
          WHERE case_id = $1
          ORDER BY created_at ASC
          `,
          [id]
        ),
        c.handoff_submission_id
          ? queryOne<HandoffRow>(
              // 25 Apr 2026 fix: form_submissions has 'created_at' not
              // 'submitted_at', and 'submitted_by' not 'submitter_profile_id'.
              // Aliased to keep HandoffRow shape.
              `
              SELECT
                fs.id, fs.form_type, fs.created_at AS submitted_at,
                fs.submitted_by AS submitter_profile_id, p.full_name AS submitter_name
              FROM form_submissions fs
              LEFT JOIN profiles p ON p.id = fs.submitted_by
              WHERE fs.id = $1
              `,
              [c.handoff_submission_id]
            )
          : Promise.resolve(null),
        queryOne<{
          id: string;
          patient_name: string | null;
          kx_uhid: string | null;
          age: number | null;
          gender: string | null;
          mobile: string | null;
          created_at: string;
        }>(
          // 25 Apr 2026 fix: patient_threads columns are 'uhid' and 'phone'
          // (not 'kx_uhid' and 'mobile'). Aliased so the JS shape consumed by
          // CaseDrawer stays identical.
          `
          SELECT id, patient_name,
                 uhid AS kx_uhid,
                 age, gender,
                 phone AS mobile,
                 created_at
          FROM patient_threads
          WHERE id = $1
          `,
          [c.patient_thread_id]
        ),
      ]);

    const caseCode = formatCaseCode(c.hospital_slug, c.created_at, c.id);

    return NextResponse.json({
      success: true,
      feature_enabled: true,
      data: {
        case: {
          id: c.id,
          hospital_id: c.hospital_id,
          patient_thread_id: c.patient_thread_id,
          handoff_submission_id: c.handoff_submission_id,
          planned_procedure: c.planned_procedure,
          planned_surgery_date: c.planned_surgery_date,
          ot_room: c.ot_room,
          surgeon_id: c.surgeon_id,
          anaesthetist_id: c.anaesthetist_id,
          urgency: c.urgency,
          state: c.state,
          kx_case_id: c.kx_case_id,
          kx_pac_record_id: c.kx_pac_record_id,
          created_at: c.created_at,
          updated_at: c.updated_at,
          created_by: c.created_by,
          archived_at: c.archived_at,
          case_code: caseCode,
        },
        hospital: {
          id: c.hospital_id,
          slug: c.hospital_slug,
          name: c.hospital_name,
          display_name: c.hospital_display_name,
          is_active: c.hospital_is_active,
        },
        patient,
        handoff_submission: handoff,
        state_history: stateHistory,
        pac_events: pacEvents,
        condition_cards: conditionCards,
        equipment_requests: equipmentRequests,
      },
    });
  } catch (error) {
    const e = error as { message?: string; code?: string; detail?: string };
    console.error('GET /api/cases/[id] error:', JSON.stringify({
      message: e.message, code: e.code, detail: e.detail,
    }));
    return NextResponse.json(
      { success: false, error: 'Failed to load case' },
      { status: 500 }
    );
  }
}
