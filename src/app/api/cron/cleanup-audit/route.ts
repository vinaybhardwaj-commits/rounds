// ============================================
// GET /api/cron/cleanup-audit
//
// Weekly retention sweeper. Calls cleanup_audit_log() (>7y rows) AND
// cleanup_api_request_log() (>30d rows) in a single cron tick so they run on
// the same maintenance window.
//
// Schedule: Sundays 02:00 UTC (= 07:30 IST Sunday morning) — outside any
// realistic workday window. See vercel.json crons.
//
// Auth: Bearer CRON_SECRET (matches sla-sweeper, ot-list-snapshot patterns).
//
// Response:
//   { success: true, audit_deleted: N, api_log_deleted: M, ts: ... }
//
// Sprint GLASS.1 (27 April 2026). Per Glass Mode PRD §5.5.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

// Vercel default function timeout is fine for this — both cleanup funcs run
// single DELETE statements that complete in well under 10s at our row counts.
export const maxDuration = 60;

interface CleanupRow {
  audit_deleted: string | number | bigint;
  api_log_deleted: string | number | bigint;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Single round-trip: SELECT both cleanup functions in one query.
    // Returns BIGINT, which Neon HTTP driver delivers as either string or
    // number depending on size; coerce to Number for the JSON response.
    const row = await queryOne<CleanupRow>(
      `SELECT cleanup_audit_log() AS audit_deleted, cleanup_api_request_log() AS api_log_deleted`
    );

    const auditDeleted = row ? Number(row.audit_deleted) : 0;
    const apiLogDeleted = row ? Number(row.api_log_deleted) : 0;

    return NextResponse.json({
      success: true,
      audit_deleted: auditDeleted,
      api_log_deleted: apiLogDeleted,
      ts: new Date().toISOString(),
    });
  } catch (error) {
    console.error('GET /api/cron/cleanup-audit error:', error);
    return NextResponse.json(
      { success: false, error: 'Cleanup failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
