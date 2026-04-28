-- =============================================================================
-- PAC Coordinator Workspace v1 — PCW.0 migration #1
-- PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
-- SOP: EHRC/SOP/OT/001 v5.0 (Pre-Operative Assessment)
--
-- Per-case workspace state. 1:1 with surgical_cases for cases in PAC phase.
-- Sub-state column (D4) is purely additive — does NOT touch surgical_cases.state
-- which remains the canonical 16-value lifecycle.
--
-- Idempotent. Rollback: DROP TABLE pac_workspace_progress;
-- =============================================================================

CREATE TABLE IF NOT EXISTS pac_workspace_progress (
  case_id            UUID PRIMARY KEY REFERENCES surgical_cases(id) ON DELETE CASCADE,
  hospital_id        UUID NOT NULL REFERENCES hospitals(id),
  pac_mode           TEXT NOT NULL CHECK (pac_mode IN (
                       'in_person_opd', 'bedside', 'telephonic', 'paper_screening'
                     )),
  sub_state          TEXT NOT NULL DEFAULT 'prep_in_progress'
                       CHECK (sub_state IN (
                         'prep_in_progress',
                         'awaiting_results',
                         'awaiting_clearance',
                         'ready_for_anaesthetist',
                         'anaesthetist_examined',
                         'published',
                         'cancelled'
                       )),
  checklist_template TEXT NOT NULL,
  checklist_state    JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_pac_at   TIMESTAMPTZ,
  ipc_owner_id       UUID REFERENCES profiles(id),
  anaesthetist_id    UUID REFERENCES profiles(id),
  sla_deadline_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  archived_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pac_ws_hospital_substate
  ON pac_workspace_progress (hospital_id, sub_state)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pac_ws_sla
  ON pac_workspace_progress (sla_deadline_at)
  WHERE sub_state NOT IN ('published', 'cancelled') AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pac_ws_anaesthetist
  ON pac_workspace_progress (anaesthetist_id)
  WHERE anaesthetist_id IS NOT NULL AND archived_at IS NULL;

COMMENT ON TABLE pac_workspace_progress IS
  'PAC Coordinator Workspace v1 — per-case workspace state. 1:1 with surgical_cases. Sub-state additive to surgical_cases.state. Audit via api layer.';
