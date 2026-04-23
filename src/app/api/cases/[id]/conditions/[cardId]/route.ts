// ============================================
// PATCH /api/cases/[id]/conditions/[cardId]
//
// Mark a condition_card as done or waived. Records completed_at + completed_by
// on the card; writes a note for waivers (required — per Decision D8 you can't
// silently skip a condition, the reason has to be captured).
//
// Also implements the "done cascade" described in the sprint plan §Automation:
// when all condition cards for a case are in terminal state (done OR waived)
// AND the case state is fit_conds or optimizing, nudge the case forward. For
// Day 8 we only fire a hint (case_state_events metadata) — OT Coordinator still
// has to explicitly schedule via POST /schedule. Sprint 3 can add a direct
// auto-transition if desired.
//
// Body:
//   {
//     status: 'done' | 'waived',
//     note?: string         // required when status='waived'
//   }
//
// Access control:
//   - case's hospital_id must be in user_accessible_hospital_ids(caller)
//   - any authenticated user with hospital access can mark done
//   - waivers require ip_coordinator OR super_admin (more weight than done)
//
// Sprint 2 Day 8 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const WAIVE_ROLES = new Set(['ip_coordinator', 'super_admin']);
const VALID_STATUSES = new Set(['done', 'waived']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface CardRow {
  id: string;
  case_id: string;
  status: string;
  library_code: string | null;
  custom_label: string | null;
  hospital_id: string;
  case_state: string;
}

interface PatchBody {
  status?: string;
  note?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; cardId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json(
        { success: false, error: 'Case model is disabled.' },
        { status: 503 }
      );
    }

    const { id: caseId, cardId } = params;
    if (!UUID_RE.test(caseId) || !UUID_RE.test(cardId)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const body = (await request.json()) as PatchBody;

    if (!body.status || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 }
      );
    }

    if (body.status === 'waived') {
      if (!body.note || !body.note.trim()) {
        return NextResponse.json(
          { success: false, error: 'note is required when waiving a condition' },
          { status: 400 }
        );
      }
      if (!WAIVE_ROLES.has(user.role)) {
        return NextResponse.json(
          { success: false, error: `Role ${user.role} cannot waive conditions. Required: ${[...WAIVE_ROLES].join(' or ')}.` },
          { status: 403 }
        );
      }
    }

    // Fetch card + case with tenancy guard. One JOIN so we don't do 2 queries.
    const card = await queryOne<CardRow>(
      `
      SELECT
        cc.id, cc.case_id, cc.status, cc.library_code, cc.custom_label,
        sc.hospital_id, sc.state AS case_state
      FROM condition_cards cc
      JOIN surgical_cases sc ON sc.id = cc.case_id
      WHERE cc.id = $1
        AND cc.case_id = $2
        AND sc.hospital_id = ANY(user_accessible_hospital_ids($3::UUID))
      `,
      [cardId, caseId, user.profileId]
    );

    if (!card) {
      return NextResponse.json(
        { success: false, error: 'Condition card not found or access denied' },
        { status: 404 }
      );
    }

    if (card.status === 'done' || card.status === 'waived') {
      return NextResponse.json(
        { success: false, error: `Condition is already ${card.status}; cannot re-transition` },
        { status: 409 }
      );
    }

    // Update the card.
    await query(
      `
      UPDATE condition_cards
      SET status = $1,
          note = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE note END,
          completed_at = NOW(),
          completed_by = $3,
          updated_at = NOW()
      WHERE id = $4
      `,
      [body.status, body.note ?? null, user.profileId, cardId]
    );

    // Done-cascade hint: if all cards on this case are now terminal AND the
    // case is in fit_conds / optimizing, surface that fact in the response
    // so the UI can nudge OT Coordinator to schedule.
    const openCountRow = await queryOne<{ open_count: number }>(
      `
      SELECT COUNT(*)::int AS open_count
      FROM condition_cards
      WHERE case_id = $1 AND status NOT IN ('done', 'waived')
      `,
      [caseId]
    );
    const allClosed = (openCountRow?.open_count ?? 0) === 0;
    const readyToSchedule = allClosed && (card.case_state === 'fit_conds' || card.case_state === 'optimizing');

    return NextResponse.json({
      success: true,
      data: {
        card_id: cardId,
        new_status: body.status,
        all_conditions_closed: allClosed,
        ready_to_schedule: readyToSchedule,
        case_state: card.case_state,
      },
    });
  } catch (error) {
    console.error('PATCH /api/cases/[id]/conditions/[cardId] error:', error);
    return NextResponse.json(
      { success: false, error: 'Condition card update failed' },
      { status: 500 }
    );
  }
}
