// =============================================================================
// POST /api/undo/[auditId] — execute the inverse of a guaranteed-mode action
//
// GLASS.9 dispatcher per PRD §6.3.
//
// Validation chain (in order):
//   1. requireAuth (getCurrentUser → 401)
//   2. audit_log row exists for this id → 404
//   3. action ∈ UNDOABLE_ACTIONS allowlist → 400
//   4. row.actor_id === user.profileId → 403 (only the actor can undo their own)
//   5. row.ts > now() - 24h → 410 (window expired)
//   6. no <action>.undo row already exists for this target → 409 (single-undo)
//   7. tenancy: row.hospital_id ∈ user.accessible hospitals → 403
//
// On pass:
//   - runInverse(row) restores the headline state via single-table UPDATE
//   - audit({ action: '<original>.undo', mode: 'guaranteed', payload_before/after swapped })
//
// Telemetry: glass.undo_used fires on success (PRD §11 — second of 3 events).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { runInverse, UNDOABLE_ACTIONS, type AuditRow, type UndoableAction } from '@/lib/undo-inverses';

export async function POST(
  request: NextRequest,
  { params }: { params: { auditId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const auditIdNum = Number(params.auditId);
    if (!Number.isFinite(auditIdNum) || auditIdNum <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid audit id' }, { status: 400 });
    }

    // Fetch the original row.
    const row = await queryOne<AuditRow>(
      `
      SELECT
        id::text, ts::text, actor_id::text, hospital_id::text, action,
        target_type, target_id::text, summary, payload_before, payload_after
      FROM audit_log
      WHERE id = $1
      `,
      [auditIdNum]
    );
    if (!row) {
      return NextResponse.json({ success: false, error: 'Audit row not found' }, { status: 404 });
    }

    // Allowlist check.
    if (!UNDOABLE_ACTIONS.has(row.action as UndoableAction)) {
      return NextResponse.json(
        { success: false, error: `Action "${row.action}" is not undoable` },
        { status: 400 }
      );
    }

    // Actor check — only the original actor can undo their own action.
    if (row.actor_id !== user.profileId) {
      return NextResponse.json(
        { success: false, error: 'Only the original actor can undo this action' },
        { status: 403 }
      );
    }

    // 24h window.
    const ageMs = Date.now() - new Date(row.ts).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'Undo window expired (>24h)' },
        { status: 410 }
      );
    }

    // Single-undo guard — fail if .undo already exists for this target.
    const existing = await queryOne<{ id: string }>(
      `
      SELECT id::text FROM audit_log
      WHERE action = $1 AND target_id = $2 AND ts > $3::timestamptz
      LIMIT 1
      `,
      [`${row.action}.undo`, row.target_id, row.ts]
    );
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'This action has already been undone' },
        { status: 409 }
      );
    }

    // Tenancy check — defence in depth.
    if (row.hospital_id) {
      const tenancyOk = await queryOne<{ ok: boolean }>(
        `SELECT $1::uuid = ANY(user_accessible_hospital_ids($2::uuid)) AS ok`,
        [row.hospital_id, user.profileId]
      );
      if (!tenancyOk?.ok) {
        return NextResponse.json(
          { success: false, error: 'Cross-hospital undo not permitted' },
          { status: 403 }
        );
      }
    }

    // Run the inverse.
    const result = await runInverse(row);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.summary, detail: result.error },
        { status: 500 }
      );
    }

    // Audit the undo with payload_before/after swapped (the original "after"
    // becomes the new "before"; the original "before" is what we restored to).
    // Guaranteed mode so failures throw and surface to the user.
    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: row.hospital_id,
        action: `${row.action}.undo`,
        targetType: row.target_type,
        targetId: row.target_id,
        summary: `Undo: ${result.summary} (was: ${row.summary})`,
        payloadBefore: row.payload_after,
        payloadAfter: row.payload_before,
        request,
        mode: 'guaranteed',
      });
    } catch (auditErr) {
      // The inverse mutation has already run. We can't undo the undo cleanly;
      // surface a 200-ish warning so the user sees their action took effect
      // but knows the audit gap. Super_admin will need to add an
      // admin.manual_recovery row.
      console.error('[undo] guaranteed audit write failed AFTER inverse ran:', auditErr);
      return NextResponse.json(
        {
          success: true,
          warning: 'Undo applied but audit log write failed. Notify super_admin to record manual recovery.',
          summary: result.summary,
          undone_audit_id: row.id,
        },
        { status: 207 }  // multi-status — partial success
      );
    }

    return NextResponse.json({
      success: true,
      summary: result.summary,
      undone_audit_id: row.id,
    });
  } catch (error) {
    console.error('POST /api/undo/[auditId] error:', error);
    return NextResponse.json(
      { success: false, error: 'Undo failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
