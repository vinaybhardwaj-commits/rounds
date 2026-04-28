-- =============================================================================
-- OT Management Module v1 — OT.1 migration
-- PRD: Daily Dash EHRC/OT-MANAGEMENT-MODULE-PRD.md (v1.1 LOCKED 28 Apr 2026)
--
-- Two changes (both purely additive):
--   1. New table `ot_coordinator_notes` — per-hospital persistent shared
--      notepad (PRD D8 + Q7 4KB cap). Glass-edit + audit via the audit() helper
--      at the API layer; no DB triggers.
--   2. New index `idx_cse_to_state_time` on case_state_events(to_state,
--      occurred_at DESC) — supports KPI queries on cancelled/in_theatre
--      transitions (PRD KPI strip).
--
-- Idempotent — safe to re-run via /api/admin/migrate.
-- Rollback: DROP TABLE ot_coordinator_notes; DROP INDEX idx_cse_to_state_time;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ot_coordinator_notes
-- -----------------------------------------------------------------------------
-- One row per hospital. Glass: any signed-in user can read + update via
-- /api/ot-management/notes; every UPDATE generates an audit_log row with the
-- prior body in payload_before so /admin/audit-log + the inline history modal
-- (PRD §9 Q3) can show diffs over time.
--
-- 4 KB body cap enforced by CHECK + by the API layer (returns 413 above).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_coordinator_notes (
  hospital_id      UUID PRIMARY KEY REFERENCES hospitals(id) ON DELETE CASCADE,
  body             TEXT NOT NULL DEFAULT '' CHECK (octet_length(body) <= 4096),
  updated_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by_name  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ot_coordinator_notes IS
  'OT Module v1 — per-hospital persistent shared notepad. 4KB cap. Glass-edit. Audit via api layer.';

-- -----------------------------------------------------------------------------
-- 2. case_state_events index for KPI queries
-- -----------------------------------------------------------------------------
-- Supports:
--   • Equipment-blocked cancellations 7d KPI (to_state='cancelled' filter)
--   • On-time first-case start KPI (to_state='in_theatre' filter)
-- Without this, KPI queries fall back to seq-scan against an event log that
-- grows unbounded.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cse_to_state_time
  ON case_state_events(to_state, occurred_at DESC);

-- =============================================================================
-- Verification queries (run after applying):
--   SELECT * FROM ot_coordinator_notes;       -- expect 0 rows initially
--   \d+ ot_coordinator_notes                  -- 5 cols, body cap CHECK present
--   \di+ idx_cse_to_state_time                -- index exists, btree, partial=NO
-- =============================================================================
