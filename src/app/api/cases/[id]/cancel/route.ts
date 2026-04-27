// ============================================
// POST /api/cases/[id]/cancel
// POST /api/cases/[id]/postpone
//
// Day-of (or earlier) cancellation / postponement with cascade per PRD §8.3:
//   - surgical_cases.state → 'cancelled' | 'postponed'
//   - case_state_events row logged
//   - auto-generated tasks for this case → status='cancelled'
//   - pending condition_cards → status='waived', note prefixed with reason
//   - non-verified_ready equipment_requests → status='cancelled' is NOT a valid
//     equipment status per the CHECK enum; we instead set them to 'requested'
//     (lowest state) and flag auto_verified=false + append reason to notes.
//     Equipment actually-delivered stays as-is (post-op handling is out of scope).
//   - If 'postponed', accept optional new_planned_date to reschedule; otherwise
//     clear planned_surgery_date + ot_room so OT Coordinator can reschedule
//     via the normal /schedule endpoint.
//
// Body:
//   {
//     reason: string,               // required — audit trail
//     new_planned_date?: 'YYYY-MM-DD' // postpone only, optional
//   }
//
// Access: ot_coordinator | ip_coordinator | super_admin
// Tenancy: user_accessible_hospital_ids
//
// Sprint 3 Day 13 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

const CANCEL_ROLES = new Set(['ot_coordinator', 'ip_coordinator', 'super_admin']);
const CANCELLABLE_FROM_STATES = new Set([
  'draft', 'intake', 'pac_scheduled', 'pac_done',
  'fit', 'fit_conds', 'defer', 'unfit',
  'optimizing', 'scheduled', 'confirmed', 'verified',
]);
// in_theatre / completed / already cancelled / already postponed — not cancellable
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CaseRow {
  id: string;
  hospital_id: string;
  state: string;
}

interface Body {
  reason?: string;
  new_planned_date?: string;
}

interface CascadeCounts {
  tasks_cancelled: number;
  condition_cards_waived: number;
  equipment_requests_reset: number;
}

async function runCascade(caseId: string, reason: string, action: 'cancel' | 'postpone'): Promise<CascadeCounts> {
  // 1. Auto-generated tasks → cancelled. Manual tasks left alone (user can
  //    cancel them individually via task UI if they want).
  const tasksRes = await query<{ id: string }>(
    `
    UPDATE tasks
    SET status = 'cancelled',
        completed_at = NOW(),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cascade_reason', $1::text, 'cascade_action', $2::text),
        updated_at = NOW()
    WHERE case_id = $3
      AND source = 'auto'
      AND status IN ('pending', 'in_progress')
    RETURNING id
    `,
    [reason, action, caseId]
  );

  // 2. Pending condition cards → waived with reason. Already-done / already-waived untouched.
  const cardsRes = await query<{ id: string }>(
    `
    UPDATE condition_cards
    SET status = 'waived',
        note = CASE
          WHEN note IS NULL OR note = '' THEN $1::text
          ELSE note || ' | cascade: ' || $1::text
        END,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE case_id = $2
      AND status IN ('pending', 'in_progress')
    RETURNING id
    `,
    [`${action}: ${reason}`, caseId]
  );

  // 3. Equipment requests that are NOT verified_ready → reset to 'requested' + unflag auto-verified.
  //    verified_ready items stay as-is (already in hand, may be returnable to vendor separately).
  const equipRes = await query<{ id: string }>(
    `
    UPDATE equipment_requests
    SET status = 'requested',
        auto_verified = false,
        notes = CASE
          WHEN notes IS NULL OR notes = '' THEN $1::text
          ELSE notes || ' | ' || $1::text
        END,
        updated_at = NOW()
    WHERE case_id = $2
      AND status <> 'verified_ready'
    RETURNING id
    `,
    [`cascade ${action}: ${reason}`, caseId]
  );

  return {
    tasks_cancelled: tasksRes.length,
    condition_cards_waived: cardsRes.length,
    equipment_requests_reset: equipRes.length,
  };
}

