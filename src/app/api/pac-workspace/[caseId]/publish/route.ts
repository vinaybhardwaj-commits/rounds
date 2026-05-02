// =============================================================================
// POST /api/pac-workspace/[caseId]/publish
//
// PCW.4 — Anaesthetist publishes the final PAC outcome from inside the
// workspace, replacing the standalone PacPublishModal callsites (PRD D3).
//
// Per V's D10: outcome + conditions text + notes only. ASA / Mallampati /
// airway live as checklist items, not a structured exam panel.
//
// Operations (atomic via CTE):
//   1. INSERT pac_events row (outcome + actor + notes + KX pointer)
//   2. UPDATE surgical_cases.state = outcome
//   3. INSERT case_state_events (transition log)
//   4. UPDATE pac_workspace_progress.sub_state = 'published', anaesthetist_id = caller
//
// GUARANTEED audit per D13 — if audit() throws, we attempt to rollback the
// state transition + sub_state. Best-effort rollback (we can't truly undo
// the pac_events + case_state_events inserts; we revert state to the
// previous value and log the partial state).
//
// Role gate: anesthesiologist + super_admin (matches existing publish-outcome).
// Allowed from-states: intake, pac_scheduled, pac_done, fit, fit_conds, defer,
// unfit (anaesthetist can re-publish to amend outcome — pac_events tracks
// every publish action).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { hasRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const VALID_OUTCOMES = new Set(['fit', 'fit_conds', 'defer', 'unfit']);
const PUBLISH_ROLES = ['anesthesiologist'] as const;
const PUBLISHABLE_FROM_STATES = new Set([
  'intake', 'pac_scheduled', 'pac_done',
  // Allow re-publish to amend outcome (anaesthetist may revise).
  'fit', 'fit_conds', 'defer', 'unfit',
]);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Body {
  outcome?: string;
  conditions?: string;
  notes?: string;
  kx_pac_record_id?: string;
  // PCW2.11 — gate override per PRD §15.5. When pending REQUIRED suggestions
  // exist, anaesthetist must pass override_pending_required=true with a
  // free-text override_reason; audit pac.publish.override_pending_required
  // captures it.
  override_pending_required?: boolean;
  override_reason?: string;
}

