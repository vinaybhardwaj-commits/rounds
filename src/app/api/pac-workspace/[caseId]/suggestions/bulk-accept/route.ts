// =============================================================================
// POST /api/pac-workspace/[caseId]/suggestions/bulk-accept   (PCW2.4b)
//
// "Accept all required" footer button per PRD §8.1. Body: { suggestion_ids:
// string[] }. Iterates and runs the same accept logic as the per-suggestion
// endpoint. Per-id failures are returned in the response without aborting
// the rest. Emits one audit row per accepted id (downstream review easier
// than a single bulk audit).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { audit } from '@/lib/audit';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;

interface BulkBody {
  suggestion_ids: string[];
}

interface SuggestionRow {
  id: string;
  case_id: string;
  rule_id: string;
  status: string;
  routes_to: string;
  proposed_payload: Record<string, unknown> | null;
  hospital_id: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as BulkBody;
    const ids = Array.isArray(body?.suggestion_ids) ? body.suggestion_ids : [];
    const valid = ids.filter((id) => UUID_RE.test(id));
    if (valid.length === 0) {
      return NextResponse.json({ success: false, error: 'suggestion_ids required' }, { status: 400 });
    }
    if (valid.length > 100) {
      return NextResponse.json(
        { success: false, error: 'Max 100 suggestions per bulk-accept call' },
        { status: 400 }
      );
    }

    // Tenancy guard at the case level
    const caseRow = await queryOne<{ id: string; hospital_id: string }>(
      `SELECT id, hospital_id FROM surgical_cases
        WHERE id = $1 AND archived_at IS NULL
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [caseId, user.profileId]
    );
    if (!caseRow) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    const accepted: Array<{ id: string; parentId: string | null; kind: string | null }> = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const id of valid) {
      try {
        const sug = await queryOne<SuggestionRow>(
          `SELECT s.id, s.case_id, s.rule_id, s.status, s.routes_to, s.proposed_payload,
                  $3::uuid AS hospital_id
             FROM pac_suggestions s
            WHERE s.id = $1 AND s.case_id = $2 AND s.status = 'pending'`,
          [id, caseId, caseRow.hospital_id]
        );
        if (!sug) {
          failures.push({ id, error: 'not pending or not found' });
          continue;
        }

        const payload = sug.proposed_payload ?? {};
        const kind = (payload.kind as string | undefined) ?? null;
        let parentId: string | null = null;

        if (kind === 'diagnostic' || kind === 'order') {
          const orderType = (payload.orderType as string) || sug.rule_id;
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO pac_orders
               (case_id, order_type, status, kind, requested_by)
             VALUES ($1, $2, 'requested', $3, $4)
             RETURNING id`,
            [sug.case_id, orderType, kind === 'diagnostic' ? 'diagnostic' : 'order', user.profileId]
          );
          parentId = inserted?.id ?? null;
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
        }
        // info_only / asa_review / pac_visit: no section row inserted

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
          hospitalId: caseRow.hospital_id,
          action: 'pac.suggestion.accept',
          targetType: 'pac_suggestion',
          targetId: sug.id,
          summary: `[bulk] Accepted ${sug.rule_id}`,
          payloadAfter: { rule_id: sug.rule_id, parent_section_item_id: parentId, kind, bulk: true },
          request,
        }).catch(() => {});

        accepted.push({ id: sug.id, parentId, kind });
      } catch (e) {
        failures.push({ id, error: (e as Error).message.slice(0, 200) });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        accepted: accepted.length,
        failed: failures.length,
        details: { accepted, failures },
      },
    });
  } catch (err) {
    console.error('POST /suggestions/bulk-accept error:', err);
    return NextResponse.json({ success: false, error: 'Bulk accept failed' }, { status: 500 });
  }
}
