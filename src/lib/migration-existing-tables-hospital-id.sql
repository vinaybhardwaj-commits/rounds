-- =============================================================================
-- Sprint 1 Day 2 — hospital_id on existing tenancy-scoped tables
-- =============================================================================
-- Adds `hospital_id` to:
--   • patient_threads
--   • form_submissions
-- Plus new columns on form_submissions:
--   • cc_card_message_id    (GetStream message ID for the CC channel card)
--   • ot_card_message_id    (GetStream message ID for the OT channel card)
--
-- Per V + sprint plan: `tasks` table deferred (does not exist in prod as of
-- baseline 23 Apr 2026; will be created in Sprint 2 when its first consumer
-- lands, with hospital_id baked in from the start).
--
-- Idempotent: IF NOT EXISTS / WHERE guards everywhere. Safe to re-run.
-- NOT NULL is applied ONLY after backfill completes — sequence matters.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. patient_threads.hospital_id
-- -----------------------------------------------------------------------------
ALTER TABLE patient_threads
  ADD COLUMN IF NOT EXISTS hospital_id UUID REFERENCES hospitals(id);

UPDATE patient_threads
SET    hospital_id = (SELECT id FROM hospitals WHERE slug = 'ehrc')
WHERE  hospital_id IS NULL;

-- Only set NOT NULL after backfill succeeds. If this fails, investigate which
-- rows are still NULL and hand-fix before re-running the ALTER.
ALTER TABLE patient_threads
  ALTER COLUMN hospital_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pt_hospital ON patient_threads(hospital_id);

-- -----------------------------------------------------------------------------
-- 2. form_submissions.hospital_id + card-message linkage
-- -----------------------------------------------------------------------------
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS hospital_id UUID REFERENCES hospitals(id);

UPDATE form_submissions
SET    hospital_id = (SELECT id FROM hospitals WHERE slug = 'ehrc')
WHERE  hospital_id IS NULL;

ALTER TABLE form_submissions
  ALTER COLUMN hospital_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fs_hospital ON form_submissions(hospital_id);

-- GetStream message IDs for the "card" messages posted to CC and OT channels
-- when a handoff submits. Nullable because legacy submissions don't have them.
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS cc_card_message_id TEXT;

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS ot_card_message_id TEXT;

-- -----------------------------------------------------------------------------
-- 3. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO _migrations (name)
SELECT 'sprint1-existing-tables-hospital-id'
WHERE NOT EXISTS (
  SELECT 1 FROM _migrations WHERE name = 'sprint1-existing-tables-hospital-id'
);
