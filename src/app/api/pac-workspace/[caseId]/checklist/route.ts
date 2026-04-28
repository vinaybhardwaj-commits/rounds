// =============================================================================
// PUT /api/pac-workspace/[caseId]/checklist
//
// Updates checklist_state on a workspace. Two operation modes:
//   1. Toggle existing items: { items: [{ id, state, notes? }] }
//   2. Add ad-hoc item:       { add: { label, required? } }
// Both can be passed in the same request.
//
// On tick: stamps actor_id, actor_name, ticked_at = NOW(). On untick: clears
// those fields. Notes are write-through. Day-of-surgery gating is enforced
// server-side: items with gating_condition='day_of_surgery' can't be ticked
// unless surgical_cases.planned_surgery_date == TODAY().
//
// Role gate (D2): super_admin + ip_coordinator + pac_coordinator + anesthesiologist.
// Audit: best-effort.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { hasRole } from '@/lib/roles';
import type {
  PacChecklistItem,
  PacWorkspaceProgressRow,
} from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';

const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;
const VALID_ITEM_STATES: ReadonlySet<PacChecklistItem['state']> = new Set<PacChecklistItem['state']>([
  'pending', 'done', 'na',
]);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface ItemUpdate {
  id?: string;
  state?: PacChecklistItem['state'];
  notes?: string | null;
}

interface AddItem {
  label?: string;
  required?: boolean;
}

interface Body {
  items?: ItemUpdate[];
  add?: AddItem;
}

function adhocId(): string {
  return `adhoc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureItems(value: unknown): PacChecklistItem[] {
  if (Array.isArray(value)) return value as PacChecklistItem[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as PacChecklistItem[];
    } catch {
      /* ignore */
    }
  }
  return [];
}

export async function PUT(
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
    const updates = (body.items ?? []).filter((u) => typeof u.id === 'string');
    const add = body.add;
    if (updates.length === 0 && (!add || !add.label || !add.label.trim())) {
      return NextResponse.json(
        { success: false, error: 'Provide items[] or add{label}' },
        { status: 400 },
      );
    }

    // Tenancy + load existing checklist_state + planned_surgery_date for gating.
    const ctx = await queryOne<{
      hospital_id: string;
      checklist_state: PacChecklistItem[] | string;
      planned_surgery_date: string | null;
    }>(
      `SELECT pwp.hospital_id::text AS hospital_id,
              pwp.checklist_state,
              sc.planned_surgery_date::text AS planned_surgery_date
         FROM pac_workspace_progress pwp
         JOIN surgical_cases sc ON sc.id = pwp.case_id
        WHERE pwp.case_id = $1::uuid
          AND pwp.archived_at IS NULL
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::uuid))`,
      [caseId, user.profileId],
    );
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Workspace not found' }, { status: 404 });
    }

    let items = ensureItems(ctx.checklist_state);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const isDayOfSurgery = ctx.planned_surgery_date === today;
    const nowIso = new Date().toISOString();

    // Apply item updates.
    const itemsById = new Map(items.map((it) => [it.id, it]));
    const blocked: string[] = [];
    const applied: string[] = [];

    for (const u of updates) {
      const cur = itemsById.get(u.id!);
      if (!cur) continue; // Unknown id; ignore silently (stale UI state).
      if (u.state && !VALID_ITEM_STATES.has(u.state)) {
        return NextResponse.json({ success: false, error: `Invalid state for item ${u.id}` }, { status: 400 });
      }

      // Day-of-surgery gating.
      if (
        u.state === 'done' &&
        cur.gating_condition === 'day_of_surgery' &&
        !isDayOfSurgery
      ) {
        blocked.push(cur.id);
        continue;
      }

      if (u.state) cur.state = u.state;
      if (u.state === 'done') {
        cur.actor_id = user.profileId;
        cur.actor_name = user.email;
        cur.ticked_at = nowIso;
      } else if (u.state === 'pending' || u.state === 'na') {
        if (u.state === 'pending') {
          cur.actor_id = null;
          cur.actor_name = null;
          cur.ticked_at = null;
        } else {
          cur.actor_id = user.profileId;
          cur.actor_name = user.email;
          cur.ticked_at = nowIso;
        }
      }
      if (u.notes !== undefined) {
        cur.notes = u.notes && u.notes.trim() ? u.notes.trim() : null;
      }
      applied.push(cur.id);
    }

    // Apply ad-hoc add (after updates so it appends at end).
    if (add && add.label && add.label.trim()) {
      const newItem: PacChecklistItem = {
        id: adhocId(),
        label: add.label.trim().slice(0, 200),
        state: 'pending',
        required: !!add.required,
        gating_condition: null,
        sop_ref: null,
        actor_id: null,
        actor_name: null,
        ticked_at: null,
        notes: null,
      };
      items = [...items, newItem];
      applied.push(newItem.id);
    }

    if (applied.length === 0 && blocked.length > 0) {
      return NextResponse.json(
        { success: false, error: 'All updates blocked by day-of-surgery gating', data: { blocked } },
        { status: 409 },
      );
    }

    const updated = await queryOne<PacWorkspaceProgressRow>(
      `UPDATE pac_workspace_progress SET
         checklist_state = $2::jsonb,
         updated_at = NOW(),
         updated_by = $3
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
      [caseId, JSON.stringify(items), user.profileId],
    );

    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: ctx.hospital_id,
        action: 'pac_workspace.checklist_updated',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: `Checklist updated (${applied.length} item${applied.length === 1 ? '' : 's'}${blocked.length ? `, ${blocked.length} blocked` : ''})`,
        payloadAfter: { applied, blocked },
        request,
        mode: 'fire_and_forget',
      });
    } catch (auditErr) {
      console.error('[audit:fire_and_forget] pac_workspace.checklist_updated:', auditErr instanceof Error ? auditErr.message : auditErr);
    }

    return NextResponse.json({
      success: true,
      data: updated,
      action: 'updated',
      applied,
      blocked,
    });
  } catch (error) {
    console.error('PUT /api/pac-workspace/[caseId]/checklist error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update checklist' }, { status: 500 });
  }
}
