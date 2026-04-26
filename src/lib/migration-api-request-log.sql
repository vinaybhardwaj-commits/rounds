-- ============================================
-- Migration: api_request_log table (AP.1)
--
-- Per-request observability for /api/* endpoints. Wired in by route
-- handlers via withApiTelemetry() (src/lib/api-telemetry.ts).
--
-- Volume: low (<5k rows/day at current Rounds scale). Retention: 30 days
-- via cleanup_api_request_log() function (call from a daily cron).
--
-- Multi-hospital safe: hospital_id NULLABLE — anon requests + super_admin
-- routes don't always have a hospital context.
-- Idempotent: guarded by _migrations row.
-- ============================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'api-request-log-v1') THEN

    CREATE TABLE IF NOT EXISTS api_request_log (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      route_pattern TEXT NOT NULL,        -- e.g. '/api/cases/[id]' (canonicalized, not literal)
      method TEXT NOT NULL,                -- 'GET', 'POST', 'PATCH', 'DELETE', 'PUT'
      status SMALLINT NOT NULL,            -- HTTP status code: 200, 401, 404, 409, 500, etc
      latency_ms INT NOT NULL,             -- handler execution time
      user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
      hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
      error_message TEXT                   -- captured when the handler throws (truncated 500ch)
    );

    -- Hot query: time-bucketed aggregations + recent errors
    CREATE INDEX IF NOT EXISTS idx_api_log_ts            ON api_request_log (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_api_log_route_ts      ON api_request_log (route_pattern, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_api_log_status_ts     ON api_request_log (status, ts DESC) WHERE status >= 400;

    INSERT INTO _migrations (name) VALUES ('api-request-log-v1');
    RAISE NOTICE 'api-request-log-v1: api_request_log table + 3 indexes created';
  ELSE
    RAISE NOTICE 'api-request-log-v1: already applied, skipping';
  END IF;
END
$mig$;

-- ── Cleanup function — keep last 30 days only. Idempotent (CREATE OR REPLACE). ──
CREATE OR REPLACE FUNCTION cleanup_api_request_log() RETURNS BIGINT
LANGUAGE plpgsql
AS $func$
DECLARE
  deleted BIGINT;
BEGIN
  WITH del AS (
    DELETE FROM api_request_log WHERE ts < now() - interval '30 days' RETURNING 1
  )
  SELECT count(*) INTO deleted FROM del;
  RETURN deleted;
END;
$func$;