async function handle(
  request: NextRequest,
  caseId: string,
  action: 'cancel' | 'postpone'
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
    return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
  }

  if (!CANCEL_ROLES.has(user.role)) {
    return NextResponse.json(
      { success: false, error: `Role ${user.role} cannot ${action} cases. Required: ${[...CANCEL_ROLES].join(' or ')}.` },
      { status: 403 }
    );
  }

  if (!UUID_RE.test(caseId)) {
    return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { success: false, error: 'reason is required (the audit trail needs to say why)' },
      { status: 400 }
    );
  }

  if (action === 'postpone' && body.new_planned_date !== undefined) {
    if (!DATE_RE.test(body.new_planned_date)) {
      return NextResponse.json({ success: false, error: 'new_planned_date must be YYYY-MM-DD' }, { status: 400 });
    }
  }

  // Tenancy + state guard.
  const c = await queryOne<CaseRow>(
    `
    SELECT sc.id, sc.hospital_id, sc.state
    FROM surgical_cases sc
    WHERE sc.id = $1
      AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))
    `,
    [caseId, user.profileId]
  );

  if (!c) {
    return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
  }

  if (!CANCELLABLE_FROM_STATES.has(c.state)) {
    return NextResponse.json(
      {
        success: false,
        error: `Cannot ${action} from state "${c.state}". Case may already be in theatre or closed.`,
        current_state: c.state,
      },
      { status: 409 }
    );
  }

  const newState = action === 'cancel' ? 'cancelled' : 'postponed';

  // Mutations — cascade first so any failure there leaves case state unchanged.
  const cascade = await runCascade(caseId, reason, action);

  // Update surgical_cases.state. For postpone: if new_planned_date provided,
  // set planned_surgery_date to it; otherwise clear both date + room so OT
  // Coordinator reschedules via the normal /schedule flow.
  if (action === 'postpone' && body.new_planned_date) {
    await query(
      `
      UPDATE surgical_cases
      SET state = 'postponed',
          planned_surgery_date = $1::date,
          updated_at = NOW()
      WHERE id = $2
      `,
      [body.new_planned_date, caseId]
    );
  } else if (action === 'postpone') {
    await query(
      `
      UPDATE surgical_cases
      SET state = 'postponed',
          planned_surgery_date = NULL,
          ot_room = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [caseId]
    );
  } else {
    // cancel: keep date/room for historical reference
    await query(
      `UPDATE surgical_cases SET state = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [caseId]
    );
  }

  // case_state_events
  await query(
    `
    INSERT INTO case_state_events
      (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      caseId,
      c.state,
      newState,
      reason,
      user.profileId,
      JSON.stringify({
        via: `api/cases/${action}`,
        cascade,
        new_planned_date: body.new_planned_date ?? null,
      }),
    ]
  );

  try {
    await audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: c.hospital_id,
      action: action === 'cancel' ? 'case.cancel' : 'case.postpone',
      targetType: 'surgical_case',
      targetId: caseId,
      summary: `${action === 'cancel' ? 'Cancelled' : 'Postponed'} case ${caseId}`,
      payloadBefore: { state: c.state },
      payloadAfter: { state: newState, reason },
      request,
      mode: 'guaranteed',
    });
  } catch (auditErr) {
    console.error(`Audit logging failed for ${action}:`, auditErr);
    return NextResponse.json({ success: false, error: 'Audit logging failed; please retry. Mutation may need manual rollback.' }, { status: 503 });
  }

  return NextResponse.json({
    success: true,
    data: {
      transition: { from: c.state, to: newState },
      cascade,
      reason,
      new_planned_date: body.new_planned_date ?? null,
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Use the URL to determine which action (cancel vs postpone). Both routes
    // import this same module — Next.js dispatches by path, so we read the URL.
    const isPostpone = request.nextUrl.pathname.endsWith('/postpone');
    return await handle(request, params.id, isPostpone ? 'postpone' : 'cancel');
  } catch (error) {
    console.error('POST /api/cases/[id]/cancel|postpone error:', error);
    return NextResponse.json(
      { success: false, error: 'Cascade failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
