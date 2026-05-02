// =============================================================================
// POST /api/pac-workspace/[caseId]/suggestions/[suggestionId]/decision (PCW2.4b)
//
// Body: { action: 'accept' | 'skip' | 'already_done', payload?: {...} }
//
// Per PRD §8.3:
//   accept       → INSERT pac_orders|pac_clearances, set suggestion status,
//                  link parent_section_item_id, audit pac.suggestion.accept.
//                  For info_only / asa_review / pac_visit: just mark
//                  accepted (no section row; ASA modal lands in PCW2.9).
//   already_done → INSERT pac_orders|pac_clearances with completed status +
//                  done_at + done_at_source + result_value, mark suggestion
//                  status='already_done', set already_done_evidence, audit.
//                  PCW2.5 will auto-fire Layer 3 result-driven rules when
//                  result_value is entered; for now the engine just doesn't
//                  re-run on already-done write (deferred trigger).
//   skip         → mark suggestion status='skipped' + decision_reason_code +
//                  decision_reason_notes; audit pac.suggestion.skip.
//                  REQUIRED severity must include a structured reason; INFO
//                  has no skip path (UI hides the button).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { audit } from '@/lib/audit';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;

const VALID_SKIP_CODES = new Set([
  'skip.already_external',
  'skip.not_clinically_applicable',
  'skip.anaesthetist_direct_assess',
  'skip.patient_declined',
  'skip.other',
]);

interface DecisionBody {
  action: 'accept' | 'skip' | 'already_done';
  // skip payload
  decision_reason_code?: string;
  decision_reason_notes?: string;
  // already_done payload
  done_at?: string;            // YYYY-MM-DD or ISO
  done_where?: 'ehrc' | 'external';
  result_value?: unknown;       // JSONB
  notes?: string;
}

interface SuggestionRow {
  id: string;
  case_id: string;
  rule_id: string;
  status: string;
  severity: 'required' | 'recommended' | 'info';
  routes_to: string;
  proposed_payload: Record<string, unknown> | null;
  reason_text: string | null;
  hospital_id: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string; suggestionId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const { caseId, suggestionId } = params;
    if (!UUID_RE.test(caseId) || !UUID_RE.test(suggestionId)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const body = (await request.json()) as DecisionBody;
    if (!body.action || !['accept', 'skip', 'already_done'].includes(body.action)) {
      return NextResponse.json({ success: false, error: 'action required' }, { status: 400 });
    }

    // Tenancy + load suggestion
    const sug = await queryOne<SuggestionRow>(
      `SELECT s.id, s.case_id, s.rule_id, s.status, s.severity, s.routes_to,
              s.proposed_payload, s.reason_text, sc.hospital_id
         FROM pac_suggestions s
         JOIN surgical_cases sc ON sc.id = s.case_id
        WHERE s.id = $1
          AND s.case_id = $2
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($3::UUID))`,
      [suggestionId, caseId, user.profileId]
    );
    if (!sug) {
      return NextResponse.json(
        { success: false, error: 'Suggestion not found or access denied' },
        { status: 404 }
      );
    }
    if (sug.status !== 'pending') {
      return NextResponse.json(
        {
          success: false,
          error: `Suggestion is ${sug.status} — only pending suggestions accept decisions`,
        },
        { status: 409 }
      );
    }

    if (body.action === 'skip') {
      return await handleSkip(sug, body, user, request);
    }
    if (body.action === 'already_done') {
      return await handleAlreadyDone(sug, body, user, request);
    }
    return await handleAccept(sug, user, request);
  } catch (err) {
    console.error('POST /suggestions/[id]/decision error:', err);
    return NextResponse.json({ success: false, error: 'Decision failed' }, { status: 500 });
  }
}

// =============================================================================
// accept
// =============================================================================

