// =============================================================================
// PATCH /api/pac-workspace/[caseId]/orders/[orderId]
//
// Updates an order's status / result / notes. Tied to the workflow:
//   requested → sample_drawn → in_lab → reported → reviewed
// or → cancelled at any time.
//
// When status flips to 'sample_drawn', 'in_lab', 'reported': updates linked task.
// When status flips to 'reviewed' or 'cancelled': closes linked task (status='done').
//
// Body: { status?, result_text?, result_attached_url?, notes? }
//
// Role gate (D2): super_admin + ip_coordinator + pac_coordinator + anesthesiologist.
// Lab tech (when their UI ships) will use a different endpoint scoped to their assignment.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import type { PacOrderRow, PacOrderStatus } from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';

const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;
const VALID_STATUSES: readonly PacOrderStatus[] = [
  'requested', 'sample_drawn', 'in_lab', 'reported', 'reviewed', 'cancelled',
] as const;
const TASK_DONE_STATUSES: readonly PacOrderStatus[] = ['reviewed', 'cancelled'] as const;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Body {
  status?: PacOrderStatus;
  result_text?: string;
  result_attached_url?: string;
  notes?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { caseId: string; orderId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { caseId, orderId } = params;
    if (!UUID_RE.test(caseId) || !UUID_RE.test(orderId)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const body = (await request.json()) as Body;
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    // Tenancy guard.
    const guard = await queryOne<{ task_id: string | null }>(
      `SELECT po.task_id::text AS task_id
         FROM pac_orders po
         JOIN surgical_cases sc ON sc.id = po.case_id
        WHERE po.id = $1::uuid AND po.case_id = $2::uuid
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($3::uuid))`,
      [orderId, caseId, user.profileId],
    );
    if (!guard) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const reportedAtClause = body.status === 'reported' ? 'COALESCE(reported_at, NOW())' : 'reported_at';
    const reviewedAtClause = body.status === 'reviewed' ? 'COALESCE(reviewed_at, NOW())' : 'reviewed_at';

    const updated = await queryOne<PacOrderRow>(
      `UPDATE pac_orders SET
         status              = COALESCE($2, status),
         result_text         = COALESCE($3, result_text),
         result_attached_url = COALESCE($4, result_attached_url),
         notes               = COALESCE($5, notes),
         reported_at         = ${reportedAtClause},
         reviewed_at         = ${reviewedAtClause}
       WHERE id = $1::uuid
       RETURNING
         id::text AS id, case_id::text AS case_id, order_type, status,
         result_text, result_attached_url, task_id::text AS task_id,
         requested_by::text AS requested_by, requested_at::text AS requested_at,
         reported_at::text AS reported_at, reviewed_at::text AS reviewed_at, notes`,
      [orderId, body.status ?? null, body.result_text ?? null, body.result_attached_url ?? null, body.notes ?? null],
    );

    // Close linked task when order reaches terminal state.
    if (guard.task_id && body.status && TASK_DONE_STATUSES.includes(body.status)) {
      await query(
        `UPDATE tasks SET status = 'done', completed_by = $2::uuid, completed_at = NOW(), updated_at = NOW()
           WHERE id = $1::uuid AND status <> 'done'`,
        [guard.task_id, user.profileId],
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('PATCH /api/pac-workspace/[caseId]/orders/[orderId] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update order' }, { status: 500 });
  }
}
