// =============================================================================
// API telemetry — withApiTelemetry HoF (AP.2)
//
// Wraps a Next.js App Router route handler to capture per-request observability:
// route_pattern, method, status, latency_ms, user_id (if authed), hospital_id
// (if available), error_message (if the handler threw).
//
// USAGE
//   import { withApiTelemetry } from '@/lib/api-telemetry';
//   export const GET = withApiTelemetry('/api/cases', async (req) => { ... });
//   export const POST = withApiTelemetry('/api/cases', async (req) => { ... });
//
// `routeName` MUST be the canonical pattern (e.g. '/api/cases/[id]'), NOT the
// literal URL — so all dynamic segments aggregate together. We don't try to
// auto-derive this from the request because Next App Router's RSC layer doesn't
// expose the matched pattern reliably from the handler context.
//
// SAFETY
//   - Logging is fire-and-forget. A logger failure NEVER breaks the response.
//   - Errors thrown by the inner handler are RE-THROWN after logging, preserving
//     Next.js's standard 500-response behavior.
//   - getCurrentUser() failures are caught silently — request is still logged
//     with user_id=null.
//
// PERFORMANCE
//   - Single INSERT per request, ~3-5ms typical on Neon http driver.
//   - Runs AFTER the response is constructed, so doesn't add to p95.
//   - At <1000 req/day current scale, INSERT cost is unmeasurable.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

type RouteHandler<TParams = unknown> = (
  request: NextRequest,
  context: { params: TParams },
) => Promise<NextResponse> | NextResponse;

interface LogParams {
  routeName: string;
  method: string;
  status: number;
  latencyMs: number;
  userId: string | null;
  hospitalId: string | null;
  errorMessage: string | null;
}

/**
 * Fire-and-forget log to api_request_log. Catches its own errors so it can
 * never break the request flow.
 */
async function logRequest(p: LogParams): Promise<void> {
  try {
    await sql`
      INSERT INTO api_request_log
        (route_pattern, method, status, latency_ms, user_id, hospital_id, error_message)
      VALUES
        (${p.routeName}, ${p.method}, ${p.status}, ${p.latencyMs},
         ${p.userId}, ${p.hospitalId}, ${p.errorMessage})
    `;
  } catch (err) {
    // Logger failure must never propagate. Surface to console so we know
    // there's a logging gap, but don't throw.
    console.error('[api-telemetry] log failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Resolve the caller's profile id + (if available) hospital id. Tolerant of
 * unauth'd routes (returns nulls for both). Never throws.
 */
async function resolveCaller(): Promise<{ userId: string | null; hospitalId: string | null }> {
  try {
    const user = await getCurrentUser();
    if (!user) return { userId: null, hospitalId: null };
    // hospitalId is not on the JWT payload — leave null and JOIN profiles
    // when the dashboard wants to slice by hospital.
    return {
      userId: (user as Record<string, unknown>).profileId as string ?? null,
      hospitalId: null,
    };
  } catch {
    return { userId: null, hospitalId: null };
  }
}

/**
 * Wrap a route handler with telemetry. The wrapper is fully transparent:
 * preserves return type, re-throws inner errors, accepts the standard
 * App Router context shape `{ params: ... }`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withApiTelemetry<TParams = any>(
  routeName: string,
  handler: RouteHandler<TParams>,
): RouteHandler<TParams> {
  return async (request, context) => {
    const start = Date.now();
    const method = request.method;
    let response: NextResponse;
    let errorMessage: string | null = null;
    let status = 500;

    try {
      response = await handler(request, context);
      status = response.status;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      // Truncate to fit a reasonable column size — DB column is TEXT so this
      // is policy not capacity, keeps logs grep-able + bounded.
      if (errorMessage && errorMessage.length > 500) {
        errorMessage = errorMessage.slice(0, 497) + '...';
      }
      // Best-effort log before re-throwing so caller observability isn't lost.
      const latencyMs = Date.now() - start;
      const { userId, hospitalId } = await resolveCaller();
      logRequest({
        routeName, method, status: 500, latencyMs,
        userId, hospitalId, errorMessage,
      });
      throw err;
    }

    // Happy path: log AFTER response is constructed (off the critical path).
    const latencyMs = Date.now() - start;
    const { userId, hospitalId } = await resolveCaller();
    // Note: we await here so the log lands before serverless function exit.
    // If we returned response immediately + spawned the log, Vercel may kill
    // the function before the INSERT completes. Cost: ~3-5ms per request.
    await logRequest({
      routeName, method, status, latencyMs,
      userId, hospitalId, errorMessage: null,
    });

    return response;
  };
}
