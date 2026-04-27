// =============================================================================
// GET /api/admin/audit-log — query the audit_log table (super_admin only)
//
// GLASS.10 per PRD §5.4.A — backs the admin audit-log viewer.
//
// Query params (all optional):
//   actor_id        — UUID
//   target_type     — string (patient_thread / surgical_case / etc.)
//   target_id       — UUID
//   action          — dotted-namespace string (exact match)
//   action_prefix   — e.g. 'patient' matches all patient.* actions
//   hospital_id     — UUID
//   from_ts         — ISO timestamp (default = now - 7 days)
//   to_ts           — ISO timestamp (default = now)
//   q               — free-text substring match against `summary`
//   limit           — default 50, max 200
//   offset          — default 0
//
// Response:
//   { success, data: AuditRow[], total, limit, offset }
//
// All filters AND together. Default sort: ts DESC.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { withApiTelemetry } from '@/lib/api-telemetry';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface AuditRow {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;       // joined from profiles
  hospital_id: string | null;
  hospital_name: string | null;    // joined from hospitals
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  payload_before: Record<string, unknown> | null;
  payload_after: Record<string, unknown> | null;
  source: string;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
}

async function GET_inner(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(user.role, ['super_admin'])) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const actorId = sp.get('actor_id');
  const targetType = sp.get('target_type');
  const targetId = sp.get('target_id');
  const action = sp.get('action');
  const actionPrefix = sp.get('action_prefix');
  const hospitalId = sp.get('hospital_id');
  const fromTs = sp.get('from_ts') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const toTs = sp.get('to_ts') || new Date().toISOString();
  const q = sp.get('q');

  const limitRaw = parseInt(sp.get('limit') || '50', 10);
  const limit = Math.max(1, Math.min(200, isNaN(limitRaw) ? 50 : limitRaw));
  const offsetRaw = parseInt(sp.get('offset') || '0', 10);
  const offset = Math.max(0, isNaN(offsetRaw) ? 0 : offsetRaw);

  // Build dynamic WHERE clause + params (parameterized — no SQL injection).
  const conds: string[] = ['a.ts >= $1::timestamptz', 'a.ts <= $2::timestamptz'];
  const params: unknown[] = [fromTs, toTs];
  let p = 3;
  if (actorId) { conds.push(`a.actor_id = $${p++}::uuid`); params.push(actorId); }
  if (targetType) { conds.push(`a.target_type = $${p++}`); params.push(targetType); }
  if (targetId) { conds.push(`a.target_id = $${p++}::uuid`); params.push(targetId); }
  if (action) { conds.push(`a.action = $${p++}`); params.push(action); }
  if (actionPrefix) { conds.push(`a.action LIKE $${p++}`); params.push(`${actionPrefix}.%`); }
  if (hospitalId) { conds.push(`a.hospital_id = $${p++}::uuid`); params.push(hospitalId); }
  if (q) { conds.push(`a.summary ILIKE $${p++}`); params.push(`%${q}%`); }
  const whereClause = conds.join(' AND ');

  // Total count (separate query — common pagination pattern).
  const countRow = await queryOne<{ total: string | number }>(
    `SELECT count(*)::text AS total FROM audit_log a WHERE ${whereClause}`,
    params
  );
  const total = countRow ? Number(countRow.total) : 0;

  // Page of rows joined with profiles + hospitals for human-readable display.
  const rowParams = [...params, limit, offset];
  const rows = await query<AuditRow>(
    `
    SELECT
      a.id::text,
      a.ts::text,
      a.actor_id::text,
      a.actor_role,
      p.full_name AS actor_name,
      a.hospital_id::text,
      h.name AS hospital_name,
      a.action,
      a.target_type,
      a.target_id::text,
      a.summary,
      a.payload_before,
      a.payload_after,
      a.source,
      a.request_id,
      a.ip,
      a.user_agent
    FROM audit_log a
    LEFT JOIN profiles p ON p.id = a.actor_id
    LEFT JOIN hospitals h ON h.id = a.hospital_id
    WHERE ${whereClause}
    ORDER BY a.ts DESC
    LIMIT $${p++} OFFSET $${p++}
    `,
    rowParams
  );

  return NextResponse.json({
    success: true,
    data: rows,
    total,
    limit,
    offset,
    window: { from_ts: fromTs, to_ts: toTs },
  });
}

export const GET = withApiTelemetry('/api/admin/audit-log', GET_inner);
