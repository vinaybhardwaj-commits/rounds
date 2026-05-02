// =============================================================================
// PAC Workspace v2 — Engine persistence layer (PCW2.3)
//
// Wraps the pure engine (PCW2.2) with DB IO:
//   - loadFactSnapshot(caseId)        — read pac_facts + pac_workspace_progress
//   - reconcileSuggestions(...)       — insert/skip/supersede/auto-dismiss
//                                       per PRD §5.3
//   - runAndPersist(caseId)           — full pipeline: load → infer → evaluate
//                                       → reconcile. Non-fatal in form-submit
//                                       paths per PRD §5.4.
//
// Cross-cutting locks from PCW2.2 still apply: conservative-on-missing,
// predicate failures non-fatal, asaGrade lifted onto FactSnapshot.
//
// NO multi-statement transactions: Neon HTTP driver is single-statement-
// per-call. Idempotency comes from (a) the unique partial index
// idx_pac_suggestions_unique_active on (case_id, rule_id) WHERE status
// NOT IN ('superseded', 'auto_dismissed'), (b) supersede-first per rule,
// (c) coordinator decisions (already_done / accepted / skipped) are durable
// and never overwritten by recompute.
// =============================================================================

import { query as sqlQuery, queryOne } from '@/lib/db';
import { evaluate } from './engine';
import type {
  FactSnapshot,
  FactValue,
  SuggestionEvaluation,
} from './engine-types';
import { inferAsa } from './asa-inference';
import { ALL_RULES } from './rules';

export interface RunAndPersistResult {
  caseId: string;
  fired: number;          // rules that matched on this evaluation
  inserted: number;       // newly-created pac_suggestions rows
  superseded: number;     // pending rows we superseded due to rule_version bump
  autoDismissed: number;  // pending rows auto-dismissed (rule no longer fires)
  asaInferred: 1 | 2 | 3 | null; // grade we stamped this run, if any
  durationMs: number;
  trigger?: string;
}

// =============================================================================
// loadFactSnapshot
// =============================================================================

/**
 * Build a FactSnapshot for one case from pac_facts + pac_workspace_progress.
 *
 * - facts: latest non-superseded rows per fact_key (the supersede-first
 *   writer in PCW2.1 ensures one row per key, but we pick the most recent
 *   defensively).
 * - asaGrade / asaSource: from pac_workspace_progress if a row exists;
 *   otherwise null. PCW2.3 does NOT auto-create the workspace progress
 *   row — pac_mode + checklist_template are NOT NULL and require v1
 *   workspace setup.
 */
export async function loadFactSnapshot(caseId: string): Promise<FactSnapshot> {
  const factRows = await sqlQuery<{ fact_key: string; fact_value: FactValue }>(
    `SELECT fact_key, fact_value
       FROM pac_facts
      WHERE case_id = $1 AND superseded_at IS NULL`,
    [caseId]
  );

  const facts: Record<string, FactValue> = {};
  for (const row of factRows) {
    facts[row.fact_key] = row.fact_value;
  }

  const ws = await queryOne<{ asa_grade: number | null; asa_source: string | null }>(
    `SELECT asa_grade, asa_source FROM pac_workspace_progress WHERE case_id = $1`,
    [caseId]
  );

  return {
    facts,
    asaGrade: (ws?.asa_grade ?? null) as FactSnapshot['asaGrade'],
    asaSource: (ws?.asa_source ?? null) as FactSnapshot['asaSource'],
  };
}

// =============================================================================
// reconcileSuggestions
// =============================================================================

/**
 * For each evaluated rule:
 *   - Look up the active live row (status NOT IN superseded, auto_dismissed).
 *   - If no live row: INSERT pending.
 *   - If existing row's status != 'pending' (coordinator already decided):
 *     SKIP — coordinator decisions are durable.
 *   - If existing row's status='pending' AND same rule_version: SKIP.
 *   - If existing row's status='pending' AND older rule_version:
 *     UPDATE to 'superseded' + INSERT new pending.
 *
 * Then auto-dismiss: any pending row whose rule no longer fires gets
 * status='auto_dismissed' with decision_reason_code='auto.condition_removed'.
 *
 * The unique partial index makes the INSERT race-safe (concurrent recompute
 * on the same case would conflict; we ON CONFLICT DO NOTHING).
 */
