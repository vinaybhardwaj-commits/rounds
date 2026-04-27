// =============================================================================
// PATCH  /api/chat-tasks/[id]   — edit task (assigner / super_admin)
// DELETE /api/chat-tasks/[id]   — cancel task (assigner / super_admin)
//
// CT.4 — Chat Tasks PRD v1.4 §6.4 + §6.5.
//
// PATCH body (any subset of editable fields):
//   { title?, description?, assignee_profile_id?, due_at?, priority?, patient_thread_id? }
//
// Permissions:
//   - PATCH: only assigner or super_admin can edit. Assignee cannot reassign
//            to someone else.
//   - DELETE: only assigner or super_admin.
//
// On every change: appends an entry to tasks.metadata.edit_history with
// { at, by, changes: { field: [old, new] }, note? } and re-syncs the
// Stream card via syncChatTaskCard.
//
// Reassignment is handled here too — change assignee_profile_id via PATCH.
// New assignee must have access to the task's hospital (same guard as CT.3).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { withApiTelemetry } from '@/lib/api-telemetry';
import { getCurrentUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { query, queryOne } from '@/lib/db';
import { syncChatTaskCard } from '@/lib/chat-tasks-card-sync';
import { audit } from '@/lib/audit';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

interface PatchBody {
  title?: string;
  description?: string | null;
  assignee_profile_id?: string;
  due_at?: string | null;
  priority?: string;
  patient_thread_id?: string | null;
  note?: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  assignee_profile_id: string | null;
  created_by: string | null;
  hospital_id: string;
  status: string;
  due_at: string | null;
  priority: string;
  patient_thread_id: string | null;
  metadata: Record<string, unknown> | null;
}

function isAuthorizedToMutate(user: { profileId: string; role: string | null }, task: TaskRow): boolean {
  if (task.created_by === user.profileId) return true;
  if (user.role === 'super_admin' || hasRole(user.role, new Set(['super_admin']))) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH — edit
// ─────────────────────────────────────────────────────────────────────────

async function PATCH_inner(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid task id' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Tenancy + load.
  const task = await queryOne<TaskRow>(
    `SELECT id, title, description, assignee_profile_id, created_by, hospital_id,
            status, due_at, priority, patient_thread_id, metadata
       FROM tasks
      WHERE id = $1
        AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
    [id, user.profileId]
  );
  if (!task) {
    return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 });
  }

  if (!isAuthorizedToMutate(user, task)) {
    return NextResponse.json(
      { success: false, error: 'Only the assigner or super_admin can edit this task' },
      { status: 403 }
    );
  }

  if (task.status === 'cancelled' || task.status === 'done') {
    return NextResponse.json(
      { success: false, error: `Task is ${task.status} — cannot edit a closed task` },
      { status: 409 }
    );
  }

  // ── Validate + collect fields to update ─────────────────────────────────
  const sets: string[] = [];
  const args: unknown[] = [];
  const changes: Record<string, [unknown, unknown]> = {};

  if (body.title !== undefined) {
    const newTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (!newTitle || newTitle.length > 200) {
      return NextResponse.json({ success: false, error: 'title required, max 200 chars' }, { status: 400 });
    }
    if (newTitle !== task.title) {
      args.push(newTitle);
      sets.push(`title = $${args.length}`);
      changes.title = [task.title, newTitle];
    }
  }
  if (body.description !== undefined) {
    const newDesc = body.description === null
      ? null
      : (typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : null);
    if (newDesc !== task.description) {
      args.push(newDesc);
      sets.push(`description = $${args.length}`);
      changes.description = [task.description, newDesc];
    }
  }
  if (body.priority !== undefined) {
    if (!VALID_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ success: false, error: 'Invalid priority' }, { status: 400 });
    }
    if (body.priority !== task.priority) {
      args.push(body.priority);
      sets.push(`priority = $${args.length}`);
      changes.priority = [task.priority, body.priority];
    }
  }
  if (body.due_at !== undefined) {
    const newDue = body.due_at === null
      ? null
      : (typeof body.due_at === 'string' ? body.due_at : null);
    if (newDue !== task.due_at) {
      args.push(newDue);
      sets.push(`due_at = $${args.length}::TIMESTAMPTZ`);
      changes.due_at = [task.due_at, newDue];
    }
  }
  if (body.assignee_profile_id !== undefined) {
    if (typeof body.assignee_profile_id !== 'string' || !UUID_RE.test(body.assignee_profile_id)) {
      return NextResponse.json({ success: false, error: 'Invalid assignee_profile_id' }, { status: 400 });
    }
    if (body.assignee_profile_id !== task.assignee_profile_id) {
      // Check new assignee can access the task's hospital.
      const accessOk = await queryOne<{ ok: boolean }>(
        `SELECT $1::UUID = ANY(user_accessible_hospital_ids($2::UUID)) AS ok`,
        [task.hospital_id, body.assignee_profile_id]
      );
      if (!accessOk?.ok) {
        return NextResponse.json(
          { success: false, error: 'New assignee is not in this task hospital (ID mismatch) — they cannot see this task' },
          { status: 403 }
        );
      }
      args.push(body.assignee_profile_id);
      sets.push(`assignee_profile_id = $${args.length}::UUID`);
      changes.assignee_profile_id = [task.assignee_profile_id, body.assignee_profile_id];
    }
  }
  if (body.patient_thread_id !== undefined) {
    const newPid = body.patient_thread_id === null ? null : body.patient_thread_id;
    if (newPid !== null && !UUID_RE.test(newPid)) {
      return NextResponse.json({ success: false, error: 'Invalid patient_thread_id' }, { status: 400 });
    }
    if (newPid !== null) {
      // Verify patient is in the task's hospital + caller has access.
      const ok = await queryOne<{ ok: boolean }>(
        `SELECT (hospital_id = $1::UUID
                 AND archived_at IS NULL
                 AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))) AS ok
           FROM patient_threads WHERE id = $3`,
        [task.hospital_id, user.profileId, newPid]
      );
      if (!ok?.ok) {
        return NextResponse.json(
          { success: false, error: 'Patient not accessible or not in this task hospital (ID mismatch)' },
          { status: 403 }
        );
      }
    }
    if (newPid !== task.patient_thread_id) {
      args.push(newPid);
      sets.push(`patient_thread_id = $${args.length}::UUID`);
      changes.patient_thread_id = [task.patient_thread_id, newPid];
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ success: true, action: 'noop', data: { id, message: 'No editable fields changed' } });
  }

  // Append to edit_history in metadata.
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
  const editEntry = JSON.stringify({
    at: new Date().toISOString(),
    by: user.profileId,
    changes,
    note,
  });
  args.push(editEntry);
  sets.push(
    `metadata = COALESCE(metadata, '{}'::jsonb) ||
                jsonb_build_object(
                  'edit_history',
                  COALESCE(metadata->'edit_history', '[]'::jsonb) ||
                  jsonb_build_array($${args.length}::jsonb)
                ),
     updated_at = NOW()`
  );
  args.push(id);

  await query(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${args.length}`,
    args
  );

    // GLASS.4 audit wiring — fire_and_forget (derive action from status change)
  const action = (() => {
    if (changes.status) {
      const [_oldStatus, newStatus] = changes.status as [string, string];
      if (newStatus === 'acknowledged') return 'task.acknowledge';
      if (newStatus === 'in_progress' || newStatus === 'started') return 'task.start';
      if (newStatus === 'completed') return 'task.complete';
      if (newStatus === 'cancelled') return 'task.cancel';
    }
    return 'task.update';
  })();
  await audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: task.hospital_id,
    action,
    targetType: 'task',
    targetId: id,
    summary: `Task updated: ${changes.title ? 'title' : Object.keys(changes).join(', ')}`,
    payloadBefore: Object.fromEntries(Object.entries(changes).map(([k, [v]]) => [k, v])),
    payloadAfter: Object.fromEntries(Object.entries(changes).map(([k, [, v]]) => [k, v])),
    request,
  }).catch((e) => console.error('[audit] task.update failed (fire_and_forget):', e instanceof Error ? e.message : e));

  // Sync the Stream card (non-fatal).
  syncChatTaskCard(id).catch((e) => {
    console.error('[chat-tasks edit] card sync failed (non-fatal):', e instanceof Error ? e.message : e);
  });

  return NextResponse.json({
    success: true,
    action: 'updated',
    data: { id, fields_changed: Object.keys(changes) },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE — cancel
// ─────────────────────────────────────────────────────────────────────────

async function DELETE_inner(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid task id' }, { status: 400 });
  }

  const task = await queryOne<TaskRow>(
    `SELECT id, title, description, assignee_profile_id, created_by, hospital_id,
            status, due_at, priority, patient_thread_id, metadata
       FROM tasks
      WHERE id = $1
        AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
    [id, user.profileId]
  );
  if (!task) {
    return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 });
  }

  if (!isAuthorizedToMutate(user, task)) {
    return NextResponse.json(
      { success: false, error: 'Only the assigner or super_admin can cancel this task' },
      { status: 403 }
    );
  }

  if (task.status === 'cancelled') {
    return NextResponse.json({ success: true, action: 'noop', data: { id, already_cancelled: true } });
  }
  if (task.status === 'done') {
    return NextResponse.json(
      { success: false, error: 'Task is done — cannot cancel a completed task' },
      { status: 409 }
    );
  }

  const cancelEntry = JSON.stringify({
    at: new Date().toISOString(),
    by: user.profileId,
    changes: { status: [task.status, 'cancelled'] },
    note: 'cancelled via DELETE /api/chat-tasks/[id]',
  });
  await query(
    `UPDATE tasks
       SET status = 'cancelled',
           metadata = COALESCE(metadata, '{}'::jsonb) ||
                      jsonb_build_object(
                        'edit_history',
                        COALESCE(metadata->'edit_history', '[]'::jsonb) ||
                        jsonb_build_array($1::jsonb)
                      ),
           updated_at = NOW()
     WHERE id = $2`,
    [cancelEntry, id]
  );

  syncChatTaskCard(id).catch((e) => {
    console.error('[chat-tasks delete] card sync failed (non-fatal):', e instanceof Error ? e.message : e);
  });

  return NextResponse.json({ success: true, action: 'cancelled', data: { id } });
}

// ─────────────────────────────────────────────────────────────────────────
// GET — read one (used by the renderer's orphan-card defense, PRD §6.2)
// ─────────────────────────────────────────────────────────────────────────

async function GET_inner(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid task id' }, { status: 400 });
  }

  const task = await queryOne<TaskRow & {
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_at: string | null;
    posted_message_id: string | null;
  }>(
    `SELECT id, title, description, status, priority, due_at,
            assignee_profile_id, created_by, hospital_id,
            patient_thread_id, posted_message_id, metadata
       FROM tasks
      WHERE id = $1
        AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
    [id, user.profileId]
  );
  if (!task) {
    return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: task });
}

// AP.3 — telemetry-wrapped exports (auto-applied)
export const DELETE = withApiTelemetry('/api/chat-tasks/[id]', DELETE_inner);
export const GET = withApiTelemetry('/api/chat-tasks/[id]', GET_inner);
export const PATCH = withApiTelemetry('/api/chat-tasks/[id]', PATCH_inner);
