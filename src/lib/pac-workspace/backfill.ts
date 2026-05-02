// =============================================================================
// PAC Workspace v2 — Backfill (PCW2.3 / migrate steps 30-32)
//
// Three idempotent backfill functions called from /api/admin/migrate. Each
// guarded by a marker in `_migrations` table per the route's pattern.
//
// Per PCW2.0 amendment 1: steps 30-32 deferred from PCW2.0 because they
// depend on the engine (PCW2.2). Now wired here.
//
// Step 30 — pac_facts backfill: scan existing form_submissions of types
//   consolidated_marketing_handoff and surgery_booking, extract facts via
//   PCW2.1's extractFacts, insert pac_facts. Then collapse the chain so
//   only the most recent submission's facts are non-superseded per
//   (case_id, fact_key).
//
// Step 31 — pac_suggestions backfill: for each case_id with live facts,
//   call runAndPersist to populate suggestions. Non-fatal per case.
//
// Step 32 — resolution_state backfill: set sensible defaults on existing
//   pac_workspace_progress rows derived from sub_state.
// =============================================================================

import { query as sqlQuery } from '@/lib/db';
import { extractFacts } from './facts';
import type { FactSourceFormType } from './facts';
import { runAndPersist } from './engine-persistence';

// =============================================================================
// Step 30 — pac_facts backfill
// =============================================================================

interface FactBackfillRow {
  submission_id: string;
  form_data: Record<string, unknown>;
  case_id: string;
  created_at: string;
}

export async function backfillFacts(): Promise<{
  formsScanned: number;
  factsInserted: number;
  superseded: number;
}> {
  // Pass 1: consolidated_marketing_handoff — case via handoff_submission_id
  const handoffs = await sqlQuery<FactBackfillRow>(
    `SELECT fs.id AS submission_id,
            fs.form_data,
            sc.id AS case_id,
            fs.created_at::text AS created_at
       FROM form_submissions fs
       JOIN surgical_cases sc ON sc.handoff_submission_id = fs.id
      WHERE fs.form_type = 'consolidated_marketing_handoff'
        AND fs.status != 'draft'`,
    []
  );

  // Pass 2: surgery_booking — match latest non-cancelled case per patient_thread
  const bookings = await sqlQuery<FactBackfillRow>(
    `SELECT fs.id AS submission_id,
            fs.form_data,
            sc.id AS case_id,
            fs.created_at::text AS created_at
       FROM form_submissions fs
       JOIN LATERAL (
         SELECT id FROM surgical_cases
          WHERE patient_thread_id = fs.patient_thread_id
            AND state != 'cancelled'
            AND archived_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
       ) sc ON true
      WHERE fs.form_type = 'surgery_booking'
        AND fs.status != 'draft'
        AND fs.patient_thread_id IS NOT NULL`,
    []
  );

  let factsInserted = 0;

  async function processBatch(
    rows: FactBackfillRow[],
    formType: FactSourceFormType
  ): Promise<void> {
    for (const row of rows) {
      const facts = extractFacts(formType, row.form_data);
      for (const f of facts) {
        const inserted = await sqlQuery<{ id: string }>(
          `INSERT INTO pac_facts
             (case_id, fact_key, fact_value, source_form_type,
              source_form_submission_id, captured_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6::timestamptz)
           ON CONFLICT (case_id, fact_key, source_form_submission_id)
             DO NOTHING
           RETURNING id`,
          [
            row.case_id,
            f.fact_key,
            JSON.stringify(f.fact_value),
            formType,
            row.submission_id,
            row.created_at,
          ]
        );
        if (inserted.length > 0) factsInserted += 1;
      }
    }
  }

  await processBatch(handoffs, 'consolidated_marketing_handoff');
  await processBatch(bookings, 'surgery_booking');

  // Collapse the chain: keep only the most recent fact per (case_id, fact_key)
  // as live; supersede the rest. Idempotent — re-running this step is a no-op
  // since freshly-inserted rows are already the latest.
  const supersedeRows = await sqlQuery<{ id: string }>(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY case_id, fact_key
                ORDER BY captured_at DESC, created_at DESC
              ) AS rn
         FROM pac_facts
        WHERE superseded_at IS NULL
     )
     UPDATE pac_facts
        SET superseded_at = NOW()
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
      RETURNING id`,
    []
  );

  return {
    formsScanned: handoffs.length + bookings.length,
    factsInserted,
    superseded: supersedeRows.length,
  };
}

// =============================================================================
// Step 31 — pac_suggestions backfill
// =============================================================================

export async function backfillSuggestions(): Promise<{
  casesScanned: number;
  totalFired: number;
  totalInserted: number;
  failures: number;
}> {
  const cases = await sqlQuery<{ case_id: string }>(
    `SELECT DISTINCT case_id
       FROM pac_facts
      WHERE superseded_at IS NULL`,
    []
  );

  let totalFired = 0;
  let totalInserted = 0;
  let failures = 0;

  for (const { case_id } of cases) {
    try {
      const result = await runAndPersist(case_id, { trigger: 'backfill' });
      totalFired += result.fired;
      totalInserted += result.inserted;
    } catch (err) {
      failures += 1;
      console.error(
        `[pcw2.3 backfill] case ${case_id} failed (non-fatal):`,
        (err as Error).message
      );
    }
  }

  return {
    casesScanned: cases.length,
    totalFired,
    totalInserted,
    failures,
  };
}

// =============================================================================
// Step 32 — resolution_state backfill
// =============================================================================

/**
 * Map existing v1 sub_state values to PCW2.0's new resolution_state column.
 * Pure SQL — idempotent (only touches rows still at default 'none').
 *
 *   sub_state='published'  → resolution_state='active_for_surgery'
 *   sub_state='cancelled'  → resolution_state='cancelled'
 *   anything else          → leave at 'none' (in-flight)
 */
export async function backfillResolutionState(): Promise<{ updated: number }> {
  const updated = await sqlQuery<{ case_id: string }>(
    `UPDATE pac_workspace_progress
        SET resolution_state = CASE
             WHEN sub_state = 'published' THEN 'active_for_surgery'
             WHEN sub_state = 'cancelled' THEN 'cancelled'
             ELSE resolution_state
           END,
            updated_at = NOW()
      WHERE resolution_state = 'none'
        AND sub_state IN ('published', 'cancelled')
      RETURNING case_id`,
    []
  );
  return { updated: updated.length };
}
