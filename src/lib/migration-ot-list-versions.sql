-- =============================================================================
-- Sprint 1 Day 2 — OT list snapshots (6 PM provisional + 9:30 PM final lock)
-- =============================================================================
-- Supports Decision D9 (OT Rhythm B): continuous editing + Week-Ahead Calendar
-- + 6 PM auto-snapshot + 9:30 PM one-click lock + WhatsApp dispatch.
--
-- Each hospital, each surgery day, can have:
--   • multiple provisional_6pm snapshots (re-fired daily; most recent wins)
--   • AT MOST ONE final_930pm (the locked dispatch, enforced by partial index)
--
-- snapshot_payload captures the fully-denormalized dispatch text (patient names
-- resolved, surgeon names resolved, order) so a re-render is idempotent even
-- if underlying cases change after the lock.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ot_list_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       UUID NOT NULL REFERENCES hospitals(id),
  -- The OT day this list covers (not the day it was generated).
  list_date         DATE NOT NULL,
  version_type      TEXT NOT NULL CHECK (version_type IN ('provisional_6pm', 'final_930pm')),
  -- Ordered list of surgical_cases in this snapshot.
  case_ids          UUID[] NOT NULL,
  -- Denormalized dispatch content (patient names, surgeon names, ordering,
  -- equipment flags, anaesthesia plan references) — immutable after creation.
  snapshot_payload  JSONB NOT NULL,
  locked_by         UUID REFERENCES profiles(id),
  dispatched_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_olv_hospital_date
  ON ot_list_versions(hospital_id, list_date DESC, created_at DESC);

-- Enforce at most ONE final_930pm lock per hospital per day.
-- Provisionals can be many (6 PM may re-fire if cases change after snapshot).
CREATE UNIQUE INDEX IF NOT EXISTS idx_olv_one_final_per_day
  ON ot_list_versions(hospital_id, list_date)
  WHERE version_type = 'final_930pm';

-- -----------------------------------------------------------------------------
-- Record migration
-- -----------------------------------------------------------------------------
INSERT INTO _migrations (name)
SELECT 'sprint1-ot-list-versions'
WHERE NOT EXISTS (
  SELECT 1 FROM _migrations WHERE name = 'sprint1-ot-list-versions'
);
