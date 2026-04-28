-- =============================================================================
-- PAC Coordinator Workspace v1 — PCW.0 migration #3
-- PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
-- SOP: EHRC/SOP/OT/001 v5.0 §6.3 (Comorbidity → Specialist mapping)
--
-- Per-case specialist clearance requests. One row per specialty
-- (Cardio, Pulm, Endo, etc.). Linked 1:1 to a tasks row in the specialist's
-- queue (D9). cleared_with_conditions captures conditions_text for the
-- anaesthetist to fold into final outcome.
--
-- Idempotent. Rollback: DROP TABLE pac_clearances;
-- =============================================================================

CREATE TABLE IF NOT EXISTS pac_clearances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL REFERENCES surgical_cases(id) ON DELETE CASCADE,
  specialty         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'requested'
                      CHECK (status IN (
                        'requested', 'specialist_reviewing',
                        'cleared', 'cleared_with_conditions',
                        'declined', 'cancelled'
                      )),
  conditions_text   TEXT,
  task_id           UUID REFERENCES tasks(id),
  assigned_to       UUID REFERENCES profiles(id),
  requested_by      UUID REFERENCES profiles(id),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at      TIMESTAMPTZ,
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_pac_clearances_case
  ON pac_clearances (case_id);

CREATE INDEX IF NOT EXISTS idx_pac_clearances_assigned
  ON pac_clearances (assigned_to)
  WHERE status NOT IN ('cleared', 'cleared_with_conditions', 'declined', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_pac_clearances_task
  ON pac_clearances (task_id)
  WHERE task_id IS NOT NULL;

COMMENT ON TABLE pac_clearances IS
  'PAC Coordinator Workspace v1 — per-case specialist clearance requests. Mirrors SOP §6.3 comorbidity → specialist routing. Linked to tasks via task_id.';
