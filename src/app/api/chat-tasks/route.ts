// =============================================================================
// POST /api/chat-tasks  (CT.3 — Chat Tasks PRD v1.4 §6.2 + §6.6)
//
// Creates a chat-originated task and posts a structured `chat_task_card`
// message into the originating channel. Implements the synchronous-with-
// rollback atomicity strategy locked in PRD §6.2 + the 10/user/min rate
// limit from §6.6.
//
// Behaviour (steps mirror PRD §6.2):
//   1. Auth.
//   2. Rate-limit gate. 429 + Retry-After if hit.
//   3. Body validation. 400 on missing required fields.
//   4. Tenancy + hospital_id resolution.
//   5. INSERT task row with metadata.stream_state='posting'.
//   6. Post chat_task_card Stream message (one quick retry on transient
//      failure ~500ms backoff).
//      - On success: UPDATE tasks.posted_message_id +
//        metadata.stream_state='posted'. Continue.
//      - On failure: DELETE the task row. Return 503.
//   7. Fire-and-forget DM ping to assignee (logged on failure, never
//      blocks the API response).
//   8. Return the new task row (200).
//
// Stream auth dependency: NEXT_PUBLIC_GETSTREAM_API_KEY +
// GETSTREAM_API_SECRET must be set in deploy env. The serverClient helper
// throws 'Missing GetStream credentials.' if either is missing — the
// handler catches it as a 503.
//
// Companion: src/lib/chat-tasks-rate-limit.ts (CT.3),
//            src/lib/migration-chat-tasks-extensions.sql (CT.1).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { withApiTelemetry } from '@/lib/api-telemetry';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { getStreamServerClient } from '@/lib/getstream';
import { checkRateLimit } from '@/lib/chat-tasks-rate-limit';

const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface CreateBody {
  channel_id?: string;
  channel_type?: string;
  assignee_profile_id?: string | 'self';
  title?: string;
  description?: string;
  patient_thread_id?: string | null;
  due_at?: string;
  priority?: string;
  source_message_id?: string | null;
}

