-- ============================================
-- Migration: reference-doctor-affiliations (MH.7a)
--
-- Per Multi-Hospital v2 PRD §7.7 + V's locked DHA design (27 Apr 2026 night):
-- option (b) M2M table for reference_doctor × hospital affiliations.
--
-- WHY a new table (not reuse existing doctor_hospital_affiliations):
--   - Existing DHA links profiles.id (Even staff users with login accounts)
--   - We need to link reference_doctors.id (the 217-doctor roster, includes
--     external/visiting consultants who don't have profile accounts)
--   - Polymorphic reuse rejected — loses FK integrity
--
-- Most doctors are single-hospital today (V said <5% are multi); the table
-- supports the rare cases + future expansion. reference_doctors.primary_hospital_id
-- stays as the auto-fill default (back-compat with FormRenderer's existing
-- doctor-pick → target_hospital auto-fill at line 263).
--
-- BACKFILL: 1 row per active reference_doctor with their current
-- primary_hospital_id, is_primary=TRUE. Multi-hospital additions later via
-- /admin/doctor-affiliations admin UI (MH.7b).
--
-- Idempotent: _migrations row guard 'mh-v2-7-affiliations'.
-- ============================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'mh-v2-7-affiliations') THEN

    -- 1. Create the M2M table.
    CREATE TABLE IF NOT EXISTS reference_doctor_hospital_affiliations (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reference_doctor_id   UUID NOT NULL REFERENCES reference_doctors(id) ON DELETE CASCADE,
      hospital_id           UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
      CONSTRAINT ux_rdha_doctor_hospital UNIQUE (reference_doctor_id, hospital_id)
    );

    -- 2. Indexes — both directions, since admin UI lists by hospital and
    --    validator looks up by doctor.
    CREATE INDEX IF NOT EXISTS idx_rdha_hospital_id
      ON reference_doctor_hospital_affiliations (hospital_id);
    CREATE INDEX IF NOT EXISTS idx_rdha_doctor_id
      ON reference_doctor_hospital_affiliations (reference_doctor_id);
    -- Partial index for the "primary affiliation" lookup (one row per doctor where is_primary=TRUE)
    CREATE INDEX IF NOT EXISTS idx_rdha_primary
      ON reference_doctor_hospital_affiliations (reference_doctor_id) WHERE is_primary = TRUE;

    -- 3. Backfill: 1 row per active reference_doctor with their current primary_hospital_id.
    --    INSERT ... ON CONFLICT DO NOTHING so re-running this migration is safe.
    INSERT INTO reference_doctor_hospital_affiliations
      (reference_doctor_id, hospital_id, is_primary, created_at, created_by)
    SELECT
      rd.id,
      rd.primary_hospital_id,
      TRUE,
      NOW(),
      NULL  -- system-seeded; no profile actor
    FROM reference_doctors rd
    WHERE rd.is_active = TRUE
      AND rd.primary_hospital_id IS NOT NULL
    ON CONFLICT (reference_doctor_id, hospital_id) DO NOTHING;

    RAISE NOTICE 'mh-v2-7-affiliations: created reference_doctor_hospital_affiliations + backfilled from reference_doctors.primary_hospital_id';
    INSERT INTO _migrations (name) VALUES ('mh-v2-7-affiliations');
  ELSE
    RAISE NOTICE 'mh-v2-7-affiliations: already applied, skipping';
  END IF;
END
$mig$;

-- Verification queries (run separately to confirm shape):
--
--   SELECT count(*) AS rdha_rows FROM reference_doctor_hospital_affiliations;
--   SELECT count(*) AS active_doctors_with_primary FROM reference_doctors
--     WHERE is_active = TRUE AND primary_hospital_id IS NOT NULL;
--   -- ↑ these two should match within 1 (the backfill writes 1 row per such doctor)
--
--   SELECT h.slug, count(*) AS affiliations
--   FROM reference_doctor_hospital_affiliations rdha
--   JOIN hospitals h ON h.id = rdha.hospital_id
--   GROUP BY h.slug ORDER BY h.slug;
--
