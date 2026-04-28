// =============================================================================
// POST /api/admin/patients/backfill-channel-metadata (PTR.1c — 28 Apr 2026)
//
// One-shot backfill: stamps current_stage + hospital_slug on every active
// patient-thread GetStream channel by calling syncPatientChannelMetadata
// for each patient_thread row. Idempotent — safe to re-run.
//
// Run once after PTR.1 deploys; PTR.3 sidebar grouping requires the
// channel.data fields to exist for every existing channel (414 in prod).
//
// Auth: super_admin only.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { syncPatientChannelMetadata } from '@/lib/sync-patient-channel-metadata';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // 5 min for ~414 channels

interface BackfillRow {
  id: string;
}

export async function POST(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const startMs = Date.now();
  let total = 0;
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    const rows = await query<BackfillRow>(
      `SELECT id::text AS id FROM patient_threads
        WHERE archived_at IS NULL
        ORDER BY created_at DESC`,
      []
    );
    total = rows.length;

    // Sequential — keep GetStream API rate happy + avoid overwhelming the cron.
    for (const r of rows) {
      const ok = await syncPatientChannelMetadata(r.id);
      if (ok) {
        succeeded++;
      } else {
        failed++;
        if (errors.length < 20) errors.push(r.id);
      }
    }

    const elapsedMs = Date.now() - startMs;
    return NextResponse.json({
      success: true,
      data: {
        total,
        succeeded,
        failed,
        elapsedMs,
        first_20_failed_thread_ids: errors,
      },
    });
  } catch (err) {
    console.error('[backfill-channel-metadata] aborted', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown',
        partial: { total, succeeded, failed, errors },
      },
      { status: 500 }
    );
  }
}
