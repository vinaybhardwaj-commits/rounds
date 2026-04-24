// ============================================
// POST /api/cases/[id]/transition
//
// Generic state-transition endpoint. Handles the "simple" transitions that
// don't need their own specialized endpoint (cancel, postpone, verify,
// schedule, pac publish all have dedicated routes with extra logic).
//
// Every state mutation accompanied by case_state_events insert — invariant.
//
// Body:
//   { to_state: 'intake'|'pac_scheduled'|'pac_done'|'confirmed'|'in_theatre'|'completed',
//     kx_uhid?: string,                 // required for draft → intake
//     transition_reason?: string }
//
// Allowed transitions map (Sprint 3 Day 14 extension — was draft→intake only):
//   draft          → intake               (ip_coordinator + super_admin; requires kx_uhid)
//   intake         → pac_scheduled        (ip_coordinator + super_admin)
//   pac_scheduled  → pac_done             (anesthesiologist + super_admin)
//   scheduled      → confirmed            (ot_coordinator + ip_coordinator + super_admin)
//   confirmed      → verified             (ot_coordinator + ip_coordinator + super_admin)
//   verified       → in_theatre           (ot_coordinator + super_admin)
//   in_theatre     → completed            (ot_coordinator + anesthesiologist + super_admin)
//
// Tenancy: user_accessible_hospital_ids.
//
// Sprint 3 Day 14 (24 April 2026) — behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';

interface TransitionRule {
  allowed_roles: Set<string>;
  require_kx_uhid?: boolean;
  require_reason?: boolean;
}

// Per-transition rules. Key = "{from}→{to}".
const TRANSITION_RULES: Record<string, TransitionRule> = {
  'draft→intake': {
    allowed_roles: new Set(['ip_coordinator', 'super_admin']),
    require_kx_uhid: true,
  },
  'intake→pac_scheduled': {
    allowed_roles: new Set(['ip_coordinator', 'super_admin']),
  },
  // 25 Apr 2026 (H2 fix): remap to existing UserRole enum values. Originals
  // referenced 'resident', 'senior_resident', 'rmo', 'consultant' and the UK
  // spelling 'anaesthesiologist' — none of which are in src/types/index.ts
  // UserRole nor the profiles.role CHECK. Only super_admin was actually able
  // to drive the lifecycle past 'scheduled', which passed V's solo e2e test
  // but blocked every real user.
  //
  // Remap per V 25 Apr 2026 decision (keep enum small, use existing roles):
  //   pac_scheduled→pac_done  : anesthesiologist (US spelling)
  //   confirmed→verified      : ot_coordinator, ip_coordinator  (pre-op check is coordination)
  //   verified→in_theatre     : ot_coordinator                   (OT calls the move)
  //   in_theatre→completed    : ot_coordinator, anesthesiologist (anaesth always present at case end)
  'pac_scheduled→pac_done': {
    allowed_roles: new Set(['anesthesiologist', 'super_admin']),
  },
  'scheduled→confirmed': {
    allowed_roles: new Set(['ot_coordinator', 'ip_coordinator', 'super_admin']),
  },
  'confirmed→verified': {
    allowed_roles: new Set(['ot_coordinator', 'ip_coordinator', 'super_admin']),
  },
  'verified→in_theatre': {
    allowed_roles: new Set(['ot_coordinator', 'super_admin']),
  },
  'in_theatre→completed': {
    allowed_roles: new Set(['ot_coordinator', 'anesthesiologist', 'super_admin']),
    require_reason: false,
  },
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

    const ruleKey = `${c.state}→${body.to_state}`;
    const rule = TRANSITION_RULES[ruleKey];

    if (!rule) {
      // Enumerate allowed destinations from current state for the error body.
      const allowedFromHere = Object.keys(TRANSITION_RULES)
        .filter((k) => k.startsWith(`${c.state}→`))
        .map((k) => k.split('→')[1]);
      return NextResponse.json(
        {
          success: false,
          error: `Transition not allowed: ${c.state} → ${body.to_state}`,
          current_state: c.state,
          allowed_from_current: allowedFromHere,
          hint: allowedFromHere.length === 0
            ? `No simple transitions from "${c.state}" via this endpoint. Use specialized endpoints: /pac/publish-outcome, /schedule, /verify, /cancel, /postpone.`
            : undefined,
        },
        { status: 409 }
      );
    }

    if (!rule.allowed_roles.has(user.role)) {
      return NextResponse.json(
        {
          success: false,
          error: `Role ${user.role} cannot perform ${ruleKey}. Required: ${[...rule.allowed_roles].join(' or ')}.`,
        },
        { status: 403 }
      );
    }

    if (rule.require_kx_uhid && (!body.kx_uhid || !body.kx_uhid.trim())) {
      return NextResponse.json(
        { success: false, error: `kx_uhid is required to transition ${ruleKey}` },
        { status: 400 }
      );
    }

    // Perform the mutation. Update surgical_cases + INSERT case_state_events.
    // For draft → intake, also persist kx_uhid into surgical_cases.kx_case_id.
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
        body.transition_reason ?? ruleKey,
        user.profileId,
        JSON.stringify({ via: 'api/cases/transition', rule: ruleKey, kx_uhid_set: !!body.kx_uhid }),
      ]
    );

    const updated = await queryOne<CaseRow>(
      `SELECT id, hospital_id, state, kx_case_id AS kx_uhid, patient_thread_id FROM surgical_cases WHERE id = $1`,
      [id]
    );

    return NextResponse.json({
      success: true,
      data: updated,
      transition: { from: c.state, to: body.to_state, rule: ruleKey },
    });
  } catch (error) {
    console.error('POST /api/cases/[id]/transition error:', error);
    return NextResponse.json(
      { success: false, error: 'Transition failed' },
      { status: 500 }
    );
  }
}
