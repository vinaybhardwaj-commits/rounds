-- ============================================================================
-- migration-equipment-case-optional.sql  (26 Apr 2026 audit follow-up)
--
-- Lets equipment_requests exist without a linked surgical_case (V's bug
-- report — modal opened from a non-case context shouldn't force an arbitrary
-- case selection). Adds:
--   - case_id NULLABLE
--   - hospital_id NOT NULL (denormalized, backfilled from case.hospital_id)
--   - rental_description TEXT NULLABLE (free-text 'what is being rented')
--
-- Idempotent. Safe to re-run.
-- ============================================================================

BEGIN;

-- 1. Allow case_id to be NULL.
ALTER TABLE equipment_requests
  ALTER COLUMN case_id DROP NOT NULL;

-- 2. Denormalize hospital_id so tenancy gates work without a case.
ALTER TABLE equipment_requests
  ADD COLUMN IF NOT EXISTS hospital_id UUID;

-- 3. Backfill from the linked case for existing rows.
UPDATE equipment_requests er
   SET hospital_id = sc.hospital_id
  FROM surgical_cases sc
 WHERE er.case_id = sc.id
   AND er.hospital_id IS NULL;

-- 4. Sanity check — fail loudly if any pre-existing row could not be backfilled.
DO $$
DECLARE missing INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing FROM equipment_requests WHERE hospital_id IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'equipment_requests has % rows with NULL hospital_id after backfill — investigate before proceeding', missing;
  END IF;
END $$;

-- 5. Lock NOT NULL.
ALTER TABLE equipment_requests
  ALTER COLUMN hospital_id SET NOT NULL;

-- 6. FK so the column stays consistent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'equipment_requests_hospital_id_fkey'
  ) THEN
    ALTER TABLE equipment_requests
      ADD CONSTRAINT equipment_requests_hospital_id_fkey
        FOREIGN KEY (hospital_id) REFERENCES hospitals(id);
  END IF;
END $$;

-- 7. Index to speed up tenancy-scoped reads.
CREATE INDEX IF NOT EXISTS idx_er_hospital ON equipment_requests(hospital_id);

-- 8. Free-text rental description (visible only when is_rental = TRUE in the UI).
ALTER TABLE equipment_requests
  ADD COLUMN IF NOT EXISTS rental_description TEXT;

COMMIT;

-- Verification:
--   SELECT column_name, is_nullable, data_type FROM information_schema.columns
--    WHERE table_name = 'equipment_requests'
--      AND column_name IN ('case_id', 'hospital_id', 'rental_description')
--    ORDER BY column_name;
--   case_id            | YES | uuid
--   hospital_id        | NO  | uuid
--   rental_description | YES | text
