/**
 * GET /api/admin/dedup/activity
 *
 * R.3 + R.4 Phase 5.2 — Activity Log endpoint for the Dedup Hub.
 *
 * Reads from dedup_log (the audit table populated by every dedup decision the
 * system has ever made — imports from Phase 2/3/4, admin merges/dismisses from
 * Phase 5.1) and returns a paginated, filterable feed enriched with patient
 * names on both sides of each pair so the UI can render human-readable rows
 * without needing a second round-trip.
 *
 * Default window: last 7 days.
 * Supports:
 *   ?from=ISO&to=ISO                — time window (exclusive upper bound)
 *   ?actions=merge,split,link       — comma-separated action filter
 *   ?endpoint=substring             — substring match on endpoint tag
 *   ?actor=substring                — substring match on actor_name
 *   ?patient=substring              — substring match on either side's name
 *   ?limit=N                        — default 100, max 500
 *   ?offset=N                       — default 0
 *
 * Requires super_admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ActivityRowRaw {
  id: string;
  action: string;
  source_thread_id: string | null;
  target_thread_id: string | null;
  match_layer: number | null;
  similarity: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  endpoint: string | null;
  created_at: string;

  // enriched patient names
  source_patient_name: string | null;
  source_uhid: string | null;
  source_phone: string | null;
  source_current_stage: string | null;
  source_archived_at: string | null;
  source_merged_into_id: string | null;

  target_patient_name: string | null;
  target_uhid: string | null;
  target_phone: string | null;
  target_current_stage: string | null;
  target_archived_at: string | null;
  target_merged_into_id: string | null;
}

export const VALID_ACTIONS = new Set([
  'merge',
  'split',
  'ignore',
  'link',
  'flag',
  'create',
]);

export function parseActivityParams(searchParams: URLSearchParams): {
  ok: true;
  params: {
    fromIso: string;
    toIso: string | null;
    actions: string[] | null;
    endpoint: string | null;
    actor: string | null;
    patient: string | null;
    limit: number;
    offset: number;
  };
} | { ok: false; error: string } {
  // Default window: last 7 days
  const toParam = searchParams.get('to');
  const fromParam = searchParams.get('from');

  const toIso = toParam || null;
  if (toIso) {
    const d = new Date(toIso);
    if (isNaN(d.getTime())) return { ok: false, error: 'Invalid "to" timestamp' };
  }

  let fromIso: string;
  if (fromParam) {
    const d = new Date(fromParam);
    if (isNaN(d.getTime())) return { ok: false, error: 'Invalid "from" timestamp' };
    fromIso = d.toISOString();
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    fromIso = d.toISOString();
  }

  const actionsRaw = searchParams.get('actions');
  let actions: string[] | null = null;
  if (actionsRaw) {
    actions = actionsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const a of actions) {
      if (!VALID_ACTIONS.has(a)) {
        return {
          ok: false,
          error: `Invalid action "${a}". Must be one of: ${Array.from(VALID_ACTIONS).join(', ')}`,
        };
      }
    }
    if (actions.length === 0) actions = null;
  }

  const endpoint = searchParams.get('endpoint');
  const actor = searchParams.get('actor');
  const patient = searchParams.get('patient');

  const limitRaw = searchParams.get('limit');
  let limit = 100;
  if (limitRaw) {
    const n = parseInt(limitRaw, 10);
    if (isNaN(n) || n < 1) return { ok: false, error: 'Invalid limit' };
    limit = Math.min(n, 500);
  }

  const offsetRaw = searchParams.get('offset');
  let offset = 0;
  if (offsetRaw) {
    const n = parseInt(offsetRaw, 10);
    if (isNaN(n) || n < 0) return { ok: false, error: 'Invalid offset' };
    offset = n;
  }

  return {
    ok: true,
    params: { fromIso, toIso, actions, endpoint, actor, patient, limit, offset },
  };
}

/**
 * Build the WHERE clause + params array for the activity query.
 * Returns { where, params } where `where` is the full WHERE string starting
 * with WHERE and `params` is the param array aligned to the numbered
 * placeholders. Exported for use by the export route.
 */
