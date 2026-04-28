// =============================================================================
// POST /api/pac-workspace/[caseId]/orders
//
// Batch-creates pac_orders rows + matching tasks rows for a case. PRD §6.1
// + §7. Tasks are linked via pac_orders.task_id; partial unique index
// idx_tasks_auto_dedup makes retries idempotent at the DB level.
//
// Body: { orders: [{ order_type: string, notes?: string, due_at?: string }] }
// Returns: { created_count, orders: [...] }
//
// Role gate (D2): super_admin + ip_coordinator + pac_coordinator + anesthesiologist.
// Audit: best-effort (D13).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { hasRole } from '@/lib/roles';
import type { PacOrderRow } from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';

const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface OrderInput {
  order_type?: string;
  notes?: string;
  due_at?: string;
}
interface Body {
  orders?: OrderInput[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden: PAC write role required' }, { status: 403 });
    }

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as Body;
    const requested = (body.orders ?? []).filter((o) => typeof o.order_type === 'string' && o.order_type!.trim().length > 0);
    if (requested.length === 0) {
      return NextResponse.json({ success: false, error: 'orders[] required' }, { status: 400 });
    }
    if (requested.length > 50) {
      return NextResponse.json({ success: false, error: 'Max 50 orders per batch' }, { status: 400 });
    }

    const ctx = await queryOne<{
      hospital_id: string;
      patient_thread_id: string | null;
      patient_name: string | null;
    }>(
      `SELECT sc.hospital_id::text AS hospital_id,
              sc.patient_thread_id::text AS patient_thread_id,
              pt.patient_name
         FROM surgical_cases sc
         LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
        WHERE sc.id = $1::uuid
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::uuid))`,
      [caseId, user.profileId],
    );
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
    }

    // Validate requested order_types against catalog (active rows for this hospital).
    const codes = Array.from(new Set(requested.map((o) => o.order_type!.trim())));
    const catalog = await query<{ code: string; label: string }>(
      `SELECT code, label
         FROM pac_order_types
        WHERE active = TRUE
          AND code = ANY($1::text[])
          AND (hospital_id IS NULL OR hospital_id = $2::uuid)`,
      [codes, ctx.hospital_id],
    );
    const labelByCode = new Map(catalog.map((r) => [r.code, r.label]));
    const unknown = codes.filter((c) => !labelByCode.has(c));
    if (unknown.length > 0) {
      return NextResponse.json(
        { success: false, error: `Unknown order types: ${unknown.join(', ')}` },
        { status: 400 },
      );
    }

    const created: PacOrderRow[] = [];
    for (const o of requested) {
      const code = o.order_type!.trim();
      const label = labelByCode.get(code) ?? code;

      // Insert pac_order first (no dedup at this layer — we let the user
      // explicitly re-order). Then create the linked task with source='auto'
      // and source_ref='pac_order:<id>' so retries get the unique-index nop.
      const orderRow = await queryOne<PacOrderRow>(
        `WITH ins AS (
           INSERT INTO pac_orders (case_id, order_type, status, requested_by, notes)
           VALUES ($1::uuid, $2, 'requested', $3::uuid, $4)
           RETURNING *
         )
         SELECT
           ins.id::text AS id,
           ins.case_id::text AS case_id,
           ins.order_type,
           pot.label AS order_label,
           ins.status,
           ins.result_text,
           ins.result_attached_url,
           ins.task_id::text AS task_id,
           ins.requested_by::text AS requested_by,
           ins.requested_at::text AS requested_at,
           ins.reported_at::text AS reported_at,
           ins.reviewed_at::text AS reviewed_at,
           ins.notes
         FROM ins
         LEFT JOIN pac_order_types pot ON pot.code = ins.order_type`,
        [caseId, code, user.profileId, o.notes ?? null],
      );
      if (!orderRow) continue;

      const sourceRef = `pac_order:${orderRow.id}`;
      const dueAt = o.due_at ?? null;

      const task = await queryOne<{ id: string }>(
        `INSERT INTO tasks
           (hospital_id, case_id, patient_thread_id, title, description,
            assignee_profile_id, owner_role, due_at, status, source, source_ref,
            priority, metadata, created_by, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
                 NULL, 'lab_tech', $6::timestamptz, 'pending', 'auto', $7,
                 'normal', $8::jsonb, $9::uuid, NOW(), NOW())
         ON CONFLICT (case_id, source_ref) WHERE source = 'auto' AND case_id IS NOT NULL
         DO NOTHING
         RETURNING id::text AS id`,
        [
          ctx.hospital_id,
          caseId,
          ctx.patient_thread_id,
          `PAC order: ${label}`,
          ctx.patient_name ? `Order for ${ctx.patient_name}` : 'PAC order',
          dueAt,
          sourceRef,
          JSON.stringify({ pac_order_id: orderRow.id, order_type: code, source: 'pac_workspace' }),
          user.profileId,
        ],
      );

      if (task) {
        const linked = await queryOne<PacOrderRow>(
          `WITH upd AS (
             UPDATE pac_orders SET task_id = $2::uuid WHERE id = $1::uuid RETURNING *
           )
           SELECT
             upd.id::text AS id, upd.case_id::text AS case_id, upd.order_type,
             pot.label AS order_label,
             upd.status, upd.result_text, upd.result_attached_url,
             upd.task_id::text AS task_id,
             upd.requested_by::text AS requested_by, upd.requested_at::text AS requested_at,
             upd.reported_at::text AS reported_at, upd.reviewed_at::text AS reviewed_at, upd.notes
           FROM upd
           LEFT JOIN pac_order_types pot ON pot.code = upd.order_type`,
          [orderRow.id, task.id],
        );
        if (linked) {
          created.push(linked);
          continue;
        }
      }
      created.push(orderRow);
    }

    // Best-effort audit (single audit row for the batch).
    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: ctx.hospital_id,
        action: 'pac_workspace.orders_added',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: `Added ${created.length} PAC order(s)`,
        payloadAfter: { order_codes: created.map((o) => o.order_type) },
        request,
        mode: 'fire_and_forget',
      });
    } catch (auditErr) {
      console.error('[audit:fire_and_forget] pac_workspace.orders_added:', auditErr instanceof Error ? auditErr.message : auditErr);
    }

    return NextResponse.json({ success: true, data: { created_count: created.length, orders: created } });
  } catch (error) {
    console.error('POST /api/pac-workspace/[caseId]/orders error:', error);
    return NextResponse.json({ success: false, error: 'Failed to add orders' }, { status: 500 });
  }
}
