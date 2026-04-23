-- =============================================================================
-- Sprint 1 Day 2 — Equipment kits + requests
-- =============================================================================
-- Supports Decision D10 (Arul Interface C — status-updater, NOT procurement):
-- requests follow a linear 5-step chain and auto-verify kit-based standard items.
--
-- Tables:
--   • equipment_kits       — pre-defined bundles per hospital (e.g. "TKR kit")
--   • equipment_requests   — per-case needs (auto-attached from kits or manual)
--
-- Types per PRD §3.5: specialty / rental / implant / blood / imaging
-- Chain per Decision D10: requested → vendor_confirmed → in_transit
--                       → delivered → verified_ready (NO skipping)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. equipment_kits — hospital-scoped catalog
-- -----------------------------------------------------------------------------
-- PRD §3.3 notes kits CAN have hospital_id for per-hospital overrides. We
-- require it here for clarity; a future "universal kit" pattern can use a
-- sentinel hospital or a separate catalog table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_kits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   UUID NOT NULL REFERENCES hospitals(id),
  code          TEXT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_id, code)
);

CREATE INDEX IF NOT EXISTS idx_ek_hospital_active
  ON equipment_kits(hospital_id, is_active)
  WHERE is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 2. equipment_requests — per-case needs
-- -----------------------------------------------------------------------------
-- kit_id is nullable: manual/ad-hoc requests aren't from a kit.
-- auto_verified=TRUE means the item was auto-attached from a standard kit and
-- the UI renders it as "already verified" without requiring Arul's touch.
-- Non-standard items flow through the 5-step chain.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES surgical_cases(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL CHECK (item_type IN (
    'specialty', 'rental', 'implant', 'blood', 'imaging'
  )),
  item_label      TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  -- Linear 5-step chain — see Decision D10. Enforce order in code.
  status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready'
  )),
  vendor_name     TEXT,
  vendor_phone    TEXT,
  eta             TIMESTAMPTZ,
  notes           TEXT,
  kit_id          UUID REFERENCES equipment_kits(id),
  -- TRUE iff auto-attached from a standard kit (skips Arul's kanban).
  auto_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_case ON equipment_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_er_status ON equipment_requests(status);
CREATE INDEX IF NOT EXISTS idx_er_kit ON equipment_requests(kit_id) WHERE kit_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO _migrations (name)
SELECT 'sprint1-equipment-tables'
WHERE NOT EXISTS (
  SELECT 1 FROM _migrations WHERE name = 'sprint1-equipment-tables'
);
