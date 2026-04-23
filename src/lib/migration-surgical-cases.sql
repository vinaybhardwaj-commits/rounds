-- =============================================================================
-- Sprint 1 Day 2 — Surgical case lifecycle tables
-- =============================================================================
-- Core coordination tables for the 10-state machine (+ postpone/cancel).
-- Option A purity: these store COORDINATION STATE ONLY, never clinical data.
-- KE remains the EMR — linkage via opaque `kx_*` IDs.
--
-- Tables:
--   • surgical_cases        — the case entity; state lives here
--   • case_state_events     — append-only log of every state transition
--   • pac_events            — each anaesthetist PAC publish action (Model 1)
--   • pre_op_verifications  — RMO day-of verification checks
--
-- State values (16 total; the "10-state" name refers to conceptual phases,
-- collapsing the 4 PAC outcomes into one phase):
--   draft, intake, pac_scheduled, pac_done,
--   fit, fit_conds, defer, unfit,           -- PAC outcomes
--   optimizing, scheduled, confirmed, verified, in_theatre, completed,
--   postponed, cancelled
--
-- All FKs to `surgical_cases` use ON DELETE CASCADE so a case delete cleans up
-- its events atomically. We don't expect to delete cases in normal flow —
-- use `state='cancelled'` or `archived_at` for soft delete.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. surgical_cases
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS surgical_cases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          UUID NOT NULL REFERENCES hospitals(id),
  patient_thread_id    UUID NOT NULL REFERENCES patient_threads(id),
  -- Source handoff (the form submission that spawned this case)
  handoff_submission_id UUID REFERENCES form_submissions(id),
  -- Surgery particulars (coordination state only — NOT clinical details)
  planned_procedure    TEXT,
  planned_surgery_date DATE,
  ot_room              INTEGER,
  surgeon_id           UUID REFERENCES profiles(id),
  anaesthetist_id      UUID REFERENCES profiles(id),
  urgency              TEXT CHECK (urgency IN ('elective', 'urgent', 'emergency')),
  -- 10-state machine (see header for full state list)
  state                TEXT NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft', 'intake', 'pac_scheduled', 'pac_done',
    'fit', 'fit_conds', 'defer', 'unfit',
    'optimizing', 'scheduled', 'confirmed', 'verified',
    'in_theatre', 'completed', 'postponed', 'cancelled'
  )),
  -- KE opaque linkage (Option A — never fetch INTO these, only store the IDs)
  kx_case_id           TEXT,
  kx_pac_record_id     TEXT,
  -- Audit + soft-delete
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           UUID REFERENCES profiles(id),
  archived_at          TIMESTAMPTZ
);

-- Hot query paths
CREATE INDEX IF NOT EXISTS idx_sc_hospital_state
  ON surgical_cases(hospital_id, state)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sc_patient
  ON surgical_cases(patient_thread_id);

CREATE INDEX IF NOT EXISTS idx_sc_planned_date
  ON surgical_cases(hospital_id, planned_surgery_date)
  WHERE state NOT IN ('completed', 'cancelled') AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sc_handoff
  ON surgical_cases(handoff_submission_id);

-- -----------------------------------------------------------------------------
-- 2. case_state_events — append-only log
-- -----------------------------------------------------------------------------
-- Invariant: every state mutation on surgical_cases MUST be accompanied by an
-- INSERT here. Never UPDATE surgical_cases.state without an event row.
-- `from_state` is NULL on the initial insert (draft creation).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_state_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            UUID NOT NULL REFERENCES surgical_cases(id) ON DELETE CASCADE,
  from_state         TEXT,
  to_state           TEXT NOT NULL,
  transition_reason  TEXT,
  actor_profile_id   UUID REFERENCES profiles(id),
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cse_case_time
  ON case_state_events(case_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 3. pac_events — anaesthetist publishes PAC outcome (Decision D7, Model 1)
-- -----------------------------------------------------------------------------
-- Separate from case_state_events because:
--   • Every PAC publish creates 1 pac_event row AND 1 case_state_event row
--   • pac_events carries the anaesthetist-specific fields (outcome + notes)
--   • case_state_events is the generic state log; this is the domain log.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pac_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL REFERENCES surgical_cases(id) ON DELETE CASCADE,
  anaesthetist_id   UUID NOT NULL REFERENCES profiles(id),
  outcome           TEXT NOT NULL CHECK (outcome IN ('fit', 'fit_conds', 'defer', 'unfit')),
  published_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Operational notes only — NO clinical reasoning. Clinical reasoning lives
  -- in KE (kx_pac_record_id points there).
  notes             TEXT,
  kx_pac_record_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_pe_case ON pac_events(case_id);
CREATE INDEX IF NOT EXISTS idx_pe_anaesthetist ON pac_events(anaesthetist_id, published_at DESC);

-- -----------------------------------------------------------------------------
-- 4. pre_op_verifications — RMO day-of checks
-- -----------------------------------------------------------------------------
-- Verification moves the case state `confirmed → verified`. The actual checks
-- (fasting, consent, armband, marking) are stored as a JSONB checklist so we
-- can extend without schema churn.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pre_op_verifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES surgical_cases(id) ON DELETE CASCADE,
  rmo_profile_id   UUID NOT NULL REFERENCES profiles(id),
  verified_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checklist        JSONB NOT NULL DEFAULT '{}'::jsonb,
  issues_flagged   TEXT
);

CREATE INDEX IF NOT EXISTS idx_pov_case ON pre_op_verifications(case_id);

-- -----------------------------------------------------------------------------
-- 5. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO _migrations (name)
SELECT 'sprint1-surgical-cases'
WHERE NOT EXISTS (
  SELECT 1 FROM _migrations WHERE name = 'sprint1-surgical-cases'
);
