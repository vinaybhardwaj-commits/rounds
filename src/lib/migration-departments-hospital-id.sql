-- ============================================
-- Sprint 2 Day 9 migration — add hospital_id to departments
--
-- Why now: Sprint 1 added hospital_id to patient_threads + form_submissions
-- but missed departments. Day 9 channel migration needs hospital_id on each
-- department so we can seed GetStream channels with {slug}-{hospital_slug}
-- suffix and let ChannelSidebar group by hospital.
--
-- Safe: NULLABLE first + backfill all existing rows to EHRC + SET NOT NULL.
-- All 19 existing departments are EHRC today.
--
-- Idempotent (guard with WHERE NOT EXISTS against _migrations).
-- ============================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'sprint2-departments-hospital-id') THEN

    -- 1. Add column NULLABLE
    ALTER TABLE departments
      ADD COLUMN IF NOT EXISTS hospital_id UUID REFERENCES hospitals(id) ON DELETE RESTRICT;

    -- 2. Backfill all existing departments to EHRC (single active hospital today).
    UPDATE departments
    SET hospital_id = (SELECT id FROM hospitals WHERE slug = 'ehrc')
    WHERE hospital_id IS NULL;

    -- 3. Enforce NOT NULL now that all rows are backfilled.
    ALTER TABLE departments
      ALTER COLUMN hospital_id SET NOT NULL;

    -- 4. Index for hospital-scoped queries (sidebar group lookup).
    CREATE INDEX IF NOT EXISTS idx_departments_hospital_id ON departments(hospital_id);

    -- 5. Record the migration.
    INSERT INTO _migrations (name, applied_at)
    VALUES ('sprint2-departments-hospital-id', NOW());

    RAISE NOTICE 'sprint2-departments-hospital-id applied — % departments backfilled', (SELECT COUNT(*) FROM departments);
  ELSE
    RAISE NOTICE 'sprint2-departments-hospital-id already applied, skipping';
  END IF;
END
$mig$;
