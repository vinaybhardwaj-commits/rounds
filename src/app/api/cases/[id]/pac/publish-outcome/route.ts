// ============================================
// POST /api/cases/[id]/pac/publish-outcome
//
// The anaesthetist's PAC publish action. In one call:
//   1. INSERT a pac_events row (outcome + who + notes + KX record pointer)
//   2. TRANSITION surgical_cases.state to the outcome state (fit / fit_conds /
//      defer / unfit) — logged via case_state_events
//   3. If outcome is fit_conds or defer: auto-create condition_cards for
//      each library code or custom label provided (Decision D8 purity:
//      library_code XOR custom_label, nothing else)
//
// Body:
//   {
//     outcome: 'fit' | 'fit_conds' | 'defer' | 'unfit',
//     condition_ids?: string[],        // pac_condition_library.code entries
//     custom_conditions?: [             // ad-hoc conditions not in library
//       { label: string, note?: string, owner_profile_id?: string }
//     ],
//     notes?: string,                   // anaesthetist's free-text for pac_events
//     kx_pac_record_id?: string         // opaque KE PAC record pointer
//   }
//
// Access control (Decision D7):
//   - caller's role must be 'anesthesiologist' OR 'super_admin' (403 else)
//   - case's hospital_id must be in user_accessible_hospital_ids(caller)
//   - 404 if case not accessible (don't leak existence)
//
// Allowed from-states: intake, pac_scheduled, pac_done. Anything else → 409.
//
// Sprint 2 Day 7 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const PUBLISH_ALLOWED_ROLES = new Set(['anesthesiologist', 'super_admin']);
const VALID_OUTCOMES = new Set(['fit', 'fit_conds', 'defer', 'unfit']);
const PUBLISHABLE_FROM_STATES = new Set(['intake', 'pac_scheduled', 'pac_done']);

interface CaseRow {
  id: string;
  hospital_id: string;
  state: string;
  patient_thread_id: string;
}

interface PubBody {
  outcome?: string;
  condition_ids?: unknown;
  custom_conditions?: unknown;
  notes?: string;
  kx_pac_record_id?: string;
}