async function handleAccept(
  sug: SuggestionRow,
  user: { profileId: string; role: string },
  request: NextRequest
): Promise<NextResponse> {
  const payload = sug.proposed_payload ?? {};
  const kind = (payload.kind as string | undefined) ?? null;

  let parentId: string | null = null;
  let summary = `Accepted suggestion ${sug.rule_id}`;

  if (kind === 'diagnostic') {
    const orderType = (payload.orderType as string) || sug.rule_id;
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO pac_orders
         (case_id, order_type, status, kind, requested_by)
       VALUES ($1, $2, 'requested', 'diagnostic', $3)
       RETURNING id`,
      [sug.case_id, orderType, user.profileId]
    );
    parentId = inserted?.id ?? null;
    summary = `Accepted ${sug.rule_id} → diagnostic ${orderType}`;
  } else if (kind === 'order') {
    const orderType = (payload.orderType as string) || sug.rule_id;
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO pac_orders
         (case_id, order_type, status, kind, requested_by)
       VALUES ($1, $2, 'requested', 'order', $3)
       RETURNING id`,
      [sug.case_id, orderType, user.profileId]
    );
    parentId = inserted?.id ?? null;
    summary = `Accepted ${sug.rule_id} → order ${orderType}`;
  } else if (kind === 'clearance') {
    const specialty = (payload.specialty as string) || 'physician';
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO pac_clearances
         (case_id, specialty, status, requested_by)
       VALUES ($1, $2, 'requested', $3)
       RETURNING id`,
      [sug.case_id, specialty, user.profileId]
    );
    parentId = inserted?.id ?? null;
    summary = `Accepted ${sug.rule_id} → clearance ${specialty}`;
  } else if (kind === 'asa_review') {
    // ASA override modal lands in PCW2.9. For now, mark accepted with no
    // section row; PCW2.9 will replace this with an actual ASA PATCH.
    summary = `Acknowledged ASA review suggestion ${sug.rule_id} (modal lands in PCW2.9)`;
  } else if (kind === 'pac_visit') {
    // Scheduling lands in PCW2.7. Mark accepted; nothing to insert yet.
    summary = `Acknowledged PAC visit suggestion ${sug.rule_id} (scheduling lands in PCW2.7)`;
  } else if (kind === 'info_only') {
    summary = `Acknowledged info ${sug.rule_id}`;
  }

  await sqlQuery(
    `UPDATE pac_suggestions
        SET status = 'accepted',
            parent_section_item_id = $2,
            decided_by = $3,
            decided_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [sug.id, parentId, user.profileId]
  );

  audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: sug.hospital_id,
    action: 'pac.suggestion.accept',
    targetType: 'pac_suggestion',
    targetId: sug.id,
    summary,
    payloadAfter: { rule_id: sug.rule_id, parent_section_item_id: parentId, kind },
    request,
  }).catch((e) => console.error('[audit] pac.suggestion.accept failed:', e));

  return NextResponse.json({
    success: true,
    data: { suggestionId: sug.id, parentId, kind, status: 'accepted' },
  });
}

// =============================================================================
// skip
// =============================================================================

