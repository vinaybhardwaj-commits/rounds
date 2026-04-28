-- =============================================================================
-- PAC Coordinator Workspace v1 — PCW.0 migration #2
-- PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
-- SOP: EHRC/SOP/OT/001 v5.0 §6.2 (ASA-driven workup grid)
--
-- Per-case lab/imaging order requests. One row per requested order
-- (CBC, RFT, ECG, etc.). Linked 1:1 to a tasks row that lives in the lab
-- tech's queue (D9). result_attached_url is an optional KEHR / lab portal
-- pointer (Q6) — no active KX integration in v1.
--
-- Idempotent. Rollback: DROP TABLE pac_orders;
-- =============================================================================

CREATE TABLE IF NOT EXISTS pac_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES surgical_cases(id) ON DELETE CASCADE,
  order_type          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN (
                          'requested', 'sample_drawn', 'in_lab',
                          'reported', 'reviewed', 'cancelled'
                        )),
  result_text         TEXT,
  result_attached_url TEXT,
  task_id             UUID REFERENCES tasks(id),
  requested_by        UUID REFERENCES profiles(id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reported_at         TIMESTAMPTZ,
  reviewed_at         TIMESTAMPTZ,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_pac_orders_case
  ON pac_orders (case_id);

CREATE INDEX IF NOT EXISTS idx_pac_orders_open
  ON pac_orders (status)
  WHERE status NOT IN ('reviewed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_pac_orders_task
  ON pac_orders (task_id)
  WHERE task_id IS NOT NULL;

COMMENT ON TABLE pac_orders IS
  'PAC Coordinator Workspace v1 — per-case order requests (labs, imaging, ECG). Mirrors SOP §6.2 ASA-driven workup. Linked to tasks via task_id.';