async function reconcileSuggestions(
  caseId: string,
  evaluations: SuggestionEvaluation[],
  snap: FactSnapshot
): Promise<{ inserted: number; superseded: number; autoDismissed: number }> {
  let inserted = 0;
  let superseded = 0;

  for (const ev of evaluations) {
    const existing = await queryOne<{
      id: string;
      rule_version: number;
      status: string;
    }>(
      `SELECT id, rule_version, status
         FROM pac_suggestions
        WHERE case_id = $1 AND rule_id = $2
          AND status NOT IN ('superseded', 'auto_dismissed')
        LIMIT 1`,
      [caseId, ev.ruleId]
    );

    if (existing) {
      // Coordinator decision is durable — preserve regardless of version bump.
      if (existing.status !== 'pending') continue;
      // Same version pending — no change.
      if (existing.rule_version === ev.ruleVersion) continue;
      // Pending row at older version — supersede before re-inserting.
      await sqlQuery(
        `UPDATE pac_suggestions
            SET status = 'superseded', updated_at = NOW()
          WHERE id = $1`,
        [existing.id]
      );
      superseded += 1;
    }

    // Snapshot the facts that drove the trigger for replay/audit.
    // Only store keys the rule actually references would be ideal, but
    // engine has no introspection on which keys a trigger touched.
    // Storing the full snapshot is acceptable at v1 scale (small JSONB).
    const factSnapshotJson = JSON.stringify({
      asaGrade: snap.asaGrade,
      asaSource: snap.asaSource,
      facts: snap.facts,
    });

    const inserts = await sqlQuery<{ id: string }>(
      `INSERT INTO pac_suggestions
         (case_id, rule_id, rule_version, severity, status, routes_to,
          proposed_payload, fact_snapshot, reason_text, sop_reference,
          recency_window_days)
       VALUES ($1, $2, $3, $4, 'pending', $5,
               $6::jsonb, $7::jsonb, $8, $9, $10)
       ON CONFLICT (case_id, rule_id)
         WHERE status NOT IN ('superseded', 'auto_dismissed')
       DO NOTHING
       RETURNING id`,
      [
        caseId,
        ev.ruleId,
        ev.ruleVersion,
        ev.severity,
        ev.routesTo,
        JSON.stringify(ev.payload),
        factSnapshotJson,
        ev.reason,
        ev.sopReference,
        ev.recencyWindowDays ?? null,
      ]
    );
    if (inserts.length > 0) inserted += 1;
  }

  // Auto-dismiss pending rows for rules that no longer fire.
  // Coordinator decisions (already_done / accepted / skipped) are NOT touched.
  const firedIds = evaluations.map((e) => e.ruleId);
  let autoDismissed = 0;
  if (firedIds.length > 0) {
    const dismissedRows = await sqlQuery<{ id: string }>(
      `UPDATE pac_suggestions
          SET status = 'auto_dismissed',
              decision_reason_code = 'auto.condition_removed',
              updated_at = NOW()
        WHERE case_id = $1
          AND status = 'pending'
          AND rule_id != ALL($2::text[])
        RETURNING id`,
      [caseId, firedIds]
    );
    autoDismissed = dismissedRows.length;
  } else {
    const dismissedRows = await sqlQuery<{ id: string }>(
      `UPDATE pac_suggestions
          SET status = 'auto_dismissed',
              decision_reason_code = 'auto.condition_removed',
              updated_at = NOW()
        WHERE case_id = $1 AND status = 'pending'
        RETURNING id`,
      [caseId]
    );
    autoDismissed = dismissedRows.length;
  }

  return { inserted, superseded, autoDismissed };
}

// =============================================================================
// inferAsaIfNeeded
// =============================================================================

