// ============================================
// POST /api/cases/[id]/transition
//
// Transitions a surgical_case from one state to another. Sprint 1 Day 5
// implements only the draft→intake transition for the Drafts Inbox; other
// transitions (intake→pac_scheduled, pac_done→fit/conds/defer/unfit, etc.)
// land in Sprint 2.
//
// Invariant: every state mutation on surgical_cases.state is accompanied by
// an INSERT into case_state_events.
//
// Body:
//   { to_state: 'intake', kx_uhid: '...', transition_reason?: string }
//
// Access control:
//   - caller must have access to the case's hospital_id (via
//     user_accessible_hospital_ids)
//   - for draft→intake: caller must have role ip_coordinator OR super_admin
//
// Sprint 1 Day 5 (23 April 2026) — behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';

const INTAKE_ALLOWED_ROLES = new Set(['ip_coordinator', 'super_admin']);

// The only transition implemented today. Keep this map small — Sprint 2 extends it.
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['intake']),
};

interface CaseRow {
  id: string;
  hospital_id: string;
  state: string;
  kx_uhid: string | null;
  patient_thread_id: string;
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

    const { id } = params;
    const body = (await request.json()) as {
      to_state?: string;
      kx_uhid?: string;
      transition_reason?: string;
    };

    if (!body.to_state) {
      return NextResponse.json({ success: false, error: 'to_state is required' }, { status: 400 });
    }

    // Fetch the case + verify tenancy in one shot.
    const c = await queryOne<CaseRow & { kx_uhid_db: string | null }>(
      `
      SELECT sc.id, sc.hospital_id, sc.state, sc.kx_case_id AS kx_uhid_db, sc.patient_thread_id
      FROM surgical_cases sc
      WHERE sc.id = $1
        AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))
      `,
      [id, user.profileId]
    );

    if (!c) {
      return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
    }

    // Validate transition against the allowed map.
    const allowed = ALLOWED_TRANSITIONS[c.state];
    if (!allowed || !allowed.has(body.to_state)) {
      return NextResponse.json(
        {
          success: false,
          error: `Transition not allowed: ${c.state} → ${body.to_state}`,
          allowed_from_current: Array.from(allowed ?? []),
        },
        { status: 409 }
      );
    }

    // Specific gates for draft → intake.
    if (c.state === 'draft' && body.to_state === 'intake') {
      // Role gate per sprint plan + PRD.
      if (!INTAKE_ALLOWED_ROLES.has(user.role)) {
        return NextResponse.json(
          { success: false, error: `Role ${user.role} cannot transition draft → intake. Required: ${[...INTAKE_ALLOWED_ROLES].join(' or ')}.` },
          { status: 403 }
        );
      }
      // KX UHID required to move into intake — this captures the opaque KE patient link.
      if (!body.kx_uhid || !body.kx_uhid.trim()) {
        return NextResponse.json(
          { success: false, error: 'kx_uhid is required to transition from draft to intake' },
          { status: 400 }
        );
      }
    }

    // Perform the mutation. Two writes: update surgical_cases + insert case_state_events.
    // We DON'T wrap in an explicit transaction because the Neon HTTP driver runs each
    // call in its own transaction. If the state update succeeds and the event insert
    // fails, we still have an inconsistency. Accept that for Sprint 1; Sprint 2 wraps
    // this in a stored procedure.
    await sqlQuery(
      `
      UPDATE surgical_cases
      SET state = $1,
          kx_case_id = COALESCE($2, kx_case_id),
          updated_at = NOW()
      WHERE id = $3
      `,
      [body.to_state, body.kx_uhid?.trim() ?? null, id]
    );

    await sqlQuery(
      `
      INSERT INTO case_state_events
        (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        id,
        c.state,
        body.to_state,
        body.transition_reason ?? null,
        user.profileId,
        JSON.stringify({ via: 'api/cases/transition', kx_uhid_set: !!body.kx_uhid }),
      ]
    );

    // Return the updated case.
    const updated = await queryOne<CaseRow>(
      `SELECT id, hospital_id, state, kx_case_id AS kx_uhid, patient_thread_id FROM surgical_cases WHERE id = $1`,
      [id]
    );

    return NextResponse.json({
      success: true,
      data: updated,
      transition: { from: c.state, to: body.to_state },
    });
  } catch (error) {
    console.error('POST /api/cases/[id]/transition error:', error);
    return NextResponse.json(
      { success: false, error: 'Transition failed' },
      { status: 500 }
    );
  }
}