interface CustomCondition {
  label: string;
  note?: string;
  owner_profile_id?: string;
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
      return NextResponse.json(
        { success: false, error: 'Case model is disabled (FEATURE_CASE_MODEL_ENABLED=false).' },
        { status: 503 }
      );
    }

    if (!PUBLISH_ALLOWED_ROLES.has(user.role)) {
      return NextResponse.json(
        {
          success: false,
          error: `Role ${user.role} cannot publish PAC outcomes. Required: ${[...PUBLISH_ALLOWED_ROLES].join(' or ')}.`,
        },
        { status: 403 }
      );
    }

    const { id: caseId } = params;
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as PubBody;

    if (!body.outcome || !VALID_OUTCOMES.has(body.outcome)) {
      return NextResponse.json(
        {
          success: false,
          error: `outcome is required and must be one of: ${[...VALID_OUTCOMES].join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate condition payload shape. Only fit_conds and defer consume conditions;
    // for fit we silently ignore any that were sent (shouldn't be, but defensive).
    const rawConditionIds = Array.isArray(body.condition_ids) ? body.condition_ids : [];
    const rawCustoms = Array.isArray(body.custom_conditions) ? body.custom_conditions : [];

    if (body.outcome === 'fit' && (rawConditionIds.length > 0 || rawCustoms.length > 0)) {
      return NextResponse.json(
        { success: false, error: 'outcome "fit" must not carry condition payload' },
        { status: 400 }
      );
    }
    if ((body.outcome === 'fit_conds' || body.outcome === 'defer') &&
        rawConditionIds.length === 0 && rawCustoms.length === 0) {
      return NextResponse.json(
        { success: false, error: `outcome "${body.outcome}" requires at least one condition_id or custom_condition` },
        { status: 400 }
      );
    }

    // Normalize condition payloads.
    const conditionCodes = rawConditionIds.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 100);
    const customConditions: CustomCondition[] = rawCustoms
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map((c) => ({
        label: typeof c.label === 'string' ? c.label.trim() : '',
        note: typeof c.note === 'string' ? c.note : undefined,
        owner_profile_id: typeof c.owner_profile_id === 'string' ? c.owner_profile_id : undefined,
      }))
      .filter((c) => c.label.length > 0 && c.label.length <= 200);

    // Fetch case + tenancy guard.
    const c = await queryOne<CaseRow>(
      `
      SELECT sc.id, sc.hospital_id, sc.state, sc.patient_thread_id
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

    if (!PUBLISHABLE_FROM_STATES.has(c.state)) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot publish PAC outcome from state "${c.state}". Allowed: ${[...PUBLISHABLE_FROM_STATES].join(', ')}.`,
          current_state: c.state,
        },
        { status: 409 }
      );
    }

    // If library codes were provided, verify they exist + are active.
    // Return 400 with the offending code list so the client can surface it.
    if (conditionCodes.length > 0) {
      const valid = await query<{ code: string }>(
        `SELECT code FROM pac_condition_library WHERE code = ANY($1::text[]) AND is_active = true`,
        [conditionCodes]
      );
      const validSet = new Set(valid.map((r) => r.code));
      const unknown = conditionCodes.filter((c) => !validSet.has(c));
      if (unknown.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Unknown or inactive condition codes', unknown_codes: unknown },
          { status: 400 }
        );
      }
    }

    // -------- MUTATIONS BEGIN --------
    // Neon HTTP driver doesn't support a cross-statement transaction. Order
    // matters: write the pac_events row FIRST so that if the state update
    // fails we at least have a record of the publish attempt. Accept partial
    // failure risk for Sprint 2; Sprint 3 can move to a stored procedure.

    // 1. pac_events
    const pacRow = await queryOne<{ id: string; published_at: string }>(
      `
      INSERT INTO pac_events (case_id, anaesthetist_id, outcome, notes, kx_pac_record_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, published_at
      `,
      [
        caseId,
        user.profileId,
        body.outcome,
        body.notes ?? null,
        body.kx_pac_record_id ?? null,
      ]
    );

    // 2. surgical_cases.state → outcome state
    //    Also update the case's kx_pac_record_id pointer for future reference
    //    if the caller provided one (doesn't overwrite existing with NULL).
    await query(
      `
      UPDATE surgical_cases
      SET state = $1,
          kx_pac_record_id = COALESCE($2, kx_pac_record_id),
          updated_at = NOW()
      WHERE id = $3
      `,
      [body.outcome, body.kx_pac_record_id ?? null, caseId]
    );

    // 3. case_state_events — one row per transition
    await query(
      `
      INSERT INTO case_state_events
        (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        caseId,
        c.state,
        body.outcome,
        'pac_publish_outcome',
        user.profileId,
        JSON.stringify({
          via: 'api/cases/pac/publish-outcome',
          pac_event_id: pacRow?.id ?? null,
          condition_count: conditionCodes.length + customConditions.length,
        }),
      ]
    );

    // 4. condition_cards (one per library code + one per custom condition).
    //    D8 purity: library_code XOR custom_label — never both, never neither.
    //    The CT7 CHECK constraint enforces this at the DB level too.
    const insertedCards: string[] = [];
    for (const code of conditionCodes) {
      const row = await queryOne<{ id: string }>(
        `
        INSERT INTO condition_cards (case_id, library_code, custom_label, status, owner_profile_id)
        VALUES ($1, $2, NULL, 'pending', NULL)
        RETURNING id
        `,
        [caseId, code]
      );
      if (row) insertedCards.push(row.id);
    }
    for (const custom of customConditions) {
      const row = await queryOne<{ id: string }>(
        `
        INSERT INTO condition_cards (case_id, library_code, custom_label, status, note, owner_profile_id)
        VALUES ($1, NULL, $2, 'pending', $3, $4)
        RETURNING id
        `,
        [caseId, custom.label, custom.note ?? null, custom.owner_profile_id ?? null]
      );
      if (row) insertedCards.push(row.id);
    }

    return NextResponse.json({
      success: true,
      data: {
        pac_event: {
          id: pacRow?.id ?? null,
          published_at: pacRow?.published_at ?? null,
          outcome: body.outcome,
        },
        transition: { from: c.state, to: body.outcome },
        condition_cards_created: insertedCards,
      },
    });
  } catch (error) {
    console.error('POST /api/cases/[id]/pac/publish-outcome error:', error);
    return NextResponse.json(
      { success: false, error: 'PAC publish failed' },
      { status: 500 }
    );
  }
}