async function handleSkip(
  sug: SuggestionRow,
  body: DecisionBody,
  user: { profileId: string; role: string },
  request: NextRequest
): Promise<NextResponse> {
  if (sug.severity === 'info') {
    return NextResponse.json(
      { success: false, error: 'INFO suggestions cannot be skipped — only acknowledged' },
      { status: 400 }
    );
  }
  const code = body.decision_reason_code ?? null;
  if (sug.severity === 'required' && !code) {
    return NextResponse.json(
      { success: false, error: 'decision_reason_code required for skipping a REQUIRED suggestion' },
      { status: 400 }
    );
  }
  if (code && !VALID_SKIP_CODES.has(code)) {
    return NextResponse.json(
      { success: false, error: `Invalid decision_reason_code: ${code}` },
      { status: 400 }
    );
  }
  if (code === 'skip.other' && !body.decision_reason_notes?.trim()) {
    return NextResponse.json(
      { success: false, error: 'decision_reason_notes required when reason code is "other"' },
      { status: 400 }
    );
  }

  await sqlQuery(
    `UPDATE pac_suggestions
        SET status = 'skipped',
            decision_reason_code = $2,
            decision_reason_notes = $3,
            decided_by = $4,
            decided_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [sug.id, code, body.decision_reason_notes ?? null, user.profileId]
  );

  audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: sug.hospital_id,
    action: 'pac.suggestion.skip',
    targetType: 'pac_suggestion',
    targetId: sug.id,
    summary: `Skipped ${sug.rule_id}: ${code ?? 'no-code'}${body.decision_reason_notes ? ` — ${body.decision_reason_notes}` : ''}`,
    payloadAfter: {
      rule_id: sug.rule_id,
      decision_reason_code: code,
      decision_reason_notes: body.decision_reason_notes ?? null,
    },
    request,
  }).catch((e) => console.error('[audit] pac.suggestion.skip failed:', e));

  return NextResponse.json({
    success: true,
    data: { suggestionId: sug.id, status: 'skipped' },
  });
}

// =============================================================================
// already_done
// =============================================================================

async function handleAlreadyDone(
  sug: SuggestionRow,
  body: DecisionBody,
  user: { profileId: string; role: string },
  request: NextRequest
): Promise<NextResponse> {
  if (!body.done_at) {
    return NextResponse.json(
      { success: false, error: 'done_at required (YYYY-MM-DD)' },
      { status: 400 }
    );
  }
  const where = body.done_where === 'external' ? 'external' : 'ehrc';

  const payload = sug.proposed_payload ?? {};
  const kind = (payload.kind as string | undefined) ?? null;

  let parentId: string | null = null;
  if (kind === 'diagnostic' || kind === 'order') {
    const orderType = (payload.orderType as string) || sug.rule_id;
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO pac_orders
         (case_id, order_type, status, kind, requested_by, requested_at,
          done_at, done_at_source, result_value, notes)
       VALUES ($1, $2, 'reviewed', $3, $4, NOW(),
               $5::timestamptz, $6, $7::jsonb, $8)
       RETURNING id`,
      [
        sug.case_id,
        orderType,
        kind === 'diagnostic' ? 'diagnostic' : 'order',
        user.profileId,
        body.done_at,
        where,
        body.result_value !== undefined ? JSON.stringify(body.result_value) : null,
        body.notes ?? null,
      ]
    );
    parentId = inserted?.id ?? null;
  } else if (kind === 'clearance') {
    const specialty = (payload.specialty as string) || 'physician';
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO pac_clearances
         (case_id, specialty, status, requested_by, requested_at,
          responded_at, conditions_text, notes)
       VALUES ($1, $2, 'cleared', $3, NOW(),
               $4::timestamptz, $5, $6)
       RETURNING id`,
      [
        sug.case_id,
        specialty,
        user.profileId,
        body.done_at,
        body.result_value && typeof body.result_value === 'object'
          ? JSON.stringify(body.result_value)
          : null,
        body.notes ?? null,
      ]
    );
    parentId = inserted?.id ?? null;
  } else {
    return NextResponse.json(
      { success: false, error: `Already-done not applicable for kind=${kind}` },
      { status: 400 }
    );
  }

  const evidence = {
    done_at: body.done_at,
    where,
    value: body.result_value ?? null,
    notes: body.notes ?? null,
  };

  await sqlQuery(
    `UPDATE pac_suggestions
        SET status = 'already_done',
            parent_section_item_id = $2,
            already_done_evidence = $3::jsonb,
            decided_by = $4,
            decided_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [sug.id, parentId, JSON.stringify(evidence), user.profileId]
  );

  audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: sug.hospital_id,
    action: 'pac.suggestion.already_done',
    targetType: 'pac_suggestion',
    targetId: sug.id,
    summary: `Already done ${sug.rule_id} on ${body.done_at} (${where})`,
    payloadAfter: { rule_id: sug.rule_id, parent_section_item_id: parentId, evidence },
    request,
  }).catch((e) => console.error('[audit] pac.suggestion.already_done failed:', e));

  return NextResponse.json({
    success: true,
    data: { suggestionId: sug.id, parentId, status: 'already_done' },
  });
}
