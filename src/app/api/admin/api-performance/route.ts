// =============================================================================
// GET /api/admin/api-performance  (AP.4)
//
// Super_admin only. Returns aggregated observability stats from
// api_request_log (populated by withApiTelemetry — AP.2).
//
// Window: configurable via ?hours=N (default 24, max 168 = 7d).
//
// Response shape:
//   {
//     success: true,
//     window_hours: number,
//     kpis: {
//       total_requests: number,
//       requests_per_min: number,           // averaged over the window
//       error_rate_pct: number,             // 4xx + 5xx / total
//       overall_p95_ms: number
//     },
//     endpoints: [{                         // top 30 by count
//       route_pattern, method,
//       count, error_count,
//       p50_ms, p95_ms, p99_ms,
//       last_seen_iso
//     }],
//     timeseries: [{                        // 5-min buckets, last 24h
//       bucket_iso, total, errors, avg_latency_ms
//     }],
//     slowest: [{                           // top 10 by p95
//       route_pattern, method, p95_ms, count
//     }],
//     error_tops: [{                        // top 10 by error count
//       route_pattern, method, error_count, count, last_status
//     }]
//   }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { withApiTelemetry } from '@/lib/api-telemetry';

export const dynamic = 'force-dynamic';

async function GET_inner(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(user.role, ['super_admin'])) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  // Window param — clamp to [1, 168] hours.
  const hoursParam = parseInt(request.nextUrl.searchParams.get('hours') || '24', 10);
  const hours = Math.max(1, Math.min(168, isNaN(hoursParam) ? 24 : hoursParam));

  // ── KPI roll-up ─────────────────────────────────────────────────────────
  const kpiRows = await sql`
    SELECT
      COUNT(*)::INT                                           AS total_requests,
      COUNT(*) FILTER (WHERE status >= 400)::INT              AS error_count,
      COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::INT
                                                              AS overall_p95_ms
    FROM api_request_log
    WHERE ts > now() - (${hours} || ' hours')::interval
  ` as Array<{ total_requests: number; error_count: number; overall_p95_ms: number }>;
  const kpi = kpiRows[0] || { total_requests: 0, error_count: 0, overall_p95_ms: 0 };
  const minutesInWindow = hours * 60;
  const kpis = {
    total_requests: kpi.total_requests,
    requests_per_min: minutesInWindow > 0
      ? Math.round((kpi.total_requests / minutesInWindow) * 100) / 100
      : 0,
    error_rate_pct: kpi.total_requests > 0
      ? Math.round((kpi.error_count / kpi.total_requests) * 10000) / 100
      : 0,
    overall_p95_ms: kpi.overall_p95_ms,
  };

  // ── Endpoint table — top 30 by count ────────────────────────────────────
  const endpoints = await sql`
    SELECT
      route_pattern,
      method,
      COUNT(*)::INT                                                 AS count,
      COUNT(*) FILTER (WHERE status >= 400)::INT                    AS error_count,
      COALESCE(PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY latency_ms), 0)::INT AS p50_ms,
      COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::INT AS p95_ms,
      COALESCE(PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY latency_ms), 0)::INT AS p99_ms,
      MAX(ts)                                                       AS last_seen
    FROM api_request_log
    WHERE ts > now() - (${hours} || ' hours')::interval
    GROUP BY route_pattern, method
    ORDER BY count DESC
    LIMIT 30
  `;

  // ── 5-min time series ───────────────────────────────────────────────────
  const timeseries = await sql`
    SELECT
      date_trunc('hour', ts)
        + INTERVAL '5 min' * (extract(minute FROM ts)::int / 5)    AS bucket,
      COUNT(*)::INT                                                 AS total,
      COUNT(*) FILTER (WHERE status >= 400)::INT                    AS errors,
      COALESCE(AVG(latency_ms), 0)::INT                             AS avg_latency_ms
    FROM api_request_log
    WHERE ts > now() - (${hours} || ' hours')::interval
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  // ── Slowest 10 by p95 (min 5 requests, exclude 0-count noise) ───────────
  const slowest = await sql`
    SELECT
      route_pattern,
      method,
      COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::INT AS p95_ms,
      COUNT(*)::INT AS count
    FROM api_request_log
    WHERE ts > now() - (${hours} || ' hours')::interval
    GROUP BY route_pattern, method
    HAVING COUNT(*) >= 5
    ORDER BY p95_ms DESC
    LIMIT 10
  `;

  // ── Top 10 error producers ──────────────────────────────────────────────
  const error_tops = await sql`
    SELECT
      route_pattern,
      method,
      COUNT(*) FILTER (WHERE status >= 400)::INT AS error_count,
      COUNT(*)::INT                              AS count,
      (SELECT status FROM api_request_log inner_log
        WHERE inner_log.route_pattern = api_request_log.route_pattern
          AND inner_log.method = api_request_log.method
          AND inner_log.status >= 400
          AND inner_log.ts > now() - (${hours} || ' hours')::interval
        ORDER BY inner_log.ts DESC LIMIT 1) AS last_status
    FROM api_request_log
    WHERE ts > now() - (${hours} || ' hours')::interval
    GROUP BY route_pattern, method
    HAVING COUNT(*) FILTER (WHERE status >= 400) > 0
    ORDER BY error_count DESC
    LIMIT 10
  `;

  return NextResponse.json({
    success: true,
    window_hours: hours,
    kpis,
    endpoints,
    timeseries,
    slowest,
    error_tops,
  });
}

// AP.3 — telemetry-wrapped exports (auto-applied)
export const GET = withApiTelemetry('/api/admin/api-performance', GET_inner);
