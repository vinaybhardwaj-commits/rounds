// =============================================================================
// PATCH /api/pac-workspace/[caseId]/clearances/[clearanceId]
//
// Updates clearance status / conditions / notes. Status flow:
//   requested → specialist_reviewing → cleared | cleared_with_conditions | declined
// or → cancelled at any time.
//
// When status reaches a terminal state (cleared / cleared_with_conditions /
// declined / cancelled): closes linked task (status='done').
//
// Body: { status?, conditions_text?, notes? }
//
// Role gate: super_admin + ip_coordinator + pac_coordinator + anesthesiologist
// PCW.2 also lets the assigned_to user update their own clearance regardless of role.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import type { PacClearanceRow, PacClearanceStatus } from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';

const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;
const VALID_STATUSES: readonly PacClearanceStatus[] = [
  'requested', 'specialist_reviewing', 'cleared', 'cleared_with_conditions', 'declined', 'cancelled',
] as const;
const TERMINAL_STATUSES: readonly PacClearanceStatus[] = [
  'cleared', 'cleared_with_conditions', 'declined', 'cancelled',
] as const;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Body {
  status?: PacClearanceStatus;
  conditions_text?: string;
  notes?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { caseId: string; clearanceId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { caseId, clearanceId } = params;
    if (!UUID_RE.test(caseId) || !UUID_RE.test(clearanceId)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const body = (await request.json()) as Body;
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    const guard = await queryOne<{ task_id: string | null; assigned_to: string | null }>(
      `SELECT pc.task_id::text AS task_id, pc.assigned_to::text AS assigned_to
         FROM pac_clearances pc
         JOIN surgical_cases sc ON sc.id = pc.case_id
        WHERE pc.id = $1::uuid AND pc.case_id = $2::uuid
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($3::uuid))`,
      [clearanceId, caseId, user.profileId],
    );
    if (!guard) {
      return NextResponse.json({ success: false, error: 'Clearance not found' }, { status: 404 });
    }

    // Role check: PAC write role OR assigned_to == self.
    const isAssignedSelf = guard.assigned_to === user.profileId;
    if (!hasRole(user.role, PAC_WRITE_ROLES) && !isAssignedSelf) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const respondedClause =
      body.status && TERMINAL_STATUSES.includes(body.status)
        ? 'COALESCE(responded_at, NOW())'
        : 'responded_at';

    const updated = await queryOne<PacClearanceRow>(
      `UPDATE pac_clearances SET
         status          = COALESCE($2, status),
         conditions_text = COALESCE($3, conditions_text),
         notes           = COALESCE($4, notes),
         responded_at    = ${respondedClause}
       WHERE id = $1::uuid
       RETURNING
         id::text AS id, case_id::text AS case_id, specialty, status,
         conditions_text, task_id::text AS task_id,
         assigned_to::text AS assigned_to,
         NULL::text AS assigned_to_name,
         requested_by::text AS requested_by,
         requested_at::text AS requested_at,
         responded_at::text AS responded_at, notes`,
      [clearanceId, body.status ?? null, body.conditions_text ?? null, body.notes ?? null],
    );

    if (updated?.assigned_to) {
      const named = await queryOne<{ full_name: string | null }>(
        `SELECT full_name FROM profiles WHERE id = $1::uuid`,
        [updated.assigned_to],
      );
      updated.assigned_to_name = named?.full_name ?? null;
    }

    if (guard.task_id && body.status && TERMINAL_STATUSES.includes(body.status)) {
      await query(
        `UPDATE tasks SET status = 'done', completed_by = $2::uuid, completed_at = NOW(), updated_at = NOW()
           WHERE id = $1::uuid AND status <> 'done'`,
        [guard.task_id, user.profileId],
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('PATCH clearances/[clearanceId] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update clearance' }, { status: 500 });
  }
}
