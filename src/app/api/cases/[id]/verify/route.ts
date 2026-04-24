// ============================================
// POST /api/cases/[id]/verify
//
// Day-of verification — transitions scheduled/confirmed → verified (state ⑨).
// Writes a `pre_op_verifications` row with the RMO's checklist + any issues
// flagged, and logs the state transition.
//
// Body:
//   {
//     checklist: Record<string, boolean>,  // structured checklist answers
//     issues_flagged?: string              // free-text issues the RMO noticed
//   }
//
// Access control:
//   - role must be resident OR senior_resident OR rmo OR super_admin
//   - tenancy via user_accessible_hospital_ids()
//
// Allowed from-states: scheduled, confirmed. Else 409.
//
// Sprint 3 Day 11 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

// 25 Apr 2026 (H3 fix): same remap as /api/cases/[id]/transition — no 'rmo'
// in enum; verification is coordination work.
const VERIFY_ROLES = new Set(['ot_coordinator', 'ip_coordinator', 'super_admin']);
const VERIFIABLE_FROM_STATES = new Set(['scheduled', 'confirmed']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface CaseRow {
  id: string;
  hospital_id: string;
  state: string;
  patient_thread_id: string;
}

interface VerifyBody {
  checklist?: Record<string, unknown>;
  issues_flagged?: string;
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
        { success: false, error: 'Case model is disabled' },
        { status: 503 }
      );
    }

    if (!VERIFY_ROLES.has(user.role)) {
      return NextResponse.json(
        {
          success: false,
          error: `Role ${user.role} cannot perform day-of verification. Required: ${[...VERIFY_ROLES].join(' or ')}.`,
        },
        { status: 403 }
      );
    }

    const { id: caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as VerifyBody;

    if (!body.checklist || typeof body.checklist !== 'object' || Array.isArray(body.checklist)) {
      return NextResponse.json(
        { success: false, error: 'checklist is required and must be an object' },
        { status: 400 }
      );
    }

    // Sanity check: some minimum number of keys or at least one true. Don't
    // be too strict — PRD §7.9 doesn't mandate any specific fields, just that
    // a structured record is captured.
    const keyCount = Object.keys(body.checklist).length;
    if (keyCount === 0) {
      return NextResponse.json(
        { success: false, error: 'checklist must contain at least one item' },
        { status: 400 }
      );
    }

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

    if (!VERIFIABLE_FROM_STATES.has(c.state)) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot verify from state "${c.state}". Allowed: ${[...VERIFIABLE_FROM_STATES].join(', ')}.`,
          current_state: c.state,
        },
        { status: 409 }
      );
    }

    // Idempotency: if a verification already exists for this case (someone
    // raced us), return 409 rather than duplicating. pre_op_verifications has
    // no unique constraint on case_id so enforce here.
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM pre_op_verifications WHERE case_id = $1 LIMIT 1`,
      [caseId]
    );
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Case already has a pre-op verification', verification_id: existing.id },
        { status: 409 }
      );
    }

    // ---- MUTATIONS ----
    // 1. pre_op_verifications row FIRST (audit-trail-first pattern)
    const vRow = await queryOne<{ id: string; verified_at: string }>(
      `
      INSERT INTO pre_op_verifications
        (case_id, rmo_profile_id, verified_at, checklist, issues_flagged)
      VALUES ($1, $2, NOW(), $3::jsonb, $4)
      RETURNING id, verified_at
      `,
      [
        caseId,
        user.profileId,
        JSON.stringify(body.checklist),
        body.issues_flagged ?? null,
      ]
    );

    // 2. surgical_cases.state → verified
    await query(
      `UPDATE surgical_cases SET state = 'verified', updated_at = NOW() WHERE id = $1`,
      [caseId]
    );

    // 3. case_state_events
    await query(
      `
      INSERT INTO case_state_events
        (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
      VALUES ($1, $2, 'verified', 'day_of_verification', $3, $4::jsonb)
      `,
      [
        caseId,
        c.state,
        user.profileId,
        JSON.stringify({
          via: 'api/cases/verify',
          verification_id: vRow?.id ?? null,
          checklist_item_count: keyCount,
          has_issues: !!body.issues_flagged?.trim(),
        }),
      ]
    );

    return NextResponse.json({
      success: true,
      data: {
        verification: {
          id: vRow?.id ?? null,
          verified_at: vRow?.verified_at ?? null,
          rmo_profile_id: user.profileId,
          issues_flagged: body.issues_flagged ?? null,
        },
        transition: { from: c.state, to: 'verified' },
      },
    });
  } catch (error) {
    console.error('POST /api/cases/[id]/verify error:', error);
    return NextResponse.json(
      { success: false, error: 'Verification failed' },
      { status: 500 }
    );
  }
}
