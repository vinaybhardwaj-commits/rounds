-- ============================================
-- Migration: multi-hospital-v2 (MH.1)
--
-- Per Multi-Hospital v2 PRD locked decisions Q2 (primary_hospital_id NOT NULL)
-- and Q9 (hospital_admin role). Most other PRD §5 items already shipped from
-- prior multi-hospital sprint (Sprints 1-3.5 of post-demo build):
--   - hospitals.is_active column           ✅ shipped
--   - all 3 hospitals seeded               ✅ shipped
--   - patient_threads.hospital_id          ✅ shipped
--   - doctor_hospital_affiliations table   ✅ shipped (links profiles, see MH.7)
--   - profiles.primary_hospital_id column  ✅ shipped (just NULLABLE)
--
-- This migration completes only the leftover bits:
--   1a. ALTER profiles.primary_hospital_id SET NOT NULL (verified 0 NULL rows)
--   1b. Add 'hospital_admin' to profiles_role_check CHECK constraint
--       (NOTE: profiles.role is TEXT with CHECK, not an enum — discovered during
--        MH.1 recon; PRD's "ADD VALUE to user_role enum" framing was wrong)
--
-- Idempotent: each step has its own _migrations row guard.
-- ============================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'mh-v2-1') THEN
    ALTER TABLE profiles ALTER COLUMN primary_hospital_id SET NOT NULL;
    RAISE NOTICE 'mh-v2-1: profiles.primary_hospital_id is now NOT NULL';
    INSERT INTO _migrations (name) VALUES ('mh-v2-1');
  ELSE
    RAISE NOTICE 'mh-v2-1: already applied, skipping NOT NULL alter';
  END IF;
END
$mig$;

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'mh-v2-1b') THEN
    -- Drop existing constraint + recreate with hospital_admin added.
    -- Whitelist preserved from prior `profiles_role_check` definition + 'hospital_admin' inserted
    -- right after super_admin to keep admin-tier roles together.
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
    ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN (
      'super_admin',
      'hospital_admin',
      'department_head',
      'staff',
      'ip_coordinator',
      'anesthesiologist',
      'ot_coordinator',
      'nurse',
      'billing_executive',
      'insurance_coordinator',
      'pharmacist',
      'physiotherapist',
      'marketing_executive',
      'clinical_care',
      'pac_coordinator',
      'administrator',
      'medical_administrator',
      'operations_manager',
      'unit_head',
      'marketing',
      'guest'
    ));
    RAISE NOTICE 'mh-v2-1b: profiles_role_check recreated with hospital_admin';
    INSERT INTO _migrations (name) VALUES ('mh-v2-1b');
  ELSE
    RAISE NOTICE 'mh-v2-1b: already applied, skipping';
  END IF;
END
$mig$;
