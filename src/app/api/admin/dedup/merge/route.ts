/**
 * POST /api/admin/dedup/merge
 *
 * R.3 + R.4 Phase 5.1 — Merge action endpoint for the Dedup Hub Review Queue.
 *
 * Body:
 *   {
 *     winnerId:   string (uuid),
 *     loserId:    string (uuid),
 *     reason?:    string,
 *     candidateId?: string (uuid) — optional, only used for logging context
 *   }
 *
 * Flow:
 *   1. Validate super_admin
 *   2. Call mergePatientThreads() from src/lib/dedup (idempotent)
 *   3. Best-effort GetStream rename: [MERGED] {name} + final system message
 *      — Stream failures do NOT fail the merge (helper already committed)
 *   4. Return merge result with channel rename status
 *
 * Requires super_admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { mergePatientThreads } from '@/lib/dedup';
import { queryOne } from '@/lib/db';
import { updatePatientChannel, sendSystemMessage } from '@/lib/getstream';

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

  const { winnerId, loserId, reason, candidateId } = body as {
    winnerId?: unknown;
    loserId?: unknown;
    reason?: unknown;
    candidateId?: unknown;
  };

  if (!isUuid(winnerId) || !isUuid(loserId)) {
    return NextResponse.json(
      { success: false, error: 'winnerId and loserId must be valid UUIDs' },
      { status: 400 }
    );
  }

  if (winnerId === loserId) {
    return NextResponse.json(
      { success: false, error: 'winnerId and loserId cannot be the same' },
      { status: 400 }
    );
  }

  if (candidateId !== undefined && !isUuid(candidateId)) {
    return NextResponse.json(
      { success: false, error: 'candidateId must be a valid UUID if provided' },
      { status: 400 }
    );
  }

  const trimmedReason =
    typeof reason === 'string' ? reason.trim() : null;

  // -- 1. Pre-fetch loser info for the GetStream rename (before it's archived) --
  const loserBefore = await queryOne<{
    patient_name: string | null;
    getstream_channel_id: string | null;
  }>(
    `SELECT patient_name, getstream_channel_id FROM patient_threads WHERE id = $1`,
    [loserId]
  );

  // -- 2. Call the merge helper (idempotent, throws on invalid state) ----------
  let result;
  try {
    result = await mergePatientThreads(
      winnerId,
      loserId,
      { profileId: user.profileId, email: user.email },
      {
        reason: trimmedReason,
        endpoint: '/api/admin/dedup/merge',
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed';
    console.error('[dedup] merge failed:', err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }

  // -- 3. Best-effort GetStream rename + final message -----------------------
  // Helper is already committed; Stream failures must not undo the DB merge.
  let channelAction: 'renamed' | 'missing' | 'stream_error' = 'missing';
  let channelError: string | null = null;
  if (loserBefore?.getstream_channel_id) {
    try {
      const mergedName = `[MERGED] ${loserBefore.patient_name ?? 'Patient'}`;
      await updatePatientChannel(loserBefore.getstream_channel_id, {
        name: mergedName,
        merged: true,
        merged_into_id: winnerId,
        merged_at: new Date().toISOString(),
      });
      await sendSystemMessage(
        'patient-thread',
        loserBefore.getstream_channel_id,
        `This thread was merged into another patient record by ${user.email || 'an admin'}. No further messages should be posted here.`,
        { type: 'merge_final', merged_into_id: winnerId }
      );
      channelAction = 'renamed';
    } catch (err) {
      channelAction = 'stream_error';
      channelError = err instanceof Error ? err.message : 'unknown';
      console.error('[dedup] getstream rename failed (non-fatal):', err);
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      ...result,
      candidateId: isUuid(candidateId) ? candidateId : null,
      channelAction,
      channelError,
    },
  });
}
