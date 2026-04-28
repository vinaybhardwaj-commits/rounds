-- =============================================================================
-- PAC Coordinator Workspace v1 — PCW.0 migration #7
-- PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
--
-- Adds surgical_cases.pac_workspace_started_at — denormalised timestamp set
-- when /api/pac-workspace endpoint first creates the per-case row in
-- pac_workspace_progress. Avoids an outer JOIN every PAC queue render in
-- /api/ot-management/today (~30 patients × 4 lookups = 120 extra reads).
--
-- Idempotent. Rollback: ALTER TABLE surgical_cases DROP COLUMN pac_workspace_started_at;
-- =============================================================================

ALTER TABLE surgical_cases
  ADD COLUMN IF NOT EXISTS pac_workspace_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sc_pac_ws_started
  ON surgical_cases (pac_workspace_started_at)
  WHERE pac_workspace_started_at IS NOT NULL;
