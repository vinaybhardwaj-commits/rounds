-- ============================================
-- v1.1 #9 (28 Apr 2026) — Clone all EHRC departments to EHBR
--
-- Why: V (multi-hospital user) noticed his ChannelSidebar shows
-- "EHRC · Departments (19)" but no EHBR equivalent. The seed-channels
-- route loops over the departments table and creates a {slug}-{hospital_slug}
-- channel per row. Since the table only has EHRC rows, only -ehrc channels
-- exist. After this migration + a re-run of POST /api/admin/getstream/
-- seed-channels, EHBR will have its own 19 dept channels.
--
-- Schema constraint changes:
--   1. Drop UNIQUE(slug) — was a single-hospital assumption from before MH.
--   2. Add UNIQUE(slug, hospital_id) — proper per-hospital uniqueness.
--
-- Data:
--   3. Clone every active EHRC department row to EHBR (idempotent via
--      ON CONFLICT DO NOTHING on the new composite key).
--
-- Idempotent (guarded with _migrations).
-- ============================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'v1.1.9-departments-ehbr-clone') THEN

    -- 1. Drop UNIQUE(slug). Constraint name is auto-generated; look it up.
    -- Pattern: <table>_<column>_key. PostgreSQL default for UNIQUE is "departments_slug_key".
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'departments'::regclass
        AND conname = 'departments_slug_key'
    ) THEN
      ALTER TABLE departments DROP CONSTRAINT departments_slug_key;
      RAISE NOTICE 'Dropped UNIQUE(slug) constraint departments_slug_key';
    END IF;

    -- 2. Add UNIQUE(slug, hospital_id). IF NOT EXISTS not supported on
    -- ADD CONSTRAINT — guard via pg_constraint lookup.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'departments'::regclass
        AND conname = 'departments_slug_hospital_id_key'
    ) THEN
      ALTER TABLE departments ADD CONSTRAINT departments_slug_hospital_id_key UNIQUE (slug, hospital_id);
      RAISE NOTICE 'Added UNIQUE(slug, hospital_id) constraint';
    END IF;

    -- 3. Clone every active EHRC department to EHBR. ON CONFLICT against the
    -- new composite key in case this somehow runs twice.
    INSERT INTO departments (name, slug, hospital_id, is_active, head_profile_id)
    SELECT
      d.name,
      d.slug,
      (SELECT id FROM hospitals WHERE slug = 'ehbr'),
      d.is_active,
      NULL  -- head_profile_id starts NULL; super_admin can assign later
    FROM departments d
    WHERE d.hospital_id = (SELECT id FROM hospitals WHERE slug = 'ehrc')
      AND d.is_active = true
    ON CONFLICT (slug, hospital_id) DO NOTHING;

    RAISE NOTICE 'v1.1.9 cloned % EHRC departments to EHBR',
      (SELECT COUNT(*) FROM departments WHERE hospital_id = (SELECT id FROM hospitals WHERE slug = 'ehbr'));

    -- 4. Record the migration.
    INSERT INTO _migrations (name, applied_at)
    VALUES ('v1.1.9-departments-ehbr-clone', NOW());

  ELSE
    RAISE NOTICE 'v1.1.9-departments-ehbr-clone already applied, skipping';
  END IF;
END
$mig$;

-- Verification queries (run manually after to confirm):
-- SELECT h.slug, COUNT(*) FROM departments d JOIN hospitals h ON h.id = d.hospital_id GROUP BY h.slug;
--   ehrc | 19
--   ehbr | 19
-- (EHIN will appear as 0 until activated.)
