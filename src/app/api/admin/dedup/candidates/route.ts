/**
 * GET /api/admin/dedup/candidates
 *
 * R.3 + R.4 Phase 5.1 — Review Queue endpoint for the Dedup Hub.
 *
 * Returns pending dedup_candidates enriched with both sides of the pair so
 * the UI can render a side-by-side comparison. Also supports ?status=merged
 * / ?status=distinct / ?status=ignored for the Activity Log tab (though the
 * Log tab will eventually read from dedup_log instead).
 *
 * Requires super_admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface CandidateRow {
  id: string;
  new_thread_id: string;
  existing_thread_id: string;
  similarity: string; // numeric(4,3) comes back as string
  match_type: string;
  match_fields: Record<string, unknown> | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;

  // new thread side
  new_patient_name: string | null;
  new_phone: string | null;
  new_whatsapp: string | null;
  new_city: string | null;
  new_uhid: string | null;
  new_source_type: string | null;
  new_lsq_lead_id: string | null;
  new_current_stage: string | null;
  new_archived_at: string | null;
  new_created_at: string | null;

  // existing thread side
  existing_patient_name: string | null;
  existing_phone: string | null;
  existing_whatsapp: string | null;
  existing_city: string | null;
  existing_uhid: string | null;
  existing_source_type: string | null;
  existing_lsq_lead_id: string | null;
  existing_current_stage: string | null;
  existing_archived_at: string | null;
  existing_created_at: string | null;
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
  const status = searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  const validStatus = ['pending', 'merged', 'distinct', 'ignored', 'all'];
  if (!validStatus.includes(status)) {
    return NextResponse.json(
      { success: false, error: `Invalid status. Must be one of: ${validStatus.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const rows = await query<CandidateRow>(
      `
      SELECT
        dc.id,
        dc.new_thread_id,
        dc.existing_thread_id,
        dc.similarity::text AS similarity,
        dc.match_type,
        dc.match_fields,
        dc.status,
        dc.created_at,
        dc.resolved_at,
        dc.resolved_by,
        dc.resolution_note,

        pt_new.patient_name    AS new_patient_name,
        pt_new.phone           AS new_phone,
        pt_new.whatsapp_number AS new_whatsapp,
        pt_new.city            AS new_city,
        pt_new.uhid            AS new_uhid,
        pt_new.source_type     AS new_source_type,
        pt_new.lsq_lead_id     AS new_lsq_lead_id,
        pt_new.current_stage   AS new_current_stage,
        pt_new.archived_at     AS new_archived_at,
        pt_new.created_at      AS new_created_at,

        pt_ex.patient_name     AS existing_patient_name,
        pt_ex.phone            AS existing_phone,
        pt_ex.whatsapp_number  AS existing_whatsapp,
        pt_ex.city             AS existing_city,
        pt_ex.uhid             AS existing_uhid,
        pt_ex.source_type      AS existing_source_type,
        pt_ex.lsq_lead_id      AS existing_lsq_lead_id,
        pt_ex.current_stage    AS existing_current_stage,
        pt_ex.archived_at      AS existing_archived_at,
        pt_ex.created_at       AS existing_created_at
      FROM dedup_candidates dc
      LEFT JOIN patient_threads pt_new ON pt_new.id = dc.new_thread_id
      LEFT JOIN patient_threads pt_ex  ON pt_ex.id  = dc.existing_thread_id
      WHERE ($1::text = 'all' OR dc.status = $1)
      ORDER BY dc.created_at DESC
      LIMIT $2
      `,
      [status, limit]
    );

    // Shape into UI-friendly pairs with a recommended winner.
    // Older row wins; LSQ-sourced beats non-LSQ as tiebreaker.
    const candidates = rows.map((r) => {
      const newer = {
        id: r.new_thread_id,
        patient_name: r.new_patient_name,
        phone: r.new_phone,
        whatsapp_number: r.new_whatsapp,
        city: r.new_city,
        uhid: r.new_uhid,
        source_type: r.new_source_type,
        lsq_lead_id: r.new_lsq_lead_id,
        current_stage: r.new_current_stage,
        archived_at: r.new_archived_at,
        created_at: r.new_created_at,
      };
      const existing = {
        id: r.existing_thread_id,
        patient_name: r.existing_patient_name,
        phone: r.existing_phone,
        whatsapp_number: r.existing_whatsapp,
        city: r.existing_city,
        uhid: r.existing_uhid,
        source_type: r.existing_source_type,
        lsq_lead_id: r.existing_lsq_lead_id,
        current_stage: r.existing_current_stage,
        archived_at: r.existing_archived_at,
        created_at: r.existing_created_at,
      };

      // Winner = older row. Tiebreaker = LSQ-sourced.
      let recommendedWinnerId = existing.id;
      const newerTs = newer.created_at ? new Date(newer.created_at).getTime() : Infinity;
      const existingTs = existing.created_at
        ? new Date(existing.created_at).getTime()
        : Infinity;
      if (newerTs < existingTs) {
        recommendedWinnerId = newer.id;
      } else if (newerTs === existingTs) {
        if (newer.lsq_lead_id && !existing.lsq_lead_id) {
          recommendedWinnerId = newer.id;
        }
      }

      return {
        id: r.id,
        similarity: parseFloat(r.similarity),
        match_type: r.match_type,
        match_fields: r.match_fields,
        status: r.status,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
        resolved_by: r.resolved_by,
        resolution_note: r.resolution_note,
        recommended_winner_id: recommendedWinnerId,
        newer,
        existing,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        candidates,
        total: candidates.length,
        status,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/dedup/candidates error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load dedup candidates' },
      { status: 500 }
    );
  }
}
