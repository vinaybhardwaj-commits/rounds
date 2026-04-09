-- =============================================================================
-- R.3 + R.4 — Non-LSQ Intake Pathways + UHID Dedup & Member Recognition
-- =============================================================================
-- Phase 1 migration: pg_trgm extension, new patient_threads columns,
-- normalized phone/name indexes, dedup_candidates + dedup_log tables,
-- source_type backfill for existing rows.
--
-- All changes are additive. Safe to re-run (IF NOT EXISTS everywhere).
-- No column drops, no constraint changes on existing columns.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. pg_trgm extension (required for fuzzy name matching)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- 2. New columns on patient_threads
--    (age, gender, phone, whatsapp_number, city already exist — not re-added)
-- -----------------------------------------------------------------------------

-- Source tracking (how did this patient enter the funnel)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS source_detail TEXT;

-- Returning patient tracking (bumped when a phone match links an incoming visit)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS is_returning_patient BOOLEAN DEFAULT FALSE;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS returning_patient_count INTEGER DEFAULT 0;

-- Possible duplicate flag (set when Layer 2 fuzzy match creates a dedup_candidate)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS is_possible_duplicate BOOLEAN DEFAULT FALSE;

-- Existing member recognition (manual entry today, automation later)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS is_existing_member BOOLEAN DEFAULT FALSE;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS member_type TEXT;
-- member_type values: corporate | insurance | hmo | loyalty | other | NULL

-- Intake-specific clinical fields (separate from LSQ's `ailment`)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS chief_complaint TEXT;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS insurance_status TEXT;
-- insurance_status values: self_pay | insured_checking | insured_confirmed | unknown

-- Manual-intake target department (free text — department_id FK is LSQ-set only)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS target_department TEXT;

-- Referral details (conditional on source_type='referral')
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS referral_details TEXT;

-- -----------------------------------------------------------------------------
-- 3. Normalized lookup indexes
--    Phone is stored as "+91-9019062373" etc. — normalize to last 10 digits
--    for fast exact-match dedup. Uses regexp_replace which is IMMUTABLE in PG.
-- -----------------------------------------------------------------------------

-- Normalized phone functional index (last 10 digits)
CREATE INDEX IF NOT EXISTS idx_pt_phone_norm
  ON patient_threads (RIGHT(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10))
  WHERE phone IS NOT NULL AND phone <> '';

-- Normalized whatsapp functional index (last 10 digits)
CREATE INDEX IF NOT EXISTS idx_pt_whatsapp_norm
  ON patient_threads (RIGHT(regexp_replace(COALESCE(whatsapp_number, ''), '\D', '', 'g'), 10))
  WHERE whatsapp_number IS NOT NULL AND whatsapp_number <> '';

-- Trigram GIN index on patient_name for fuzzy fuzzy matching
CREATE INDEX IF NOT EXISTS idx_pt_name_trgm
  ON patient_threads USING gin (patient_name gin_trgm_ops);

-- Source type filter index (common admin queries)
CREATE INDEX IF NOT EXISTS idx_pt_source_type
  ON patient_threads (source_type)
  WHERE source_type IS NOT NULL;

-- Possible duplicate flag index (for /admin/dedup queries)
CREATE INDEX IF NOT EXISTS idx_pt_possible_duplicate
  ON patient_threads (is_possible_duplicate)
  WHERE is_possible_duplicate = TRUE;

-- -----------------------------------------------------------------------------
-- 4. dedup_candidates table — unresolved fuzzy matches awaiting admin review
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dedup_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  new_thread_id   UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
  existing_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
  similarity      NUMERIC(4,3) NOT NULL, -- 0.000 to 1.000
  match_type      TEXT NOT NULL,         -- 'name_trgm' | 'name_phone_mismatch' | 'manual_flag'
  match_fields    JSONB,                 -- { name_sim: 0.72, city_match: true, ... }
  status          TEXT NOT NULL DEFAULT 'pending',
                  -- 'pending' | 'merged' | 'distinct' | 'ignored'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,

  CONSTRAINT dedup_candidates_not_self CHECK (new_thread_id <> existing_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_dedup_candidates_status
  ON dedup_candidates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dedup_candidates_new_thread
  ON dedup_candidates (new_thread_id);

CREATE INDEX IF NOT EXISTS idx_dedup_candidates_existing_thread
  ON dedup_candidates (existing_thread_id);

-- Prevent duplicate pending candidates for the same pair
CREATE UNIQUE INDEX IF NOT EXISTS uq_dedup_candidates_pair_pending
  ON dedup_candidates (LEAST(new_thread_id, existing_thread_id), GREATEST(new_thread_id, existing_thread_id))
  WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 5. dedup_log table — audit trail for every dedup decision
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dedup_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action            TEXT NOT NULL,
                    -- 'link' | 'flag' | 'create' | 'merge' | 'split' | 'ignore'
  source_thread_id  UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
  target_thread_id  UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
  match_layer       INTEGER, -- 1 = phone exact, 2 = name trigram, NULL = manual
  similarity        NUMERIC(4,3),
  reason            TEXT,
  metadata          JSONB,  -- { phone_normalized, name_sim, actor_role, endpoint, ... }
  actor_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_name        TEXT,
  endpoint          TEXT,   -- '/api/patients' | 'lsq-sync' | 'kx-import' | '/admin/dedup'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dedup_log_created
  ON dedup_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dedup_log_action
  ON dedup_log (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dedup_log_source_thread
  ON dedup_log (source_thread_id);

CREATE INDEX IF NOT EXISTS idx_dedup_log_target_thread
  ON dedup_log (target_thread_id);

-- -----------------------------------------------------------------------------
-- 6. Backfill source_type on existing rows
--    Rule: lsq_lead_id IS NOT NULL → 'lsq', else → 'manual'
--    (KX-imported rows cannot be distinguished from manual today — document
--    as known limitation. Future: add source_type tagging at import time
--    via Phase 4.)
-- -----------------------------------------------------------------------------
UPDATE patient_threads
SET source_type = 'lsq'
WHERE source_type IS NULL AND lsq_lead_id IS NOT NULL;

UPDATE patient_threads
SET source_type = 'manual'
WHERE source_type IS NULL;

-- =============================================================================
-- END R.3 + R.4 Phase 1 migration
-- =============================================================================
