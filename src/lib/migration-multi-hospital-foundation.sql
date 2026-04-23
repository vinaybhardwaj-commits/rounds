-- =============================================================================
-- Sprint 1 — Multi-Hospital Foundation
-- =============================================================================
-- Creates `hospitals`, `user_hospital_access`, `doctor_hospital_affiliations`
-- tables. Extends `profiles` with `primary_hospital_id` + `role_scope`.
-- Backfills all 29 existing profiles with EHRC as primary and sensible scope.
-- Ships the `user_accessible_hospital_ids(UUID)` function used by every
-- tenancy-scoped endpoint in Sprint 1+.
--
-- All changes are additive. Safe to re-run (IF NOT EXISTS + ON CONFLICT + UPDATE
-- guards everywhere). No column drops, no destructive renames.
--
-- Design decisions baked in (per PRD v3.0 §3 + §5):
--   M2: role_scope ∈ { 'central', 'hospital_bound', 'multi_hospital' }
--       - central:       sees all active hospitals (marketing, super_admin)
--       - hospital_bound: sees ONE hospital (IP Coord, OT Coord, staff)
--       - multi_hospital: sees primary + explicit grants (GMs, Hospital Director)
--   M4: IP Coord is hospital_bound (Tamanna = EHRC; future EHBR/EHIN get their own)
--   M5: GM default hospital_bound + opt-in multi-hospital via user_hospital_access
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `hospitals` table + seed
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitals (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   TEXT NOT NULL UNIQUE,               -- 'ehrc', 'ehbr', 'ehin'
  name                   TEXT NOT NULL,                       -- full name
  short_name             TEXT NOT NULL,                       -- 'EHRC', 'EHBR', 'EHIN'
  is_active              BOOLEAN NOT NULL DEFAULT FALSE,
  timezone               TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ot_room_count          INTEGER,                             -- known at seed time; nullable for future hospitals
  sla_config             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- hospital-specific SLA overrides; fallback to EHRC defaults if empty
  whatsapp_surgeon_list  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of {name, phone} for 9:30 PM dispatch
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hospitals_active ON hospitals(is_active) WHERE is_active = TRUE;

-- Seed 3 hospitals — EHRC active (live today), EHBR + EHIN inactive placeholders.
-- EHIN is flagged under construction.
INSERT INTO hospitals (slug, name, short_name, is_active, ot_room_count)
VALUES
  ('ehrc', 'Even Hospital Race Course Road', 'EHRC', TRUE,  3),
  ('ehbr', 'Even Hospital Brookefield',      'EHBR', FALSE, 3),
  ('ehin', 'Even Hospital Indiranagar',      'EHIN', FALSE, 3)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. `profiles` extensions — primary_hospital_id + role_scope
-- -----------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS primary_hospital_id UUID REFERENCES hospitals(id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role_scope TEXT
  NOT NULL DEFAULT 'hospital_bound'
  CHECK (role_scope IN ('central', 'hospital_bound', 'multi_hospital'));

CREATE INDEX IF NOT EXISTS idx_profiles_primary_hospital ON profiles(primary_hospital_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role_scope ON profiles(role_scope);

-- -----------------------------------------------------------------------------
-- 3. Backfill existing profiles
-- -----------------------------------------------------------------------------
-- Every existing profile belongs to EHRC (the only active hospital today).
UPDATE profiles
SET    primary_hospital_id = (SELECT id FROM hospitals WHERE slug = 'ehrc')
WHERE  primary_hospital_id IS NULL;

-- Derive role_scope from existing role column.
--   central:       super_admin, administrator, medical_administrator, marketing_executive
--                  (the last is future-proofing — currently 0 rows at baseline)
--   hospital_bound: everyone else (staff, department_head, unit_head,
--                   billing_executive, operations_manager)
-- Guarded so a re-run won't revert a manually-edited scope.
UPDATE profiles
SET    role_scope = 'central'
WHERE  role IN ('super_admin', 'administrator', 'medical_administrator', 'marketing_executive')
  AND  role_scope = 'hospital_bound';  -- only touch rows still at the default

-- -----------------------------------------------------------------------------
-- 4. `user_hospital_access` — explicit cross-hospital grants for multi_hospital users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_hospital_access (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  hospital_id  UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by   UUID REFERENCES profiles(id),
  UNIQUE (profile_id, hospital_id)
);

CREATE INDEX IF NOT EXISTS idx_uha_profile   ON user_hospital_access(profile_id);
CREATE INDEX IF NOT EXISTS idx_uha_hospital  ON user_hospital_access(hospital_id);

-- -----------------------------------------------------------------------------
-- 5. `doctor_hospital_affiliations` — where each doctor operates
-- -----------------------------------------------------------------------------
-- Used by Picker B (Sprint 1 Day 4) to default the target_hospital dropdown
-- based on the admitting doctor selection.
CREATE TABLE IF NOT EXISTS doctor_hospital_affiliations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  hospital_id  UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, hospital_id)
);

CREATE INDEX IF NOT EXISTS idx_dha_profile  ON doctor_hospital_affiliations(profile_id);
CREATE INDEX IF NOT EXISTS idx_dha_hospital ON doctor_hospital_affiliations(hospital_id);

-- Partial unique index: at most ONE primary hospital per doctor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dha_one_primary_per_doctor
  ON doctor_hospital_affiliations(profile_id)
  WHERE is_primary = TRUE;

-- -----------------------------------------------------------------------------
-- 6. `user_accessible_hospital_ids(UUID)` SQL function
-- -----------------------------------------------------------------------------
-- Authoritative tenancy gate. Every Sprint 1+ endpoint that reads or writes
-- a hospital-scoped row MUST consult this function for the caller's access set.
--
-- Return semantics:
--   central:          array_agg(id) of all ACTIVE hospitals
--   hospital_bound:   [primary_hospital_id]  (empty array if NULL)
--   multi_hospital:   primary ∪ all rows in user_hospital_access
--   (unknown profile) empty array
--
-- STABLE: function is deterministic within a transaction, pure read.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_accessible_hospital_ids(p_profile_id UUID)
RETURNS UUID[] AS $$
DECLARE
  v_role_scope TEXT;
  v_primary    UUID;
  v_result     UUID[];
BEGIN
  SELECT role_scope, primary_hospital_id
    INTO v_role_scope, v_primary
    FROM profiles
   WHERE id = p_profile_id;

  IF v_role_scope IS NULL THEN
    RETURN ARRAY[]::UUID[];
  END IF;

  IF v_role_scope = 'central' THEN
    SELECT array_agg(id) INTO v_result
      FROM hospitals
     WHERE is_active = TRUE;
    RETURN COALESCE(v_result, ARRAY[]::UUID[]);
  END IF;

  IF v_role_scope = 'hospital_bound' THEN
    IF v_primary IS NULL THEN
      RETURN ARRAY[]::UUID[];
    END IF;
    RETURN ARRAY[v_primary];
  END IF;

  IF v_role_scope = 'multi_hospital' THEN
    SELECT array_agg(DISTINCT h) INTO v_result
      FROM (
        SELECT v_primary AS h WHERE v_primary IS NOT NULL
        UNION
        SELECT hospital_id FROM user_hospital_access WHERE profile_id = p_profile_id
      ) grants;
    RETURN COALESCE(v_result, ARRAY[]::UUID[]);
  END IF;

  -- Unknown scope — fail closed.
  RETURN ARRAY[]::UUID[];
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- 7. Record migration in `_migrations`
-- -----------------------------------------------------------------------------
-- Using WHERE NOT EXISTS (not ON CONFLICT) because we don't know for sure
-- whether _migrations.name has a unique index in this schema.
INSERT INTO _migrations (name)
SELECT 'sprint1-multi-hospital-foundation'
WHERE NOT EXISTS (
  SELECT 1 FROM _migrations WHERE name = 'sprint1-multi-hospital-foundation'
);
