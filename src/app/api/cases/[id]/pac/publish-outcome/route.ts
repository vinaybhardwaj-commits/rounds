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
import { audit } from '@/lib/audit';

// 27 Apr 2026 (GLASS.5): clinical role gate removed — every authenticated user
// listed here. Keep the allow-set narrow to the role that actually owns this.
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
    // 25 Apr 2026 (M11 fix): previously 4 separate writes back-to-back under
    // the Neon HTTP driver — no cross-statement transaction, so a failure
    // mid-sequence left pac_events orphaned and a retry wrote duplicates.
    // Now wrapped in a single PL/pgSQL function call (publish_pac_outcome);
    // all four writes share one implicit transaction. The function also
    // guards the UPDATE with 'AND state = p_from_state' so two concurrent
    // anaesthetists publishing in parallel don't stomp each other — the
    // second attempt raises ERRCODE 40001 and we surface a 409 below.
    //
    // See src/lib/migration-pac-publish-stored-proc.sql.

    let spResult:
      | { pac_event_id: string; published_at: string; condition_card_ids: string[] }
      | null = null;
    try {
      const row = await queryOne<{ result: typeof spResult }>(
        `
        SELECT publish_pac_outcome(
          $1::UUID,
          $2::TEXT,
          $3::TEXT,
          $4::UUID,
          $5::TEXT,
          $6::TEXT,
          $7::TEXT[],
          $8::JSONB
        ) AS result
        `,
        [
          caseId,
          c.state,
          body.outcome,
          user.profileId,
          body.notes ?? null,
          body.kx_pac_record_id ?? null,
          conditionCodes,
          JSON.stringify(customConditions),
        ]
      );
      spResult = row?.result ?? null;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      // 40001 = serialization_failure — raised by the SP when the case's
      // state changed between our validation fetch and the UPDATE. Another
      // anaesthetist published first; the client should refetch.
      if (err.code === '40001' || (err.message && err.message.includes('state changed'))) {
        return NextResponse.json(
          {
            success: false,
            error: 'Case state changed while publishing PAC. Reload and try again.',
            current_state: 'unknown',
          },
          { status: 409 }
        );
      }
      throw e;
    }

    if (!spResult) {
      return NextResponse.json(
        { success: false, error: 'PAC publish succeeded on DB but returned no payload' },
        { status: 500 }
      );
    }

        // GLASS.4 audit wiring — GUARANTEED mode (PAC publish is reversible but critical)
    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: c.hospital_id,
        action: 'pac.publish_outcome',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: `PAC outcome published: ${body.outcome}`,
        payloadBefore: { pac_outcome: c.state },
        payloadAfter: { pac_outcome: body.outcome, pac_conditions: conditionCodes.length + customConditions.length > 0 ? 'present' : 'none' },
        request,
        mode: 'guaranteed',
      });
    } catch (auditErr) {
      console.error('[audit:guaranteed] pac.publish_outcome:', auditErr instanceof Error ? auditErr.message : auditErr);
      return NextResponse.json({ success: false, error: 'Audit logging failed; please retry. Mutation may need manual rollback.' }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      data: {
        pac_event: {
          id: spResult.pac_event_id,
          published_at: spResult.published_at,
          outcome: body.outcome,
        },
        transition: { from: c.state, to: body.outcome },
        condition_cards_created: spResult.condition_card_ids ?? [],
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
