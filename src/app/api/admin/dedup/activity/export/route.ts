/**
 * GET /api/admin/dedup/activity/export
 *
 * R.3 + R.4 Phase 5.2 — CSV export for the Dedup Hub Activity Log.
 *
 * Honors exactly the same query parameters as /api/admin/dedup/activity (date
 * window, action filter, endpoint/actor/patient substring) and returns a CSV
 * download of whatever matches — no pagination, but capped at a safety ceiling
 * of 5,000 rows per export to avoid runaway queries. If the filtered set
 * exceeds 5,000 rows, the export returns a 413 with guidance to narrow the
 * filters.
 *
 * Requires super_admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { parseActivityParams, buildActivityWhere } from '../route';

export const dynamic = 'force-dynamic';

const EXPORT_HARD_CAP = 5000;

interface ExportRow {
  created_at: string;
  action: string;
  endpoint: string | null;
  actor_name: string | null;
  reason: string | null;
  match_layer: number | null;
  similarity: string | null;
  source_thread_id: string | null;
  source_patient_name: string | null;
  source_uhid: string | null;
  source_phone: string | null;
  source_current_stage: string | null;
  target_thread_id: string | null;
  target_patient_name: string | null;
  target_uhid: string | null;
  target_phone: string | null;
  target_current_stage: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * RFC 4180-compliant CSV cell escaping: wrap in double quotes, double any
 * internal double quotes. Null/undefined become empty string. Objects get
 * JSON.stringify'd first.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  // Always quote to be safe — commas, newlines, and quotes are all preserved
  return '"' + s.replace(/"/g, '""') + '"';
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

  // Strip limit/offset from params — export ignores them
  const { fromIso, toIso, actions, endpoint, actor, patient } = parsed.params;

  try {
    const { where, params: whereArgs } = buildActivityWhere({
      fromIso,
      toIso,
      actions,
      endpoint,
      actor,
      patient,
    });

    // First: count check to enforce the hard cap before streaming a huge query
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
    if (total > EXPORT_HARD_CAP) {
      return NextResponse.json(
        {
          success: false,
          error: `Export would return ${total} rows, which exceeds the safety cap of ${EXPORT_HARD_CAP}. Please narrow your filters.`,
          total,
          cap: EXPORT_HARD_CAP,
        },
        { status: 413 }
      );
    }

    const rows = await query<ExportRow>(
      `
      SELECT
        dl.created_at,
        dl.action,
        dl.endpoint,
        dl.actor_name,
        dl.reason,
        dl.match_layer,
        dl.similarity::text AS similarity,
        dl.source_thread_id,
        pt_src.patient_name  AS source_patient_name,
        pt_src.uhid          AS source_uhid,
        pt_src.phone         AS source_phone,
        pt_src.current_stage AS source_current_stage,
        dl.target_thread_id,
        pt_tgt.patient_name  AS target_patient_name,
        pt_tgt.uhid          AS target_uhid,
        pt_tgt.phone         AS target_phone,
        pt_tgt.current_stage AS target_current_stage,
        dl.metadata
      FROM dedup_log dl
      LEFT JOIN patient_threads pt_src ON pt_src.id = dl.source_thread_id
      LEFT JOIN patient_threads pt_tgt ON pt_tgt.id = dl.target_thread_id
      ${where}
      ORDER BY dl.created_at DESC
      LIMIT ${EXPORT_HARD_CAP}
      `,
      whereArgs
    );

    const headers = [
      'created_at',
      'action',
      'endpoint',
      'actor_name',
      'reason',
      'match_layer',
      'similarity',
      'source_thread_id',
      'source_patient_name',
      'source_uhid',
      'source_phone',
      'source_current_stage',
      'target_thread_id',
      'target_patient_name',
      'target_uhid',
      'target_phone',
      'target_current_stage',
      'metadata',
    ];

    const lines: string[] = [];
    lines.push(headers.join(','));

    for (const r of rows) {
      lines.push(
        [
          csvCell(r.created_at),
          csvCell(r.action),
          csvCell(r.endpoint),
          csvCell(r.actor_name),
          csvCell(r.reason),
          csvCell(r.match_layer),
          csvCell(r.similarity),
          csvCell(r.source_thread_id),
          csvCell(r.source_patient_name),
          csvCell(r.source_uhid),
          csvCell(r.source_phone),
          csvCell(r.source_current_stage),
          csvCell(r.target_thread_id),
          csvCell(r.target_patient_name),
          csvCell(r.target_uhid),
          csvCell(r.target_phone),
          csvCell(r.target_current_stage),
          csvCell(r.metadata),
        ].join(',')
      );
    }

    const csv = lines.join('\r\n') + '\r\n';

    // Filename uses the date window — so an audit pull for 2026-04-01..04-09
    // produces a sensibly-named file.
    const fromDate = fromIso.slice(0, 10);
    const toDate = toIso ? toIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const filename = `dedup-activity-${fromDate}_to_${toDate}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('GET /api/admin/dedup/activity/export error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to export dedup activity log' },
      { status: 500 }
    );
  }
}
