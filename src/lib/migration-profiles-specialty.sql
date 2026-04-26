-- ============================================================================
-- migration-profiles-specialty.sql  (26 Apr 2026 follow-up FU6 / P2-5)
--
-- Adds profiles.specialty TEXT so app-user doctors can carry a clinical
-- specialty alongside reference_doctors. Lets the Patient Overview consultant
-- picker auto-fill target_department for ANY doctor (today only reference_
-- doctors entries had specialty populated; profiles entries were always NULL).
--
-- Backfill: copy reference_doctors.specialty onto profiles for rows where
-- a name+hospital match exists. Idempotent (only fills NULLs).
-- ============================================================================

BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS specialty TEXT;

-- Backfill from reference_doctors when a name+hospital match exists.
UPDATE profiles p
   SET specialty = rd.specialty
  FROM reference_doctors rd
 WHERE p.specialty IS NULL
   AND rd.specialty IS NOT NULL
   AND p.primary_hospital_id IS NOT NULL
   AND rd.primary_hospital_id = p.primary_hospital_id
   AND LOWER(TRIM(COALESCE(p.full_name, ''))) = LOWER(TRIM(COALESCE(rd.full_name, '')));

COMMIT;

-- Verification:
--   SELECT COUNT(*) FILTER (WHERE specialty IS NOT NULL) AS profiles_with_specialty,
--          COUNT(*) FILTER (WHERE specialty IS NULL) AS profiles_without_specialty
--     FROM profiles WHERE role = ANY(ARRAY['anesthesiologist', 'consultant', 'surgeon']);
