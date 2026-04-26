-- ============================================================================
-- migration-hospitals-ot-count.sql  (26 Apr 2026 follow-up FU7)
--
-- Per-hospital OT count — was hardcoded to 3 in /ot-calendar. Now stored on
-- the hospitals row so EHRC (3 OTs) and any future hospital can configure
-- their own count without a code change.
--
-- Default 3 keeps EHRC behavior identical post-migration.
-- ============================================================================

BEGIN;

ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS ot_room_count INT NOT NULL DEFAULT 3;

-- No backfill needed — DEFAULT 3 fills existing rows. Future hospitals can
-- adjust via super_admin admin UI (TBD).

COMMIT;
