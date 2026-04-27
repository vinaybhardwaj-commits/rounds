// =============================================================================
// undo-inverses.ts (GLASS.9)
//
// Per PRD §6 — 6 high-impact actions get a 24h Undo button. Each inverse
// function below restores the headline state from the audit_log row's
// `payload_before` snapshot (captured by the original audit() call wired in
// GLASS.4).
//
// Cascade reversal (downstream tasks/channels/billing/etc.) is OUT OF SCOPE
// for v1. The inverse restores the dominant state field; super_admin handles
// any cascade cleanup via the audit log + manual SQL if needed. This is
// explicit in PRD §6.4.
//
// Every inverse:
//   - Reads payload_before from the original audit row
//   - Runs a single-table UPDATE to restore the headline field
//   - Returns { success, summary } so the dispatcher can write the .undo audit
//
// Tenancy is enforced by the dispatcher BEFORE these run — these don't
// re-check.
// =============================================================================

import { sql, queryOne } from '@/lib/db';

export type UndoableAction =
  | 'patient.discharge'
  | 'patient.archive'
  | 'patient.stage_advance'
  | 'pac.publish_outcome'
  | 'case.cancel'
  | 'case.book_ot';

export const UNDOABLE_ACTIONS: ReadonlySet<UndoableAction> = new Set([
  'patient.discharge',
  'patient.archive',
  'patient.stage_advance',
  'pac.publish_outcome',
  'case.cancel',
  'case.book_ot',
]);

export interface AuditRow {
  id: string;
  ts: string;
  actor_id: string | null;
  hospital_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  payload_before: Record<string, unknown> | null;
  payload_after: Record<string, unknown> | null;
}

export interface InverseResult {
  success: boolean;
  summary: string;
  error?: string;
}

// ── 1. patient.discharge — restore current_stage to pre-discharge ──
async function undoDischarge(row: AuditRow): Promise<InverseResult> {
  const prevStage = (row.payload_before?.stage as string | undefined)
    ?? (row.payload_before?.current_stage as string | undefined);
  if (!prevStage || !row.target_id) {
    return { success: false, summary: 'Cannot undo: missing prev stage or target', error: 'invalid_audit_payload' };
  }
  await sql`
    UPDATE patient_threads
       SET current_stage = ${prevStage}, updated_at = NOW()
     WHERE id = ${row.target_id}
  `;
  return { success: true, summary: `Reopened patient (restored stage to ${prevStage})` };
}

// ── 2. patient.archive — clear archived_at ──
async function undoArchive(row: AuditRow): Promise<InverseResult> {
  if (!row.target_id) return { success: false, summary: 'Cannot undo: no target', error: 'invalid_audit_payload' };
  await sql`
    UPDATE patient_threads
       SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = NOW()
     WHERE id = ${row.target_id}
  `;
  return { success: true, summary: 'Restored patient to active list' };
}

// ── 3. patient.stage_advance — restore previous stage ──
async function undoStageAdvance(row: AuditRow): Promise<InverseResult> {
  const prevStage = (row.payload_before?.stage as string | undefined)
    ?? (row.payload_before?.current_stage as string | undefined);
  if (!prevStage || !row.target_id) {
    return { success: false, summary: 'Cannot undo: missing prev stage or target', error: 'invalid_audit_payload' };
  }
  await sql`
    UPDATE patient_threads
       SET current_stage = ${prevStage}, updated_at = NOW()
     WHERE id = ${row.target_id}
  `;
  return { success: true, summary: `Restored patient stage to ${prevStage}` };
}

// ── 4. pac.publish_outcome — restore prior outcome (or NULL → draft) ──
async function undoPacPublish(row: AuditRow): Promise<InverseResult> {
  if (!row.target_id) return { success: false, summary: 'Cannot undo: no target', error: 'invalid_audit_payload' };
  const prevOutcome = (row.payload_before?.pac_outcome as string | null | undefined) ?? null;
  await sql`
    UPDATE surgical_cases
       SET pac_outcome = ${prevOutcome}, updated_at = NOW()
     WHERE id = ${row.target_id}
  `;
  return { success: true, summary: prevOutcome ? `Reset PAC outcome to ${prevOutcome}` : 'Reset PAC to draft' };
}