async function POST_inner(request: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Rate-limit gate (PRD §6.6) ──────────────────────────────────────
  const rl = checkRateLimit(user.profileId);
  if (!rl.ok) {
    const headers = new Headers();
    headers.set('Retry-After', String(rl.retryAfterSeconds));
    return NextResponse.json(
      {
        success: false,
        error: `Rate limit: max 10 chat-tasks/min — try again in ${rl.retryAfterSeconds} seconds`,
        retry_after_seconds: rl.retryAfterSeconds,
      },
      { status: 429, headers }
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── 3. Body validation ────────────────────────────────────────────────
  if (!body.channel_id || typeof body.channel_id !== 'string') {
    return NextResponse.json({ success: false, error: 'channel_id is required' }, { status: 400 });
  }
  if (!body.channel_type || typeof body.channel_type !== 'string') {
    return NextResponse.json({ success: false, error: 'channel_type is required' }, { status: 400 });
  }
  if (!body.assignee_profile_id) {
    return NextResponse.json({ success: false, error: 'assignee_profile_id is required' }, { status: 400 });
  }
  const assigneeId = body.assignee_profile_id === 'self' ? user.profileId : body.assignee_profile_id;
  if (!UUID_RE.test(assigneeId)) {
    return NextResponse.json({ success: false, error: 'Invalid assignee_profile_id' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 200) {
    return NextResponse.json({ success: false, error: 'title required, max 200 chars' }, { status: 400 });
  }
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : null;
  const priority = body.priority && VALID_PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const dueAt = body.due_at && typeof body.due_at === 'string' ? body.due_at : null;
  const sourceMessageId = body.source_message_id && typeof body.source_message_id === 'string' ? body.source_message_id : null;
  const patientThreadId = body.patient_thread_id && typeof body.patient_thread_id === 'string' ? body.patient_thread_id : null;
  if (patientThreadId && !UUID_RE.test(patientThreadId)) {
    return NextResponse.json({ success: false, error: 'Invalid patient_thread_id' }, { status: 400 });
  }

  // ── 4. Tenancy + hospital_id resolution ───────────────────────────────
  // Resolution order (first non-null wins):
  //   a) patient_thread_id → patient_threads.hospital_id (most specific)
  //   b) assigner's primary_hospital_id (always available)
  // Tenancy: hospital_id MUST be in caller's accessible hospitals, AND
  // assignee must have access to it too.
  let hospitalId: string | null = null;
  let patientName: string | null = null;
  let patientUhid: string | null = null;

  if (patientThreadId) {
    const pt = await queryOne<{ hospital_id: string | null; patient_name: string | null; uhid: string | null }>(
      `SELECT hospital_id, patient_name, uhid
         FROM patient_threads
        WHERE id = $1
          AND archived_at IS NULL
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [patientThreadId, user.profileId]
    );
    if (!pt) {
      return NextResponse.json(
        { success: false, error: 'Patient not found or not accessible' },
        { status: 403 }
      );
    }
    hospitalId = pt.hospital_id;
    patientName = pt.patient_name;
    patientUhid = pt.uhid;
  }

  if (!hospitalId) {
    const me = await queryOne<{ primary_hospital_id: string | null }>(
      `SELECT primary_hospital_id FROM profiles WHERE id = $1`,
      [user.profileId]
    );
    hospitalId = me?.primary_hospital_id ?? null;
  }

  if (!hospitalId) {
    return NextResponse.json(
      { success: false, error: 'Could not resolve hospital_id (no patient + assigner has no primary hospital)' },
      { status: 400 }
    );
  }

  // Verify assigner can access this hospital.
  const accessOk = await queryOne<{ ok: boolean }>(
    `SELECT $1::UUID = ANY(user_accessible_hospital_ids($2::UUID)) AS ok`,
    [hospitalId, user.profileId]
  );
  if (!accessOk?.ok) {
    return NextResponse.json(
      { success: false, error: 'Hospital not accessible to assigner' },
      { status: 403 }
    );
  }

  // Verify assignee can access this hospital too (otherwise they'd see a task
  // they can't open in their Tasks tab).
  const assigneeAccessOk = await queryOne<{ ok: boolean }>(
    `SELECT $1::UUID = ANY(user_accessible_hospital_ids($2::UUID)) AS ok`,
    [hospitalId, assigneeId]
  );
  if (!assigneeAccessOk?.ok) {
    return NextResponse.json(
      { success: false, error: 'Assignee is not in your accessible hospitals — they cannot see this task' },
      { status: 403 }
    );
  }

  // Resolve assignee's display name for the Stream card.
  const assigneeRow = await queryOne<{ full_name: string | null; email: string | null }>(
    `SELECT full_name, email FROM profiles WHERE id = $1`,
    [assigneeId]
  );
  const assigneeName = assigneeRow?.full_name || assigneeRow?.email || 'Assignee';
  const assignerName = user.email || 'Assigner';

  // ── 5. INSERT task row (stream_state='posting') ───────────────────────
  const initialMetadata = JSON.stringify({
    stream_state: 'posting',
    via: 'POST /api/chat-tasks',
    source_channel_id: body.channel_id,
    source_channel_type: body.channel_type,
  });
  const inserted = await queryOne<{ id: string; created_at: string }>(
    `INSERT INTO tasks
       (hospital_id, patient_thread_id, title, description, assignee_profile_id,
        owner_role, due_at, status, source, source_channel_id, source_channel_type,
        source_message_id, priority, metadata, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6::TIMESTAMPTZ, 'pending', 'chat',
             $7, $8, $9, $10, $11::jsonb, $12, NOW(), NOW())
     RETURNING id, created_at`,
    [
      hospitalId,
      patientThreadId,
      title,
      description,
      assigneeId,
      dueAt,
      body.channel_id,
      body.channel_type,
      sourceMessageId,
      priority,
      initialMetadata,
      user.profileId,
    ]
  );

  if (!inserted) {
    return NextResponse.json({ success: false, error: 'Failed to create task' }, { status: 500 });
  }

  // ── 6. Post chat_task_card Stream message (with one retry) ────────────
  const cardPayload = {
    type: 'chat-task-card',
    task_id: inserted.id,
    title,
    assignee: { id: assigneeId, name: assigneeName },
    assigner: { id: user.profileId, name: assignerName },
    patient: patientThreadId ? { id: patientThreadId, name: patientName, uhid: patientUhid } : null,
    due_at: dueAt,
    priority,
    status: 'pending' as const,
    source_message_id: sourceMessageId,
  };

  const postedMessageId = await postCardWithRetry(
    body.channel_type,
    body.channel_id,
    user.profileId,
    title,
    cardPayload
  );

  if (!postedMessageId) {
    // Atomicity rollback: drop the task row and return 503 so the composer
    // surfaces a normal "couldn't post — try again" error.
    await query(`DELETE FROM tasks WHERE id = $1`, [inserted.id]);
    return NextResponse.json(
      { success: false, error: 'Failed to post task to chat — try again' },
      { status: 503 }
    );
  }

  // Update the task row with the posted message id.
  await query(
    `UPDATE tasks
       SET posted_message_id = $1,
           metadata = metadata || jsonb_build_object('stream_state', 'posted'),
           updated_at = NOW()
     WHERE id = $2`,
    [postedMessageId, inserted.id]
  );

  // ── 7. Fire-and-forget DM ping (PRD §7.2) ─────────────────────────────
  // Wrapped in try/catch — never blocks the API response. v1 only pings
  // if a DM channel between assigner + assignee already exists; auto-
  // creation is deferred (logged + skipped). DM coalescing is CT.14
  // backlog.
  pingAssigneeDM(user.profileId, assigneeId, cardPayload, inserted.id).catch((e) => {
    console.error('[chat-tasks] DM ping failed (non-fatal):', e instanceof Error ? e.message : e);
  });

  // ── 8. Return ─────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      success: true,
      data: {
        id: inserted.id,
        created_at: inserted.created_at,
        posted_message_id: postedMessageId,
        hospital_id: hospitalId,
        patient_thread_id: patientThreadId,
      },
    },
    { status: 200 }
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function postCardWithRetry(
  channelType: string,
  channelId: string,
  assignerProfileId: string,
  fallbackText: string,
  cardPayload: Record<string, unknown>
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const client = getStreamServerClient();
      const channel = client.channel(channelType, channelId);
      const result = await channel.sendMessage({
        // Stream surfaces unknown top-level fields as message custom data,
        // so the renderer (CT.5) matches on chat_task_card presence.
        text: fallbackText,
        user_id: assignerProfileId,
        chat_task_card: cardPayload,
      });
      return result?.message?.id ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[chat-tasks] Stream post attempt ${attempt + 1}/2 failed:`, msg);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  return null;
}

async function pingAssigneeDM(
  assignerProfileId: string,
  assigneeProfileId: string,
  cardPayload: Record<string, unknown>,
  taskId: string
): Promise<void> {
  if (assignerProfileId === assigneeProfileId) return; // self-assign — skip ping
  const client = getStreamServerClient();
  // Find an existing 1:1 direct channel between assigner + assignee. v1
  // does NOT auto-create — if none exists, the ping is skipped (the
  // structured card in the originating channel + the Tasks-tab entry
  // are still the assignee's two visible surfaces).
  const channels = await client.queryChannels(
    {
      type: 'direct',
      members: { $eq: [assignerProfileId, assigneeProfileId] },
    },
    [{ last_message_at: -1 }],
    { limit: 1 }
  );
  if (channels.length === 0) {
    console.warn('[chat-tasks] No direct channel between assigner + assignee — DM ping skipped (task_id:', taskId, ')');
    return;
  }
  const dm = channels[0];
  await dm.sendMessage({
    text: `📋 Task assigned: ${(cardPayload.title as string) ?? 'New task'}`,
    user_id: assignerProfileId,
    chat_task_card: { ...cardPayload, is_ping: true },
  });
}

// AP.3 — telemetry-wrapped exports (auto-applied)
export const POST = withApiTelemetry('/api/chat-tasks', POST_inner);
