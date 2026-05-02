// =============================================================================
// POST /api/pac-workspace/[caseId]/orders/[orderId]/result   (PCW2.5)
//
// Result entry endpoint per PRD §5.4. Coordinator submits a structured
// result for a kind='diagnostic' pac_orders row; the endpoint:
//
//   1. Validates the input shape against the registry mapping for the
//      order's order_type.
//   2. Updates the pac_orders row: result_value JSONB, result_received_at
//      timestamp, status='reported'. (PRD §5.4 says reported→reviewed; we
//      use 'reported' for fresh entry — coordinator can mark reviewed later
//      via the existing /orders/[orderId] PATCH.)
//   3. Writes the derived pac_facts rows (e.g. lab.hba1c.value=9.5) using
//      the registry's facts() transformer. supersede-first ensures the
//      latest value wins.
//   4. Calls runAndPersist(caseId, trigger='result_entry') so Layer 3
//      cutoff rules fire immediately. Per PRD §15.4 the new ASA review
//      suggestion lands in the inbox before the toast resolves.
//
// Auth: PAC write roles + super_admin universal pass.
// Audit: pac.diagnostic.result_entered (best-effort).
// Latency budget: <300ms per PRD §5.4. The runAndPersist call dominates
// (~100-200ms at v1 scale).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { audit } from '@/lib/audit';
import {
  getResultMapping,
  FREE_TEXT_FALLBACK,
  type ResultInput,
} from '@/lib/pac-workspace/result-mapping';
import { runAndPersist } from '@/lib/pac-workspace/engine-persistence';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;

interface OrderRow {
  id: string;
  case_id: string;
  order_type: string;
  status: string;
  kind: string | null;
  hospital_id: string;
}

interface RequestBody {
  input: ResultInput;
  notes?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string; orderId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { caseId, orderId } = params;
    if (!UUID_RE.test(caseId) || !UUID_RE.test(orderId)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const body = (await request.json()) as RequestBody;
    if (!body || !body.input || typeof body.input !== 'object' || !body.input.shape) {
      return NextResponse.json({ success: false, error: 'input.shape required' }, { status: 400 });
    }

    // Tenancy + load order
    const order = await queryOne<OrderRow>(
      `SELECT po.id, po.case_id, po.order_type, po.status, po.kind, sc.hospital_id
         FROM pac_orders po
         JOIN surgical_cases sc ON sc.id = po.case_id
        WHERE po.id = $1
          AND po.case_id = $2
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($3::UUID))`,
      [orderId, caseId, user.profileId]
    );
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found or access denied' },
        { status: 404 }
      );
    }

    const mapping = getResultMapping(order.order_type) ?? FREE_TEXT_FALLBACK;

    // Validate input shape against mapping
    if (body.input.shape !== mapping.inputShape) {
      return NextResponse.json(
        {
          success: false,
          error: `input.shape='${body.input.shape}' does not match required '${mapping.inputShape}' for order_type='${order.order_type}'`,
        },
        { status: 400 }
      );
    }

    // Numeric finite-value guards
    if (mapping.inputShape === 'numeric' && body.input.shape === 'numeric') {
      if (!Number.isFinite(body.input.value)) {
        return NextResponse.json({ success: false, error: 'numeric value must be a finite number' }, { status: 400 });
      }
    }
    if (mapping.inputShape === 'numeric_pair' && body.input.shape === 'numeric_pair') {
      if (!Number.isFinite(body.input.systolic) || !Number.isFinite(body.input.diastolic)) {
        return NextResponse.json({ success: false, error: 'systolic + diastolic must be finite numbers' }, { status: 400 });
      }
    }

    // Update pac_orders — capture result_value, result_received_at, status='reported'.
    const updated = await queryOne<{ id: string }>(
      `UPDATE pac_orders
          SET result_value = $2::jsonb,
              result_received_at = NOW(),
              status = CASE WHEN status IN ('cancelled', 'reviewed')
                            THEN status
                            ELSE 'reported' END,
              notes = COALESCE($3, notes)
        WHERE id = $1
        RETURNING id`,
      [orderId, JSON.stringify({ ...body.input, _label: mapping.label }), body.notes ?? null]
    );
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Order update failed' }, { status: 500 });
    }

    // Derive pac_facts rows — supersede-first.
    const facts = mapping.facts(body.input);
    let factsWritten = 0;
    if (facts.length > 0) {
      const keys = facts.map((f) => f.fact_key);
      await sqlQuery(
        `UPDATE pac_facts
            SET superseded_at = NOW()
          WHERE case_id = $1
            AND fact_key = ANY($2::text[])
            AND superseded_at IS NULL`,
        [caseId, keys]
      );
      for (const f of facts) {
        await sqlQuery(
          `INSERT INTO pac_facts
             (case_id, fact_key, fact_value, source_form_type,
              source_form_submission_id, captured_at)
           VALUES ($1, $2, $3::jsonb, $4, NULL, NOW())
           ON CONFLICT (case_id, fact_key, source_form_submission_id) DO NOTHING`,
          [caseId, f.fact_key, JSON.stringify(f.fact_value), 'diagnostic_result']
        );
        factsWritten += 1;
      }
    }

    // Layer 3 fire — recompute the engine. Non-fatal on engine failure;
    // the result is already persisted, so we don't roll back the order.
    let recompute: unknown = null;
    try {
      recompute = await runAndPersist(caseId, { trigger: 'result_entry' });
    } catch (e) {
      console.error(
        '[pcw2.5] result-entry recompute failed (non-fatal):',
        (e as Error).message
      );
    }

    // Audit (best-effort)
    audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: order.hospital_id,
      action: 'pac.diagnostic.result_entered',
      targetType: 'pac_order',
      targetId: order.id,
      summary: `Result entered for ${mapping.label} (${order.order_type})`,
      payloadAfter: {
        order_id: order.id,
        order_type: order.order_type,
        input: body.input,
        facts_written: factsWritten,
        notes: body.notes ?? null,
      },
      request,
    }).catch((e) =>
      console.error('[audit] pac.diagnostic.result_entered failed:', e)
    );

    return NextResponse.json({
      success: true,
      data: {
        orderId: order.id,
        order_type: order.order_type,
        factsWritten,
        recompute,
      },
    });
  } catch (err) {
    console.error('POST /orders/[orderId]/result error:', err);
    return NextResponse.json(
      { success: false, error: 'Result entry failed' },
      { status: 500 }
    );
  }
}
