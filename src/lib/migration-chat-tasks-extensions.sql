-- ============================================================================
-- migration-chat-tasks-extensions.sql  (CT.1 — Chat Tasks PRD v1.4 §5.1)
--
-- Extends the existing `tasks` table to support chat-originated tasks. Adds
-- patient context (independent of surgical_cases), priority, source-channel
-- linkage, and the posted-message-id used for live-status sync. Widens the
-- `source` CHECK to allow `'chat'` so the new POST /api/chat-tasks endpoint
-- can stamp its rows.
--
-- Idempotency: tracked via _migrations row.
-- Existing tasks rows: get priority='normal' default; all other new columns
--                      stay NULL.
-- Companion: src/app/api/chat-tasks/route.ts (CT.3),
--            src/lib/chat-tasks-rate-limit.ts (CT.3).
-- ============================================================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'chat-tasks-extensions') THEN

    -- 1. New nullable columns (all default NULL).
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS patient_thread_id UUID
      REFERENCES patient_threads(id) ON DELETE SET NULL;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_channel_id   TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_channel_type TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_message_id   TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS posted_message_id   TEXT;

    -- 2. Priority (NOT NULL with default; existing rows backfill to 'normal').
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

    -- 3. Index for patient-scoped queries (Tasks tab filter, /api/tasks).
    CREATE INDEX IF NOT EXISTS idx_tasks_patient_thread
      ON tasks(patient_thread_id) WHERE patient_thread_id IS NOT NULL;

    -- 4. Widen the `source` CHECK to include 'chat'. Drop-and-recreate is the
    --    Postgres-friendly way to evolve a CHECK constraint.
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
    ALTER TABLE tasks ADD CONSTRAINT tasks_source_check
      CHECK (source IN ('manual', 'auto', 'chat'));

    INSERT INTO _migrations (name, applied_at)
    VALUES ('chat-tasks-extensions', NOW());

    RAISE NOTICE 'chat-tasks-extensions applied';
  ELSE
    RAISE NOTICE 'chat-tasks-extensions already applied, skipping';
  END IF;
END
$mig$;

-- Verification (run separately after the migration; not part of the DO block):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'tasks'
--      AND column_name IN ('patient_thread_id','priority','source_channel_id',
--                          'source_channel_type','source_message_id','posted_message_id')
--    ORDER BY column_name;
--   -- Expect 6 rows. priority is_nullable='NO' default 'normal'::text; others 'YES'.
--
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'tasks_source_check';
--   -- Expect: CHECK (source = ANY (ARRAY['manual','auto','chat']))
--
--   SELECT COUNT(*) FROM tasks;
--   -- Expect: same as before migration.
