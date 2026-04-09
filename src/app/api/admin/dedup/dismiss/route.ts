/**
 * POST /api/admin/dedup/dismiss
 *
 * R.3 + R.4 Phase 5.1 — "Not a duplicate" action for the Dedup Hub Review Queue.
 *
 * Body:
 *   {
 *     candidateId: string (uuid),
 *     resolution:  'distinct' | 'ignored',   // default 'distinct'
 *     reason?:     string
 *   }
 *
 * Flow:
 *   1. Validate super_admin
 *   2. Look up the candidate row
 *   3. UPDATE dedup_candidates SET status = $resolution, resolved_at, resolved_by, resolution_note
 *   4. If resolution = 'distinct' AND the new_thread still has is_possible_duplicate = TRUE AND
 *      no other pending candidates exist for it → clear the flag on patient_threads
 *   5. logDedupAction for the audit trail
 *
 * Requires super_admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne, execute } from '@/lib/db';
import { logDedupAction } from '@/lib/dedup';

export const dynamic = 'force-dynamic';

function isUuid(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  );
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { candidateId, resolution, reason } = body as {
    candidateId?: unknown;
    resolution?: unknown;
    reason?: unknown;
  };

  if (!isUuid(candidateId)) {
    return NextResponse.json(
      { success: false, error: 'candidateId must be a valid UUID' },
      { status: 400 }
    );
  }

  const validResolutions = ['distinct', 'ignored'];
  const resolutionValue =
    typeof resolution === 'string' && validResolutions.includes(resolution)
      ? resolution
      : 'distinct';

  const trimmedReason = typeof reason === 'string' ? reason.trim() : null;

  // --- 1. Load candidate + both thread ids ---------------------------------
  const candidate = await queryOne<{
    id: string;
    new_thread_id: string;
    existing_thread_id: string;
    status: string;
  }>(
    `SELECT id, new_thread_id, existing_thread_id, status
     FROM dedup_candidates
     WHERE id = $1`,
    [candidateId]
  );

  if (!candidate) {
    return NextResponse.json(
      { success: false, error: 'Candidate not found' },
      { status: 404 }
    );
  }

  if (candidate.status !== 'pending') {
    return NextResponse.json(
      {
        success: false,
        error: `Candidate already resolved (status = ${candidate.status})`,
      },
      { status: 409 }
    );
  }

  // --- 2. Resolve the candidate --------------------------------------------
  await execute(
    `
    UPDATE dedup_candidates
    SET status = $2,
        resolved_at = NOW(),
        resolved_by = $3,
        resolution_note = $4
    WHERE id = $1
    `,
    [candidateId, resolutionValue, user.profileId ?? null, trimmedReason]
  );

  // --- 3. Clear is_possible_duplicate on new thread if no pending left -----
  let clearedFlag = false;
  const remaining = await query<{ cnt: string }>(
    `
    SELECT COUNT(*)::text AS cnt
    FROM dedup_candidates
    WHERE new_thread_id = $1 AND status = 'pending'
    `,
    [candidate.new_thread_id]
  );
  const remainingCount = parseInt(remaining[0]?.cnt ?? '0', 10);
  if (remainingCount === 0) {
    await execute(
      `UPDATE patient_threads SET is_possible_duplicate = FALSE, updated_at = NOW() WHERE id = $1`,
      [candidate.new_thread_id]
    );
    clearedFlag = true;
  }

  // --- 4. Audit log --------------------------------------------------------
  await logDedupAction({
    action: resolutionValue === 'distinct' ? 'split' : 'ignore',
    source_thread_id: candidate.new_thread_id,
    target_thread_id: candidate.existing_thread_id,
    match_layer: null,
    similarity: null,
    reason: trimmedReason,
    metadata: {
      candidate_id: candidateId,
      cleared_possible_duplicate_flag: clearedFlag,
      remaining_pending_for_new_thread: remainingCount,
    },
    actor_id: user.profileId ?? null,
    actor_name: user.email ?? null,
    endpoint: '/api/admin/dedup/dismiss',
  });

  return NextResponse.json({
    success: true,
    data: {
      candidateId,
      resolution: resolutionValue,
      clearedFlag,
      remainingPendingForNewThread: remainingCount,
    },
  });
}
