-- =============================================================================
-- migration-form-submissions-metadata.sql
-- 25 Apr 2026
--
-- Adds form_submissions.metadata (JSONB, default '{}') so the sla-sweeper
-- cron can stash dedup markers like {"sla_breach_posted_at": "..."} on
-- breached submissions to avoid re-posting on every 5-min tick.
--
-- Idempotent. ADD COLUMN IF NOT EXISTS + ON CONFLICT marker.
-- =============================================================================

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_fs_metadata_sla_breach
  ON form_submissions ((metadata->>'sla_breach_posted_at'))
  WHERE metadata ? 'sla_breach_posted_at';

INSERT INTO _migrations (name, applied_at)
VALUES ('25-apr-form-submissions-metadata', NOW())
ON CONFLICT (name) DO NOTHING;

DO $chk$
DECLARE
  v_has_meta BOOL;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'metadata'
  ) INTO v_has_meta;
  IF NOT v_has_meta THEN
    RAISE EXCEPTION 'form_submissions.metadata not installed';
  END IF;
  RAISE NOTICE 'form_submissions.metadata installed';
END
$chk$;