export function buildActivityWhere(params: {
  fromIso: string;
  toIso: string | null;
  actions: string[] | null;
  endpoint: string | null;
  actor: string | null;
  patient: string | null;
}): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  let i = 1;

  conds.push(`dl.created_at >= $${i++}`);
  args.push(params.fromIso);

  if (params.toIso) {
    conds.push(`dl.created_at < $${i++}`);
    args.push(params.toIso);
  }

  if (params.actions && params.actions.length > 0) {
    const ph = params.actions.map(() => `$${i++}`).join(', ');
    conds.push(`dl.action IN (${ph})`);
    args.push(...params.actions);
  }

  if (params.endpoint) {
    conds.push(`dl.endpoint ILIKE $${i++}`);
    args.push(`%${params.endpoint}%`);
  }

  if (params.actor) {
    conds.push(`dl.actor_name ILIKE $${i++}`);
    args.push(`%${params.actor}%`);
  }

  if (params.patient) {
    conds.push(
      `(pt_src.patient_name ILIKE $${i} OR pt_tgt.patient_name ILIKE $${i})`
    );
    args.push(`%${params.patient}%`);
    i++;
  }

  return {
    where: 'WHERE ' + conds.join(' AND '),
    params: args,
  };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = parseActivityParams(searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400 }
    );
  }

  const { fromIso, toIso, actions, endpoint, actor, patient, limit, offset } =
    parsed.params;

  try {
    const { where, params: whereArgs } = buildActivityWhere({
      fromIso,
      toIso,
      actions,
      endpoint,
      actor,
      patient,
    });

    const limitPlaceholder = `$${whereArgs.length + 1}`;
    const offsetPlaceholder = `$${whereArgs.length + 2}`;

    const rows = await query<ActivityRowRaw>(
      `
      SELECT
        dl.id,
        dl.action,
        dl.source_thread_id,
        dl.target_thread_id,
        dl.match_layer,
        dl.similarity::text AS similarity,
        dl.reason,
        dl.metadata,
        dl.actor_id,
        dl.actor_name,
        dl.endpoint,
        dl.created_at,

        pt_src.patient_name    AS source_patient_name,
        pt_src.uhid            AS source_uhid,
        pt_src.phone           AS source_phone,
        pt_src.current_stage   AS source_current_stage,
        pt_src.archived_at     AS source_archived_at,
        pt_src.merged_into_id  AS source_merged_into_id,

        pt_tgt.patient_name    AS target_patient_name,
        pt_tgt.uhid            AS target_uhid,
        pt_tgt.phone           AS target_phone,
        pt_tgt.current_stage   AS target_current_stage,
        pt_tgt.archived_at     AS target_archived_at,
        pt_tgt.merged_into_id  AS target_merged_into_id
      FROM dedup_log dl
      LEFT JOIN patient_threads pt_src ON pt_src.id = dl.source_thread_id
      LEFT JOIN patient_threads pt_tgt ON pt_tgt.id = dl.target_thread_id
      ${where}
      ORDER BY dl.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      [...whereArgs, limit, offset]
    );

    const countRow = await queryOne<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM dedup_log dl
      LEFT JOIN patient_threads pt_src ON pt_src.id = dl.source_thread_id
      LEFT JOIN patient_threads pt_tgt ON pt_tgt.id = dl.target_thread_id
      ${where}
      `,
      whereArgs
    );

    const total = parseInt(countRow?.count || '0', 10);

    // Aggregate counts per action in the filtered window (for the filter chips
    // in the UI to show "merge (12)" etc.).
    const actionCounts = await query<{ action: string; count: string }>(
      `
      SELECT dl.action, COUNT(*)::text AS count
      FROM dedup_log dl
      LEFT JOIN patient_threads pt_src ON pt_src.id = dl.source_thread_id
      LEFT JOIN patient_threads pt_tgt ON pt_tgt.id = dl.target_thread_id
      ${where}
      GROUP BY dl.action
      ORDER BY COUNT(*) DESC
      `,
      whereArgs
    );

    const entries = rows.map((r) => ({
      id: r.id,
      action: r.action,
      source_thread_id: r.source_thread_id,
      target_thread_id: r.target_thread_id,
      match_layer: r.match_layer,
      similarity: r.similarity ? parseFloat(r.similarity) : null,
      reason: r.reason,
      metadata: r.metadata,
      actor_id: r.actor_id,
      actor_name: r.actor_name,
      endpoint: r.endpoint,
      created_at: r.created_at,
      source: r.source_thread_id
        ? {
            id: r.source_thread_id,
            patient_name: r.source_patient_name,
            uhid: r.source_uhid,
            phone: r.source_phone,
            current_stage: r.source_current_stage,
            archived_at: r.source_archived_at,
            merged_into_id: r.source_merged_into_id,
          }
        : null,
      target: r.target_thread_id
        ? {
            id: r.target_thread_id,
            patient_name: r.target_patient_name,
            uhid: r.target_uhid,
            phone: r.target_phone,
            current_stage: r.target_current_stage,
            archived_at: r.target_archived_at,
            merged_into_id: r.target_merged_into_id,
          }
        : null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        entries,
        total,
        limit,
        offset,
        has_more: offset + entries.length < total,
        window: { from: fromIso, to: toIso },
        action_counts: actionCounts.reduce<Record<string, number>>((acc, r) => {
          acc[r.action] = parseInt(r.count, 10);
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    console.error('GET /api/admin/dedup/activity error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load dedup activity log' },
      { status: 500 }
    );
  }
}
