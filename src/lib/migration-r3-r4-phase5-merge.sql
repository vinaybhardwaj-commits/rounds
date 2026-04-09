-- =============================================================================
-- R.3 + R.4 Phase 5.1 — Merge Support for Dedup Hub
-- =============================================================================
-- Adds two nullable columns to patient_threads that let us trace "this row
-- was merged into that one" without parsing dedup_log.
--
-- Both columns are additive and nullable. No constraint changes on existing
-- columns, no data backfill, no index rebuilds.
--
-- Safe to re-run (IF NOT EXISTS everywhere).
-- =============================================================================

-- Pointer from the merged-away (loser) row back to the surviving (winner) row.
-- NULL on all rows that have never been merged. When set, the loser row is
-- guaranteed to also have archived_at != NULL.
ALTER TABLE patient_threads
  ADD COLUMN IF NOT EXISTS merged_into_id UUID
  REFERENCES patient_threads(id) ON DELETE SET NULL;

-- Timestamp of the merge. Paired with merged_into_id so that audit views can
-- order merges chronologically without joining against dedup_log.
ALTER TABLE patient_threads
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

-- Partial index — only index rows that actually were merged. Keeps the index
-- tiny in steady state.
CREATE INDEX IF NOT EXISTS idx_pt_merged_into
  ON patient_threads (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- =============================================================================
-- END Phase 5.1 migration
-- =============================================================================
