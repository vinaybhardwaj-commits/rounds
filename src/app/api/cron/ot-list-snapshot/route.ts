// ============================================
// GET /api/cron/ot-list-snapshot
//
// 6 PM daily snapshot per active hospital. Writes ot_list_versions rows with
// version_type='provisional_6pm' capturing next-day (D+1) surgeries that are
// currently 'scheduled'. Per PRD §8.4 and Sprint 3 Day 12.
//
// Timezone note: Vercel cron runs at UTC; we schedule 12:30 UTC to hit 18:00
// IST (UTC+5:30). D+1 from IST perspective = local tomorrow's list_date.
//
// Auth: Bearer CRON_SECRET
//
// Idempotency: one provisional per hospital per day. If a row already exists
// for (hospital_id, list_date, version_type='provisional_6pm'), we UPDATE its
// case_ids + snapshot_payload instead of inserting duplicate. Final_930pm
// rows are never touched by this cron.
//
// Sprint 3 Day 12 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface HospitalRow {
  id: string;
  slug: string;
  name: string;
}

interface CaseRow {
  id: string;
  patient_name: string | null;
  planned_procedure: string | null;
  ot_room: number | null;
  urgency: string | null;
  surgeon_id: string | null;
  anaesthetist_id: string | null;
  state: string;
}

interface SnapshotResult {
  hospital_slug: string;
  list_date: string;
  case_count: number;
  action: 'inserted' | 'updated';
  version_id: string;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'FEATURE_CASE_MODEL_ENABLED is false',
      });
    }

    // D+1 from IST perspective. The cron fires at 12:30 UTC = 18:00 IST; tomorrow
    // in IST is today+1 day relative to that instant. Compute list_date as (now UTC + 5.5h + 1d)::date.
    // SQL side handles the timezone math more reliably than JS.
    const tomorrowRow = await query<{ list_date: string }>(
      `SELECT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date + INTERVAL '1 day')::date::text AS list_date`,
      []
    );
    const listDate = tomorrowRow[0]?.list_date;
    if (!listDate) {
      return NextResponse.json({ success: false, error: 'Failed to compute tomorrow date' }, { status: 500 });
    }

    const hospitals = await query<HospitalRow>(
      `SELECT id, slug, name FROM hospitals WHERE is_active = true ORDER BY slug`,
      []
    );

    const results: SnapshotResult[] = [];

    for (const h of hospitals) {
      // Fetch all scheduled/confirmed/verified cases for this hospital for list_date.
      const cases = await query<CaseRow>(
        `
        SELECT
          sc.id, pt.patient_name, sc.planned_procedure, sc.ot_room, sc.urgency,
          sc.surgeon_id, sc.anaesthetist_id, sc.state
        FROM surgical_cases sc
        LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
        WHERE sc.hospital_id = $1
          AND sc.planned_surgery_date = $2::date
          AND sc.state IN ('scheduled', 'confirmed', 'verified')
          AND sc.archived_at IS NULL
        ORDER BY sc.ot_room NULLS LAST, sc.created_at ASC
        `,
        [h.id, listDate]
      );

      const caseIds = cases.map((c) => c.id);
      const payload = {
        hospital: { id: h.id, slug: h.slug, name: h.name },
        list_date: listDate,
        snapshot_at: new Date().toISOString(),
        cases: cases.map((c) => ({
          id: c.id,
          patient_name: c.patient_name,
          procedure: c.planned_procedure,
          ot_room: c.ot_room,
          urgency: c.urgency,
          state: c.state,
        })),
      };

      // Upsert idiom: try INSERT, on partial-unique-ish situations just INSERT again
      // since there's no unique constraint on (hospital_id, list_date, version_type).
      // We enforce single-provisional by first DELETE-ing any existing provisional for
      // this (hospital, date) pair, then INSERT. Cheaper than a procedural check.
      const existing = await query<{ id: string }>(
        `
        DELETE FROM ot_list_versions
        WHERE hospital_id = $1
          AND list_date = $2::date
          AND version_type = 'provisional_6pm'
        RETURNING id
        `,
        [h.id, listDate]
      );
      const wasUpdate = existing.length > 0;

      const inserted = await query<{ id: string }>(
        `
        INSERT INTO ot_list_versions (hospital_id, list_date, version_type, case_ids, snapshot_payload)
        VALUES ($1, $2::date, 'provisional_6pm', $3::uuid[], $4::jsonb)
        RETURNING id
        `,
        [h.id, listDate, caseIds, JSON.stringify(payload)]
      );

      results.push({
        hospital_slug: h.slug,
        list_date: listDate,
        case_count: cases.length,
        action: wasUpdate ? 'updated' : 'inserted',
        version_id: inserted[0]?.id ?? '',
      });
    }

    return NextResponse.json({
      success: true,
      list_date: listDate,
      snapshots: results,
      hospitals_processed: hospitals.length,
    });
  } catch (error) {
    console.error('GET /api/cron/ot-list-snapshot error:', error);
    return NextResponse.json(
      { success: false, error: 'Snapshot failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
