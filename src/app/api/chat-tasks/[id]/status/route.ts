// =============================================================================
// PATCH /api/chat-tasks/[id]/status  (CT.4 — Chat Tasks PRD v1.4 §6.3)
//
// Mutates a chat-task's status (acknowledged / in_progress / done /
// cancelled). State machine:
//
//   pending → acknowledged   (assignee marks ack — actually a metadata flag,
//                             status stays 'pending' per PRD §5.2)
//   pending|acknowledged → in_progress
//   in_progress → done
//   any active → cancelled    (assigner / super_admin only; see PATCH /[id])
//
//   done → in_progress       → 409
//   cancelled → in_progress  → 409
//
// Permissions (PRD §8.2):
//   - Acknowledge: assignee only
//   - in_progress / done: assignee, assigner, super_admin
//   - cancelled: not via this route — use DELETE /api/chat-tasks/[id]
//
// On success: re-renders the channel card + DM ping (if any) via syncChatTaskCard.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { query, queryOne } from '@/lib/db';
import { syncChatTaskCard } from '@/lib/chat-tasks-card-sync';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_INPUTS = new Set(['acknowledged', 'in_progress', 'done']);
// Valid TASK STATUS column values (acknowledge maps to metadata, not status).
const VALID_STATUS_COLUMN = new Set(['pending', 'in_progress', 'done', 'cancelled']);

interface PatchBody {
  status?: string;
  note?: string;
}

interface TaskRow {
  id: string;
  status: string;
  assignee_profile_id: string | null;
  created_by: string | null;
  hospital_id: string;
  metadata: Record<string, unknown> | null;
}

export async function PATCH(
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
  if (!body.status || typeof body.status !== 'string' || !VALID_INPUTS.has(body.status)) {
    return NextResponse.json(
      { success: false, error: `status must be one of: ${[...VALID_INPUTS].join(', ')}` },
      { status: 400 }
    );
  }
  const targetStatus = body.status;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;

  // Tenancy + load.
  const task = await queryOne<TaskRow>(
    `SELECT id, status, assignee_profile_id, created_by, hospital_id, metadata
       FROM tasks
      WHERE id = $1
        AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
    [id, user.profileId]
  );
  if (!task) {
    return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 });
  }

  if (!VALID_STATUS_COLUMN.has(task.status)) {
    // Defensive: shouldn't happen but if the DB ever holds a non-enum value
    // we don't want a silent transition through.
    return NextResponse.json({ success: false, error: `Task is in unknown state '${task.status}'` }, { status: 500 });
  }

  // ── Permission gate ─────────────────────────────────────────────────────
  const isAssignee = task.assignee_profile_id === user.profileId;
  const isAssigner = task.created_by === user.profileId;
  const isSuper = user.role === 'super_admin' || hasRole(user.role, new Set(['super_admin']));

  if (targetStatus === 'acknowledged') {
    if (!isAssignee && !isSuper) {
      return NextResponse.json(
        { success: false, error: 'Only the assignee can acknowledge a task' },
        { status: 403 }
      );
    }
  } else if (targetStatus === 'in_progress' || targetStatus === 'done') {
    if (!isAssignee && !isAssigner && !isSuper) {
      return NextResponse.json(
        { success: false, error: 'Only the assignee, assigner, or super_admin can change status' },
        { status: 403 }
      );
    }
  }

  // ── State-machine guards ────────────────────────────────────────────────
  if (task.status === 'cancelled') {
    return NextResponse.json(
      { success: false, error: 'Task is cancelled — cannot change status. Create a new task.' },
      { status: 409 }
    );
  }
  if (task.status === 'done' && targetStatus !== 'done') {
    return NextResponse.json(
      { success: false, error: `Task is done — cannot transition to '${targetStatus}'` },
      { status: 409 }
    );
  }

  // ── Apply mutation ──────────────────────────────────────────────────────
  if (targetStatus === 'acknowledged') {
    // Acknowledge: status column stays the same; metadata.acknowledged_at +
    // _by are stamped (PRD §5.2). Idempotent — re-acknowledging is a no-op.
    if (task.metadata && (task.metadata as Record<string, unknown>).acknowledged_at) {
      return NextResponse.json({
        success: true,
        action: 'noop',
        data: { id: task.id, status: task.status, already_acknowledged: true },
      });
    }
    const ackPayload = JSON.stringify({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: user.profileId,
    });
    await query(
      `UPDATE tasks
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
       WHERE id = $2`,
      [ackPayload, id]
    );
  } else {
    // status column transition. 'done' also sets completed_*.
    const completedFields = targetStatus === 'done'
      ? `, completed_by = $4::UUID, completed_at = NOW()`
      : '';
    const editAppendBase = {
      at: new Date().toISOString(),
      by: user.profileId,
      changes: { status: [task.status, targetStatus] },
      note,
    };
    const historyAppend = JSON.stringify({ edit_history: [editAppendBase] });
    const params: unknown[] = [targetStatus, historyAppend, id];
    if (targetStatus === 'done') params.push(user.profileId);

    await query(
      `UPDATE tasks
         SET status = $1::TEXT,
             metadata = COALESCE(metadata, '{}'::jsonb) ||
                        jsonb_build_object(
                          'edit_history',
                          COALESCE(metadata->'edit_history', '[]'::jsonb) ||
                          ($2::jsonb)->'edit_history'
                        )
             ${completedFields},
             updated_at = NOW()
       WHERE id = $3`,
      params
    );
  }

  // ── Sync the Stream card (non-fatal) ────────────────────────────────────
  syncChatTaskCard(id).catch((e) => {
    console.error('[chat-tasks status] card sync failed (non-fatal):', e instanceof Error ? e.message : e);
  });

  return NextResponse.json({
    success: true,
    action: 'updated',
    data: {
      id,
      previous_status: task.status,
      new_status: targetStatus === 'acknowledged' ? task.status : targetStatus,
      acknowledged: targetStatus === 'acknowledged',
    },
  });
}