// PCW2.11 — outcome → resolution_state map per PRD §11.
// 'fit' / 'fit_conds' → active_for_surgery (read-only with day-of carve-outs).
// 'defer' → active_for_optimization (workspace stays editable for the
// optimisation work; coordinator continues until anaesthetist re-publishes).
// 'unfit' is treated like defer until manual cancel — surgery isn't
// happening but workspace can't auto-cancel without an explicit decision.
const RESOLUTION_BY_OUTCOME: Record<string, string> = {
  fit: 'active_for_surgery',
  fit_conds: 'active_for_surgery',
  defer: 'active_for_optimization',
  unfit: 'active_for_optimization',
};

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(user.role, PUBLISH_ROLES)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: anesthesiologist or super_admin required' },
        { status: 403 },
      );
    }

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as Body;
    const outcome = (body.outcome || '').trim();
    if (!VALID_OUTCOMES.has(outcome)) {
      return NextResponse.json(
        { success: false, error: `outcome must be one of: ${Array.from(VALID_OUTCOMES).join(', ')}` },
        { status: 400 },
      );
    }

    const conditions = typeof body.conditions === 'string' ? body.conditions.trim() : '';
    if ((outcome === 'fit_conds' || outcome === 'defer') && !conditions) {
      return NextResponse.json(
        { success: false, error: `outcome "${outcome}" requires conditions text` },
        { status: 400 },
      );
    }
    if (outcome === 'fit' && conditions) {
      return NextResponse.json(
        { success: false, error: 'outcome "fit" must not carry conditions text' },
        { status: 400 },
      );
    }

    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const kxPacRecordId = typeof body.kx_pac_record_id === 'string' && body.kx_pac_record_id.trim()
      ? body.kx_pac_record_id.trim()
      : null;

    // Tenancy + load existing state. We also load the current resolution_state
    // off pac_workspace_progress so we can revert it on guaranteed-audit rollback.
    const ctx = await queryOne<{
      hospital_id: string;
      from_state: string;
      patient_thread_id: string | null;
      prior_resolution_state: string | null;
    }>(
      `SELECT sc.hospital_id::text AS hospital_id,
              sc.state AS from_state,
              sc.patient_thread_id::text AS patient_thread_id,
              pwp.resolution_state AS prior_resolution_state
         FROM surgical_cases sc
         LEFT JOIN pac_workspace_progress pwp ON pwp.case_id = sc.id
        WHERE sc.id = $1::uuid
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::uuid))`,
      [caseId, user.profileId],
    );
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
    }
    if (!PUBLISHABLE_FROM_STATES.has(ctx.from_state)) {
      return NextResponse.json(
        { success: false, error: `Cannot publish from state '${ctx.from_state}'` },
        { status: 409 },
      );
    }

    // PCW2.11 — pending REQUIRED suggestions gate per PRD §15.5.
    // Hard block unless anaesthetist passes override_pending_required=true +
    // an override_reason. Soft warn-only on RECOMMENDED — those don't gate.
    const pendingReq = await queryOne<{ n: number; rules: string[] }>(
      `SELECT COUNT(*)::int AS n,
              COALESCE(array_agg(rule_id ORDER BY rule_id), ARRAY[]::text[]) AS rules
         FROM pac_suggestions
        WHERE case_id = $1
          AND status = 'pending'
          AND severity = 'required'`,
      [caseId]
    );
    const pendingRequiredCount = pendingReq?.n ?? 0;
    if (pendingRequiredCount > 0) {
      if (!body.override_pending_required) {
        return NextResponse.json(
          {
            success: false,
            error: `${pendingRequiredCount} REQUIRED suggestions still pending; pass override_pending_required=true + override_reason to publish anyway.`,
            data: {
              pending_required_count: pendingRequiredCount,
              pending_required_rules: pendingReq?.rules ?? [],
            },
          },
          { status: 409 },
        );
      }
      if (!body.override_reason || body.override_reason.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'override_reason required when override_pending_required=true' },
          { status: 400 },
        );
      }
      // Override audit row (separate from the success audit below). Best-effort.
      audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: ctx.hospital_id,
        action: 'pac.publish.override_pending_required',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: `Anaesthetist override: published with ${pendingRequiredCount} REQUIRED pending — ${body.override_reason.trim()}`,
        payloadAfter: {
          pending_required_count: pendingRequiredCount,
          pending_required_rules: pendingReq?.rules ?? [],
          override_reason: body.override_reason.trim(),
          outcome,
        },
        request,
      }).catch((e) => console.error('[audit] pac.publish.override_pending_required failed:', e));
    }

    // Atomic publish via CTE — pac_events + state transition + sub_state update + log.
    // Conditions text is folded into the pac_events.notes column as a structured prefix
    // so historic queries still see the same row shape; the workspace stores it
    // separately on the most recent row of pac_clearances when applicable (PCW.2 path).
    const eventsNotes = conditions
      ? notes
        ? `Conditions: ${conditions}\n\n${notes}`
        : `Conditions: ${conditions}`
      : (notes || null);

    const result = await queryOne<{
      from_state: string;
      to_state: string;
      sub_state: string;
      resolution_state: string;
    }>(
      `WITH pe AS (
         INSERT INTO pac_events (case_id, anaesthetist_id, outcome, notes, kx_pac_record_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5)
         RETURNING id, case_id
       ),
       sc_upd AS (
         UPDATE surgical_cases
            SET state = $3, updated_at = NOW()
          WHERE id = (SELECT case_id FROM pe)
            AND state = $6
          RETURNING id, state
       ),
       cse AS (
         INSERT INTO case_state_events
           (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
         SELECT id, $6, state, 'pac_workspace.publish', $2::uuid,
                jsonb_build_object('via', 'POST /api/pac-workspace/publish', 'has_conditions', $7::bool)
           FROM sc_upd
         RETURNING case_id
       ),
       pwp AS (
         UPDATE pac_workspace_progress
            SET sub_state        = 'published',
                anaesthetist_id  = COALESCE(anaesthetist_id, $2::uuid),
                resolution_state = $8,
                updated_at       = NOW(),
                updated_by       = $2::uuid
          WHERE case_id = (SELECT case_id FROM pe)
          RETURNING sub_state, resolution_state
       )
       SELECT $6 AS from_state,
              sc_upd.state AS to_state,
              COALESCE(pwp.sub_state, 'published') AS sub_state,
              COALESCE(pwp.resolution_state, $8) AS resolution_state
         FROM sc_upd
         LEFT JOIN pwp ON TRUE`,
      [
        caseId,
        user.profileId,
        outcome,
        eventsNotes,
        kxPacRecordId,
        ctx.from_state,
        !!conditions,
        RESOLUTION_BY_OUTCOME[outcome],
      ],
    );

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Publish failed (state transition rejected)' },
        { status: 500 },
      );
    }

    // GLASS.4 GUARANTEED audit — if audit fails, rollback to pre-publish state.
    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: ctx.hospital_id,
        action: 'pac_workspace.publish',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: `Anaesthetist published PAC outcome: ${outcome}`,
        payloadBefore: {
          state: ctx.from_state,
          sub_state: 'pre_publish',
          resolution_state: ctx.prior_resolution_state,
        },
        payloadAfter: {
          state: outcome,
          sub_state: 'published',
          has_conditions: !!conditions,
          resolution_state: RESOLUTION_BY_OUTCOME[outcome],
          pending_required_overridden: !!body.override_pending_required,
        },
        request,
        mode: 'guaranteed',
      });
    } catch (auditErr) {
      console.error('[audit:guaranteed] pac_workspace.publish:', auditErr instanceof Error ? auditErr.message : auditErr);
      // Best-effort rollback. We can't undo pac_events insert (it's a log table —
      // having a stale-but-real publish record is acceptable for forensics), but
      // we revert the case state and workspace sub_state.
      try {
        await query(
          `UPDATE surgical_cases SET state = $2, updated_at = NOW() WHERE id = $1::uuid AND state = $3`,
          [caseId, ctx.from_state, outcome],
        );
        await query(
          `UPDATE pac_workspace_progress
              SET sub_state        = 'anaesthetist_examined',
                  resolution_state = $2,
                  updated_at       = NOW()
            WHERE case_id = $1::uuid AND sub_state = 'published'`,
          [caseId, ctx.prior_resolution_state],
        );
      } catch (rbErr) {
        console.error('[audit:guaranteed] rollback failed too:', rbErr instanceof Error ? rbErr.message : rbErr);
      }
      return NextResponse.json(
        { success: false, error: 'Audit logging failed; publish rolled back. Please retry.' },
        { status: 503 },
      );
    }

    // 1 May 2026 (sub-sprint B): keep the legacy patient_threads.pac_status
    // field in sync as a denormalized cache. Reports / queries that read it
    // continue to work; the workspace remains the source of truth via
    // surgical_cases.state. Only stamps on cleared outcomes (fit / fit_conds);
    // defer and unfit don't map cleanly to the legacy 4-value enum
    // (telemed_pac_pending / inpatient_pac_pending / telemed_pac_passed /
    // inpatient_pac_passed) and are left for the caller to manage.
    // Failure here is non-fatal — the workspace state is correct and the
    // sync can be re-run from any subsequent publish.
    if ((outcome === 'fit' || outcome === 'fit_conds') && ctx.patient_thread_id) {
      try {
        const wp = await queryOne<{ mode: string | null }>(
          `SELECT mode FROM pac_workspace_progress WHERE case_id = $1::uuid LIMIT 1`,
          [caseId],
        );
        const isRemote = wp?.mode === 'telephonic_video' || wp?.mode === 'paper_questionnaire';
        const newPacStatus = isRemote ? 'telemed_pac_passed' : 'inpatient_pac_passed';
        await query(
          `UPDATE patient_threads SET pac_status = $1, updated_at = NOW() WHERE id = $2::uuid`,
          [newPacStatus, ctx.patient_thread_id],
        );
      } catch (syncErr) {
        console.warn(
          '[pac_status sync] non-fatal; workspace state is canonical:',
          syncErr instanceof Error ? syncErr.message : syncErr,
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        case_id: caseId,
        outcome,
        from_state: result.from_state,
        to_state: result.to_state,
        sub_state: result.sub_state,
        resolution_state: result.resolution_state,
      },
    });
  } catch (error) {
    console.error('POST /api/pac-workspace/[caseId]/publish error:', error);
    return NextResponse.json({ success: false, error: 'Failed to publish PAC outcome' }, { status: 500 });
  }
}
