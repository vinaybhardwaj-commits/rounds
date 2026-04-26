// =============================================================================
// chat-tasks-card-sync.ts  (CT.4 — Chat Tasks PRD v1.4 §6.3-§6.5 + §4.5)
//
// After any DB-side change to a chat-task (status transition, edit, cancel),
// this helper re-renders the structured `chat_task_card` Stream message in
// both surfaces where it lives:
//
//   1. The originating channel card (tasks.posted_message_id)
//   2. The DM ping (tasks.metadata.dm_ping_message_id), if one was posted
//
// Implementation: reads the latest task row + joined patient context, builds
// a fresh card payload, and uses Stream's partialUpdateMessage to overwrite
// the `chat_task_card` field on each message. Stream emits a
// `message.updated` event so any client viewing the message re-renders
// without a refresh.
//
// Errors are non-fatal — sync failures are logged but never propagated to
// the caller. The DB row remains the source of truth; if the card drifts,
// a hard refresh re-loads it from /api/tasks.
// =============================================================================

import { getStreamServerClient } from './getstream';
import { queryOne } from './db';

interface TaskCardSnapshot {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  source_message_id: string | null;
  posted_message_id: string | null;
  source_channel_id: string | null;
  source_channel_type: string | null;
  metadata: Record<string, unknown> | null;
  // assignee + assigner names
  assignee_profile_id: string | null;
  assignee_name: string | null;
  assigner_profile_id: string | null;
  assigner_name: string | null;
  // patient context
  patient_thread_id: string | null;
  patient_name: string | null;
  uhid: string | null;
}

/**
 * Fetch a task with everything the card needs in one round-trip.
 */
async function loadTaskSnapshot(taskId: string): Promise<TaskCardSnapshot | null> {
  return await queryOne<TaskCardSnapshot>(
    `SELECT
       t.id, t.title, t.description, t.status, t.priority, t.due_at,
       t.source_message_id, t.posted_message_id,
       t.source_channel_id, t.source_channel_type, t.metadata,
       t.assignee_profile_id,
       a.full_name      AS assignee_name,
       t.created_by     AS assigner_profile_id,
       c.full_name      AS assigner_name,
       COALESCE(t.patient_thread_id, sc_pt.id)              AS patient_thread_id,
       COALESCE(d_pt.patient_name, sc_pt.patient_name)      AS patient_name,
       COALESCE(d_pt.uhid, sc_pt.uhid)                      AS uhid
     FROM tasks t
     LEFT JOIN profiles        a     ON a.id     = t.assignee_profile_id
     LEFT JOIN profiles        c     ON c.id     = t.created_by
     LEFT JOIN surgical_cases  sc    ON sc.id    = t.case_id
     LEFT JOIN patient_threads sc_pt ON sc_pt.id = sc.patient_thread_id
     LEFT JOIN patient_threads d_pt  ON d_pt.id  = t.patient_thread_id
     WHERE t.id = $1`,
    [taskId]
  );
}

/**
 * Build the card payload from a task snapshot. Same shape used at
 * creation time in POST /api/chat-tasks (CT.3).
 */
function buildCardPayload(t: TaskCardSnapshot): Record<string, unknown> {
  return {
    type: 'chat-task-card',
    task_id: t.id,
    title: t.title,
    description: t.description,
    assignee: t.assignee_profile_id
      ? { id: t.assignee_profile_id, name: t.assignee_name ?? 'Assignee' }
      : null,
    assigner: t.assigner_profile_id
      ? { id: t.assigner_profile_id, name: t.assigner_name ?? 'Assigner' }
      : null,
    patient: t.patient_thread_id
      ? { id: t.patient_thread_id, name: t.patient_name, uhid: t.uhid }
      : null,
    due_at: t.due_at,
    priority: t.priority,
    status: t.status,
    source_message_id: t.source_message_id,
  };
}

/**
 * Sync the rendered Stream cards (channel + DM ping if exists) with the
 * latest DB state for this task. Non-fatal — failures are logged.
 */
export async function syncChatTaskCard(taskId: string): Promise<void> {
  let snapshot: TaskCardSnapshot | null;
  try {
    snapshot = await loadTaskSnapshot(taskId);
  } catch (e) {
    console.error('[chat-tasks-card-sync] loadTaskSnapshot failed:', e instanceof Error ? e.message : e);
    return;
  }
  if (!snapshot) {
    console.warn('[chat-tasks-card-sync] task not found, nothing to sync:', taskId);
    return;
  }

  const payload = buildCardPayload(snapshot);

  // Channel card.
  if (snapshot.posted_message_id) {
    try {
      const client = getStreamServerClient();
      await client.partialUpdateMessage(snapshot.posted_message_id, {
        set: { chat_task_card: payload },
      });
    } catch (e) {
      console.error('[chat-tasks-card-sync] channel card update failed:', e instanceof Error ? e.message : e);
    }
  }

  // DM ping (if it was posted at create time — see CT.3 step 7).
  const dmMessageId = (snapshot.metadata as Record<string, unknown> | null)?.dm_ping_message_id;
  if (typeof dmMessageId === 'string' && dmMessageId.length > 0) {
    try {
      const client = getStreamServerClient();
      await client.partialUpdateMessage(dmMessageId, {
        set: { chat_task_card: { ...payload, is_ping: true } },
      });
    } catch (e) {
      console.error('[chat-tasks-card-sync] DM ping update failed:', e instanceof Error ? e.message : e);
    }
  }
}