/**
 * Per PRD §7.1 ASA lifecycle: engine sets `asa_source='inferred'` when
 * Marketing Handoff is submitted. Subsequent fact changes do NOT update
 * an inferred grade — coordinator must override via PCW2.9 modal.
 *
 * - asaSource = null AND no workspace row → cannot infer (no row to update).
 * - asaSource = null AND row exists → infer + stamp (first-time inference).
 * - asaSource = 'inferred' / 'coordinator' / 'anaesthetist' → leave alone.
 *
 * Returns the grade we stamped, or null if we didn't stamp.
 */
async function inferAsaIfNeeded(
  caseId: string,
  snap: FactSnapshot
): Promise<{ snap: FactSnapshot; stamped: 1 | 2 | 3 | null }> {
  // Already set — leave alone (coordinator/anaesthetist decisions are final).
  if (snap.asaGrade !== null) return { snap, stamped: null };

  // Compute inference from current facts.
  const inferred = inferAsa(snap);
  if (!inferred) return { snap, stamped: null };

  // Update workspace progress row IF it exists. If not, the v1 PAC workflow
  // hasn't created the row yet — engine output still flows (Layer 1 just
  // can't fire without asa_grade in the snapshot for this run).
  const updated = await sqlQuery<{ case_id: string }>(
    `UPDATE pac_workspace_progress
        SET asa_grade = $2,
            asa_source = 'inferred',
            updated_at = NOW()
      WHERE case_id = $1
        AND asa_grade IS NULL
      RETURNING case_id`,
    [caseId, inferred.grade]
  );

  if (updated.length === 0) {
    // No row to update OR a concurrent write beat us. Don't stamp.
    return { snap, stamped: null };
  }

  // Update local snapshot so this evaluation sees the inferred grade.
  return {
    snap: { ...snap, asaGrade: inferred.grade, asaSource: 'inferred' },
    stamped: inferred.grade,
  };
}

// =============================================================================
// runAndPersist
// =============================================================================

/**
 * Full pipeline: load snapshot → maybe-infer ASA → evaluate rules → reconcile.
 *
 * Non-fatal contract: callers in form-submission paths wrap this in try/catch
 * (PCW2.1's pattern). A recompute failure must not tear down the form submit.
 *
 * Latency budget per PRD §5.4: <500ms for sync paths. With 112 rules + per-
 * rule SELECT existing + INSERT/UPDATE, expect 100-300ms at the v1 scale
 * (small case count, sparse facts). Backfill paths are not latency-bound.
 */
export async function runAndPersist(
  caseId: string,
  options: { trigger?: string } = {}
): Promise<RunAndPersistResult> {
  const t0 = Date.now();

  // 1. Load snapshot
  let snap = await loadFactSnapshot(caseId);

  // 2. Infer ASA if needed (first-time only — coordinator overrides preserved)
  const inferenceStep = await inferAsaIfNeeded(caseId, snap);
  snap = inferenceStep.snap;

  // 3. Evaluate
  const evaluations = evaluate(snap, ALL_RULES);

  // 4. Reconcile
  const recon = await reconcileSuggestions(caseId, evaluations, snap);

  return {
    caseId,
    fired: evaluations.length,
    inserted: recon.inserted,
    superseded: recon.superseded,
    autoDismissed: recon.autoDismissed,
    asaInferred: inferenceStep.stamped,
    durationMs: Date.now() - t0,
    trigger: options.trigger,
  };
}

/**
 * Convenience: kick off recompute fire-and-forget but log result.
 * Use in form-submission hooks where the form_data write is the priority
 * and recompute is best-effort.
 */
export async function recomputeNonFatal(
  caseId: string,
  trigger: string
): Promise<RunAndPersistResult | null> {
  try {
    const result = await runAndPersist(caseId, { trigger });
    console.log(
      `[pcw2.3 recompute] case=${caseId} trigger=${trigger} fired=${result.fired} inserted=${result.inserted} superseded=${result.superseded} autoDismissed=${result.autoDismissed} asa=${result.asaInferred ?? 'unchanged'} ${result.durationMs}ms`
    );
    return result;
  } catch (err) {
    console.error(
      `[pcw2.3 recompute] non-fatal failure for case ${caseId} (trigger=${trigger}):`,
      (err as Error).message
    );
    return null;
  }
}
