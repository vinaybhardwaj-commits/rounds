-- =============================================================================
-- migration-consultant-name-flex.sql
-- 25 Apr 2026
--
-- Decouples patient_threads.primary_consultant_id from the strict FK to
-- profiles(id). The Patient Overview Consultant picker now shares its data
-- source with the Marketing Handoff form (`/api/doctors`), which unions
-- profiles + reference_doctors. Reference-doctor entries are NOT in profiles,
-- so the FK rejected them with "violates foreign key constraint".
--
-- Strategy:
--   1. Drop FK constraint on patient_threads.primary_consultant_id.
--      Keep column as nullable UUID. Index already partial.
--   2. Add primary_consultant_name TEXT column. Stores resolved display name
--      so reads don't need to know which table the id lives in. Older rows
--      (where id was a profile UUID) get their name backfilled from the
--      JOIN; new writes carry it explicitly.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

-- 1. Drop FK constraint (name autoderived: <table>_<col>_fkey).
DO $drop_fk$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO v_constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
   WHERE tc.table_name = 'patient_threads'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name = 'primary_consultant_id'
   LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE patient_threads DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped FK constraint % on patient_threads.primary_consultant_id', v_constraint_name;
  ELSE
    RAISE NOTICE 'No FK constraint found on patient_threads.primary_consultant_id (already dropped)';
  END IF;
END
$drop_fk$;

-- 2. Add primary_consultant_name column.
ALTER TABLE patient_threads
  ADD COLUMN IF NOT EXISTS primary_consultant_name TEXT;

-- 3. Backfill existing rows from profiles.
UPDATE patient_threads pt
   SET primary_consultant_name = p.full_name
  FROM profiles p
 WHERE pt.primary_consultant_id = p.id
   AND pt.primary_consultant_name IS NULL
   AND pt.primary_consultant_id IS NOT NULL;

-- 4. Marker
INSERT INTO _migrations (name, applied_at)
VALUES ('25-apr-consultant-name-flex', NOW())
ON CONFLICT (name) DO NOTHING;

-- 5. Sanity check
DO $chk$
DECLARE
  v_has_col BOOL;
  v_still_fk INT;
  v_filled INT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patient_threads' AND column_name = 'primary_consultant_name'
  ) INTO v_has_col;

  SELECT COUNT(*) INTO v_still_fk
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
   WHERE tc.table_name = 'patient_threads'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name = 'primary_consultant_id';

  SELECT COUNT(*) INTO v_filled
    FROM patient_threads
   WHERE primary_consultant_name IS NOT NULL;

  IF NOT v_has_col THEN
    RAISE EXCEPTION 'primary_consultant_name column not installed';
  END IF;
  IF v_still_fk > 0 THEN
    RAISE EXCEPTION 'FK on primary_consultant_id still present (% constraints)', v_still_fk;
  END IF;
  RAISE NOTICE 'consultant-name-flex installed; % rows have name backfilled', v_filled;
END
$chk$;
