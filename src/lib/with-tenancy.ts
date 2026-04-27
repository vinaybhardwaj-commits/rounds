// =============================================================================
// withTenancy(routeName, handler) — multi-hospital tenancy HoF (MH.2)
//
// Wraps a Next.js App Router route handler to enforce auth + resolve the
// caller's hospital tenancy ONCE per request. Hands the handler a typed
// `ctx` with the caller's user payload + the array of hospital IDs they can
// access (from the user_accessible_hospital_ids() SQL function).
//
// PER PRD §6 — the cornerstone abstraction that prevents future cross-hospital
// data leakage. Per Q12, this is the convention going forward: any new route
// that touches per-hospital data MUST be wrapped. The wrapper makes the right
// path the easy path.
//
// USAGE
//   import { withTenancy } from '@/lib/with-tenancy';
//
//   export const GET = withTenancy('/api/cases', async (req, ctx) => {
//     const cases = await query(
//       `SELECT ... FROM surgical_cases WHERE hospital_id = ANY($1::uuid[])`,
//       [ctx.accessibleHospitalIds]
//     );
//     return NextResponse.json({ success: true, data: cases });
//   });
//
// CONTEXT SHAPE
//   ctx.user                  — JWTPayload from getCurrentUser (never null
//                                inside the handler — wrapper returns 401 if
//                                no user).
//   ctx.accessibleHospitalIds — string[] of hospital UUIDs the user can read.
//                                For super_admin spans all is_active hospitals.
//                                For hospital_bound this is exactly one ID.
//                                For multi_hospital this is the affiliated set.
//   ctx.primaryHospitalId     — string of the user's primary_hospital_id
//                                (anchor for default pickers per Q3).
//
// WHEN NOT TO USE
//   - Auth routes (/api/auth/*)
//   - Cron routes (/api/cron/*)
//   - Help system (/api/help/*)
//   - super_admin-only admin routes that legitimately span hospitals (those
//     should still call getCurrentUser + check role explicitly).
//
// SAFETY
//   - 401 if no auth (wrapper short-circuits before handler runs)
//   - Tenancy resolution failure (DB error) returns 500
//   - Handler's NextResponse passes through unchanged
//   - Pattern matches withApiTelemetry (AP.2) and audit() (Glass) — same
//     style + ergonomics the codebase already knows.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import type { JWTPayload } from '@/lib/auth';

export interface TenancyContext<TParams = unknown> {
  user: JWTPayload;
  /** UUIDs of hospitals the caller can access — pass as `$1::uuid[]` to ANY() in SQL. */
  accessibleHospitalIds: string[];
  /** The caller's primary_hospital_id — anchor for default-hospital pickers. */
  primaryHospitalId: string;
  /** Route params from Next.js dynamic segments. */
  params: TParams;
}

export type TenancyHandler<TParams = unknown> = (
  request: NextRequest,
  ctx: TenancyContext<TParams>,
) => Promise<NextResponse> | NextResponse;

/**
 * Resolve the caller's accessible hospital IDs via SQL. Returns null if the
 * underlying query throws (caller treats as 500). Single round-trip.
 */
interface TenancyResolution {
  accessibleHospitalIds: string[];
  primaryHospitalId: string;
}

/**
 * Resolve the caller's accessible hospital IDs + primary_hospital_id in a single
 * round-trip. Returns null if the underlying query throws (caller treats as 500).
 *
 * primary_hospital_id is read from profiles directly (NOT NULL post-MH.1 so always
 * present). accessibleHospitalIds comes from the user_accessible_hospital_ids() SQL
 * function which respects role + multi-hospital affiliations.
 */
async function resolveTenancy(profileId: string): Promise<TenancyResolution | null> {
  try {
    const rows = await query<{ accessible: string[]; primary: string }>(
      `SELECT
         user_accessible_hospital_ids($1::uuid)::uuid[]::text[] AS accessible,
         (SELECT primary_hospital_id::text FROM profiles WHERE id = $1::uuid) AS primary`,
      [profileId]
    );
    if (!rows.length || !rows[0].primary) return null;
    return {
      accessibleHospitalIds: rows[0].accessible || [],
      primaryHospitalId: rows[0].primary,
    };
  } catch (err) {
    console.error('[withTenancy] tenancy resolution failed for profile', profileId, ':', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Wrap a route handler with auth + tenancy resolution.
 *
 * The `routeName` parameter mirrors withApiTelemetry's pattern — pass the
 * canonical route pattern (e.g. '/api/ot/postings', '/api/cases/[id]') so logs
 * + future telemetry can attribute correctly.
 */
export function withTenancy<TParams = unknown>(
  routeName: string,
  handler: TenancyHandler<TParams>,
) {
  return async (
    request: NextRequest,
    context: { params: TParams },
  ): Promise<NextResponse> => {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.profileId) {
      console.error(`[withTenancy] ${routeName}: JWT missing profileId for user`, user.email);
      return NextResponse.json({ success: false, error: 'Invalid session — please re-login' }, { status: 401 });
    }

    const tenancy = await resolveTenancy(user.profileId);
    if (tenancy === null) {
      return NextResponse.json({ success: false, error: 'Tenancy resolution failed' }, { status: 500 });
    }

    return handler(request, {
      user,
      accessibleHospitalIds: tenancy.accessibleHospitalIds,
      primaryHospitalId: tenancy.primaryHospitalId,
      params: context.params,
    });
  };
}
