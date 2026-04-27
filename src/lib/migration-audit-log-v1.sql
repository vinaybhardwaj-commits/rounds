-- ============================================
-- Migration: audit_log table (GLASS.1)
--
-- Single canonical write target for every state-mutating endpoint in Rounds.
-- Powers Glass mode (capability flattening) — the audit log IS the safety net
-- once clinical role gates come down.
--
-- Per PRD §5.1 (Daily Dash EHRC/GLASS-MODE-PRD.md, locked v1.0 26 Apr 2026).
--
-- Volume: ~5k rows/day at current scale → ~13M rows over 7y retention. Well
-- within Postgres + Neon limits. Storage cost negligible.
--
-- Retention: 7 years (Indian medical records norm). cleanup_audit_log()
-- function below; called weekly by /api/cron/cleanup-audit alongside
-- cleanup_api_request_log().
--
-- Multi-hospital safe: hospital_id NULLABLE — system actions and cron events
-- don't always have a hospital context.
--
-- Tamper-evidence: rows are insert-only by application convention. No UPDATE
-- handler in audit.ts; only DELETE path is the 7y cleanup function.
-- Idempotent: guarded by _migrations row.
-- ============================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'audit-log-v1') THEN

    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
      actor_role TEXT,                               -- snapshot at moment of action
      hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
      action TEXT NOT NULL,                          -- dotted: 'patient.discharge', 'case.book_ot', etc.
      target_type TEXT NOT NULL,                     -- 'patient_thread', 'surgical_case', 'form_submission', etc.
      target_id UUID,                                -- the row affected (nullable for create-style actions where id is unknown until after insert)
      summary TEXT NOT NULL,                         -- one-line human-readable, e.g. "Discharged Mrs Vasantha (UHID-250996)"
      payload_before JSONB,                          -- relevant subset of fields BEFORE mutation
      payload_after JSONB,                           -- AFTER mutation
      source TEXT NOT NULL DEFAULT 'api',            -- 'api' | 'cron' | 'admin_console' | 'system'
      request_id TEXT,                               -- correlation with api_request_log row (optional)
      ip TEXT,                                       -- request IP for audit defensibility
      user_agent TEXT                                -- abbreviated UA (truncated 200ch by writer)
    );

    -- 5 indexes per PRD §5.1 — covers the dominant query shapes:
    --   1. recent activity feed (ts desc)
    --   2. "what did Sangeeta do?"             (actor_id + ts)
    --   3. "show me all events for this patient"   (target_type+target_id+ts) → per-patient Activity tab
    --   4. hospital scoping / cross-hospital aggregate (hospital_id + ts)
    --   5. "all discharges last 7 days"        (action + ts)
    CREATE INDEX IF NOT EXISTS idx_audit_ts          ON audit_log (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_actor_ts    ON audit_log (actor_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_target      ON audit_log (target_type, target_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_hospital_ts ON audit_log (hospital_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_action_ts   ON audit_log (action, ts DESC);

    INSERT INTO _migrations (name) VALUES ('audit-log-v1');
    RAISE NOTICE 'audit-log-v1: audit_log table + 5 indexes created';
  ELSE
    RAISE NOTICE 'audit-log-v1: already applied, skipping';
  END IF;
END
$mig$;

-- ── Cleanup function — keep last 7 years only (Indian medical records norm). ──
-- Idempotent (CREATE OR REPLACE). Returns number of rows deleted so the
-- /api/cron/cleanup-audit response can surface a simple counter for ops.
CREATE OR REPLACE FUNCTION cleanup_audit_log() RETURNS BIGINT
LANGUAGE plpgsql
AS $func$
DECLARE
  deleted BIGINT;
BEGIN
  WITH del AS (
    DELETE FROM audit_log WHERE ts < now() - interval '7 years' RETURNING 1
  )
  SELECT count(*) INTO deleted FROM del;
  RETURN deleted;
END;
$func$;
