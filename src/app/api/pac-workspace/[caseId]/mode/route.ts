// =============================================================================
// PUT /api/pac-workspace/[caseId]/mode
//
// Change the PAC mode on a workspace. Re-seeds checklist_state from the
// matching template (D5 — mode change re-seeds). Idempotent on same-mode PUT.
//
// Role gate (D2): super_admin + ip_coordinator + pac_coordinator + anesthesiologist.
// Audit: best-effort (D13 — only publish is guaranteed).
//
// Body: { mode: 'in_person_opd' | 'bedside' | 'telephonic' | 'paper_screening' }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { hasRole } from '@/lib/roles';
import { seedChecklistFromTemplate } from '@/lib/pac-workspace/checklist';
import type {
  PacMode,
  PacWorkspaceProgressRow,
} from '@/lib/pac-workspace/types';
import { VALID_PAC_MODES } from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';

const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Body {
  mode?: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: PAC write role required' },
        { status: 403 },
      );
    }

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as Body;
    const newMode = (body.mode || '').trim() as PacMode;
    if (!VALID_PAC_MODES.includes(newMode)) {
      return NextResponse.json(
        { success: false, error: `Invalid mode (allowed: ${VALID_PAC_MODES.join(', ')})` },
        { status: 400 },
      );
    }

    // Tenancy + load existing workspace.
    const existing = await queryOne<{
      hospital_id: string;
      pac_mode: PacMode;
      checklist_template: string;
    }>(
      `SELECT
         pwp.hospital_id::text AS hospital_id,
         pwp.pac_mode,
         pwp.checklist_template
       FROM pac_workspace_progress pwp
       JOIN surgical_cases sc ON sc.id = pwp.case_id
       WHERE pwp.case_id = $1::uuid
         AND pwp.archived_at IS NULL
         AND sc.archived_at IS NULL
         AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::uuid))`,
      [caseId, user.profileId],
    );
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Workspace not found' }, { status: 404 });
    }

    // Idempotent: same mode → no-op write.
    if (existing.pac_mode === newMode) {
      const cur = await queryOne<PacWorkspaceProgressRow>(
        `SELECT
           case_id::text AS case_id,
           hospital_id::text AS hospital_id,
           pac_mode,
           sub_state,
           checklist_template,
           checklist_state,
           scheduled_pac_at::text AS scheduled_pac_at,
           ipc_owner_id::text AS ipc_owner_id,
           anaesthetist_id::text AS anaesthetist_id,
           sla_deadline_at::text AS sla_deadline_at,
           created_at::text AS created_at,
           updated_at::text AS updated_at
         FROM pac_workspace_progress
         WHERE case_id = $1::uuid`,
        [caseId],
      );
      return NextResponse.json({ success: true, data: cur, action: 'noop' });
    }

    // Mode is changing → re-seed checklist from new template.
    const { templateCode, items } = await seedChecklistFromTemplate(newMode, existing.hospital_id);

    const updated = await queryOne<PacWorkspaceProgressRow>(
      `UPDATE pac_workspace_progress SET
         pac_mode = $2,
         checklist_template = $3,
         checklist_state = $4::jsonb,
         updated_at = NOW(),
         updated_by = $5
       WHERE case_id = $1::uuid
       RETURNING
         case_id::text AS case_id,
         hospital_id::text AS hospital_id,
         pac_mode,
         sub_state,
         checklist_template,
         checklist_state,
         scheduled_pac_at::text AS scheduled_pac_at,
         ipc_owner_id::text AS ipc_owner_id,
         anaesthetist_id::text AS anaesthetist_id,
         sla_deadline_at::text AS sla_deadline_at,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [caseId, newMode, templateCode, JSON.stringify(items), user.profileId],
    );

    // Best-effort audit (D13).
    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: existing.hospital_id,
        action: 'pac_workspace.mode_changed',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: `PAC mode ${existing.pac_mode} → ${newMode}`,
        payloadBefore: { pac_mode: existing.pac_mode, checklist_template: existing.checklist_template },
        payloadAfter: { pac_mode: newMode, checklist_template: templateCode, checklist_reseeded: true },
        request,
        mode: 'fire_and_forget',
      });
    } catch (auditErr) {
      console.error('[audit:fire_and_forget] pac_workspace.mode_changed:', auditErr instanceof Error ? auditErr.message : auditErr);
    }

    return NextResponse.json({ success: true, data: updated, action: 'updated' });
  } catch (error) {
    console.error('PUT /api/pac-workspace/[caseId]/mode error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update PAC mode' },
      { status: 500 },
    );
  }
}
