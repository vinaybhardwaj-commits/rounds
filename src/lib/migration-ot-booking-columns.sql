-- ============================================================================
-- migration-ot-booking-columns.sql  (26 Apr 2026 — V's OT calendar redesign)
--
-- Adds the 8 booking-card columns the redesign needs on top of surgical_cases:
--   assist_surgeon_name   TEXT NULL  — assist surgeon (free text or doctor-roster name)
--   anaesthetist_name     TEXT NULL  — companion to anaesthetist_id; lets us
--                                      render names without an extra lookup,
--                                      and supports off-roster anaesthetists.
--   anae_type             TEXT NULL  — Block / GA / LA / SA / Other
--   equipment_status      TEXT NULL  — Ready / CSSD / Outside / Other
--   consumables_status    TEXT NULL  — Ready / Sourcing / Other
--   ot_remarks            TEXT NULL  — free-text remarks column
--   planned_start_time    TEXT NULL  — HH:MM string (timezone-free; avoids
--                                      DST traps for paper-style schedules)
--   case_serial_in_slot   INT  NULL  — 1, 2, 3, … the n-th case in the OT/day
--
-- All columns nullable + idempotent ADD COLUMN IF NOT EXISTS.
-- ============================================================================

BEGIN;

ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS assist_surgeon_name TEXT;
ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS anaesthetist_name   TEXT;
ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS anae_type           TEXT;
ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS equipment_status    TEXT;
ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS consumables_status  TEXT;
ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS ot_remarks          TEXT;
ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS planned_start_time  TEXT;
ALTER TABLE surgical_cases ADD COLUMN IF NOT EXISTS case_serial_in_slot INT;

-- Helpful index for "next available serial in this slot" lookups.
CREATE INDEX IF NOT EXISTS idx_sc_slot_serial
  ON surgical_cases(hospital_id, planned_surgery_date, ot_room, case_serial_in_slot)
  WHERE archived_at IS NULL AND planned_surgery_date IS NOT NULL AND ot_room IS NOT NULL;

COMMIT;

-- Verification:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'surgical_cases' AND column_name IN
--    ('assist_surgeon_name', 'anaesthetist_name', 'anae_type', 'equipment_status',
--     'consumables_status', 'ot_remarks', 'planned_start_time', 'case_serial_in_slot')
--    ORDER BY column_name;