// ── 5. case.cancel — restore previous case state ──
async function undoCaseCancel(row: AuditRow): Promise<InverseResult> {
  const prevState = (row.payload_before?.state as string | undefined);
  if (!prevState || !row.target_id) {
    return { success: false, summary: 'Cannot undo: missing prev state or target', error: 'invalid_audit_payload' };
  }
  await sql`
    UPDATE surgical_cases
       SET state = ${prevState}, cancelled_at = NULL, cancelled_by = NULL, cancellation_reason = NULL, updated_at = NOW()
     WHERE id = ${row.target_id}
  `;
  return { success: true, summary: `Restored case state to ${prevState}` };
}

// ── 6. case.book_ot — free the slot (clear booking fields) ──
async function undoBookOt(row: AuditRow): Promise<InverseResult> {
  if (!row.target_id) return { success: false, summary: 'Cannot undo: no target', error: 'invalid_audit_payload' };
  // payload_before is typically null/{} (booking is a "create" semantically); clear all booking fields.
  await sql`
    UPDATE surgical_cases
       SET ot_room = NULL,
           scheduled_date = NULL,
           scheduled_start_time = NULL,
           scheduled_end_time = NULL,
           updated_at = NOW()
     WHERE id = ${row.target_id}
  `;
  return { success: true, summary: 'Freed OT slot' };
}

// ── Dispatcher map ──
const INVERSES: Record<UndoableAction, (row: AuditRow) => Promise<InverseResult>> = {
  'patient.discharge': undoDischarge,
  'patient.archive': undoArchive,
  'patient.stage_advance': undoStageAdvance,
  'pac.publish_outcome': undoPacPublish,
  'case.cancel': undoCaseCancel,
  'case.book_ot': undoBookOt,
};

/**
 * Run the inverse for a guaranteed-mode action's audit row.
 *
 * Caller (POST /api/undo/[auditId]) must have already validated:
 *   - actor_id === user.profileId
 *   - action ∈ UNDOABLE_ACTIONS
 *   - ts > now() - 24h
 *   - no <action>.undo row already exists for this audit_id
 *   - hospital tenancy (the user can access the affected resource)
 */
export async function runInverse(row: AuditRow): Promise<InverseResult> {
  const fn = INVERSES[row.action as UndoableAction];
  if (!fn) {
    return { success: false, summary: `No inverse defined for ${row.action}`, error: 'no_inverse' };
  }
  try {
    return await fn(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, summary: 'Inverse mutation failed', error: msg };
  }
}

/**
 * Helper for the recent-list endpoint: fetches the most recent N undoable
 * audit rows for a user, EXCLUDING any that already have an .undo row.
 */
export async function listRecentUndoable(actorId: string, limit = 5): Promise<AuditRow[]> {
  // Single round-trip: NOT EXISTS subquery filters out already-undone rows.
  const rows = await queryOne<{ rows: AuditRow[] }>(
    `
    SELECT json_agg(t) AS rows FROM (
      SELECT
        a.id::text AS id,
        a.ts::text AS ts,
        a.actor_id::text AS actor_id,
        a.hospital_id::text AS hospital_id,
        a.action,
        a.target_type,
        a.target_id::text AS target_id,
        a.summary,
        a.payload_before,
        a.payload_after
      FROM audit_log a
      WHERE a.actor_id = $1
        AND a.action = ANY($2::text[])
        AND a.ts > NOW() - interval '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM audit_log u
          WHERE u.action = a.action || '.undo'
            AND u.target_id = a.target_id
            AND u.ts > a.ts
        )
      ORDER BY a.ts DESC
      LIMIT $3
    ) t
    `,
    [actorId, Array.from(UNDOABLE_ACTIONS), limit]
  );
  return rows?.rows ?? [];
}
