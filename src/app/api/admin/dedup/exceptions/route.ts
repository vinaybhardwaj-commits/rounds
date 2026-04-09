/**
 * GET /api/admin/dedup/exceptions
 *
 * R.3 + R.4 Phase 5.3 — Exceptions tab endpoint for the Dedup Hub.
 *
 * Scans pending dedup_candidates and surfaces those whose naive merge would
 * hit one of four guardrails. The Exceptions tab is the last of the three
 * Dedup Hub tabs (Review Queue, Activity Log, Exceptions).
 *
 * The 4 guards ("exception types"):
 *
 *   1. lsq_conflict        — both threads have distinct lsq_lead_id values.
 *                            `mergePatientThreads` literally throws here
 *                            unless the reason contains "override".
 *                            (see src/lib/dedup.ts, line ~496)
 *
 *   2. uhid_collision      — both threads have non-null UHIDs that differ.
 *                            Safe to merge only if admin confirms the
 *                            duplicate is a single patient recorded under
 *                            two KX rows (rare but has happened).
 *
 *   3. stage_regression    — both threads have a known current_stage and
 *                            the absolute rank gap is >= 2 stages. Catches
 *                            suspicious pairs where one side has jumped
 *                            ahead while the other stalled — a likely
 *                            indicator the two rows are actually different
 *                            patients rather than a dedup.
 *
 *   4. idempotency_conflict — at least one thread already has merged_into_id
 *                            or archived_at set. The candidate is stale —
 *                            the merge has effectively already happened on
 *                            one side, so this row needs to be resolved or
 *                            dismissed rather than merged again.
 *
 * Behavior:
 *   - Default view: all-time open exceptions (no date filter by design —
 *     see user decision for Phase 5.3).
 *   - Resolved exceptions disappear immediately — because the query only
 *     reads dedup_candidates WHERE status='pending', any state change
 *     (merged/distinct/ignored) removes the row from this endpoint.
 *   - ?candidate_id=<uuid> returns a single row (even if pending) with
 *     computed flags. Used by the Review Queue override banner.
 *   - ?types=lsq_conflict,uhid_collision,... restricts to the given flags.
 *   - ?patient=<substring> restricts to rows where either side matches.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       exceptions: ExceptionEntry[],
 *       total: number,
 *       limit: number,
 *       offset: number,
 *       has_more: boolean,
 *       counts: { lsq_conflict, uhid_collision, stage_regression, idempotency_conflict }
 *     }
 *   }
 *
 * Requires super_admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// -----------------------------------------------------------------------------
// Exception-flag computation (exported for reuse in the single-candidate path
// and for the smoke test)
// -----------------------------------------------------------------------------

/** Canonical stage ordering — mirror of src/lib/dedup.ts STAGE_ORDER. */
const STAGE_ORDER: Record<string, number> = {
  opd: 0,
  pre_admission: 1,
  admitted: 2,
  pre_op: 3,
  surgery: 4,
  post_op: 5,
  post_op_care: 6,
  medical_management: 6,
  discharge: 7,
  post_discharge: 8,
  long_term_followup: 9,
};

function stageRank(stage: string | null | undefined): number {
  if (!stage) return -1;
  return STAGE_ORDER[stage] ?? -1;
}

/** Gap threshold (in stage ranks) that marks a candidate as stage_regression. */
export const STAGE_REGRESSION_GAP = 2;

export type ExceptionType =
  | 'lsq_conflict'
  | 'uhid_collision'
  | 'stage_regression'
  | 'idempotency_conflict';

export const ALL_EXCEPTION_TYPES: readonly ExceptionType[] = [
  'lsq_conflict',
  'uhid_collision',
  'stage_regression',
  'idempotency_conflict',
] as const;

export interface ThreadSnapshot {
  id: string;
  patient_name: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  city: string | null;
  uhid: string | null;
  source_type: string | null;
  lsq_lead_id: string | null;
  current_stage: string | null;
  archived_at: string | null;
  merged_into_id: string | null;
  created_at: string | null;
}

export interface ExceptionFlags {
  lsq_conflict: boolean;
  uhid_collision: boolean;
  stage_regression: boolean;
  idempotency_conflict: boolean;
}

/**
 * Pure function: compute exception flags from a pair of thread snapshots.
 * Exported for reuse in the single-candidate path and smoke tests.
 * `a` and `b` order is irrelevant — all checks are symmetric.
 */
export function computeExceptionFlags(
  a: ThreadSnapshot | null,
  b: ThreadSnapshot | null
): ExceptionFlags {
  if (!a || !b) {
    // If either side is missing, treat as idempotency_conflict — the thread
    // was probably hard-deleted and this candidate is orphaned.
    return {
      lsq_conflict: false,
      uhid_collision: false,
      stage_regression: false,
      idempotency_conflict: true,
    };
  }

  // LSQ conflict: both sides have a lead id and they differ
  const lsq_conflict = !!(
    a.lsq_lead_id &&
    b.lsq_lead_id &&
    a.lsq_lead_id.trim() !== '' &&
    b.lsq_lead_id.trim() !== '' &&
    a.lsq_lead_id !== b.lsq_lead_id
  );

  // UHID collision: both sides have a uhid and they differ (case-insensitive
  // trimmed compare — KX sometimes emits whitespace/casing drift)
  const aU = (a.uhid ?? '').trim().toUpperCase();
  const bU = (b.uhid ?? '').trim().toUpperCase();
  const uhid_collision = !!(aU && bU && aU !== bU);

  // Stage regression: both sides have a known stage and the rank gap is >=
  // STAGE_REGRESSION_GAP. Unknown stages (rank -1) don't trigger this.
  const ar = stageRank(a.current_stage);
  const br = stageRank(b.current_stage);
  const stage_regression =
    ar >= 0 && br >= 0 && Math.abs(ar - br) >= STAGE_REGRESSION_GAP;

  // Idempotency conflict: either side is already merged/archived
  const idempotency_conflict = !!(
    a.merged_into_id ||
    b.merged_into_id ||
    a.archived_at ||
    b.archived_at
  );

  return { lsq_conflict, uhid_collision, stage_regression, idempotency_conflict };
}

/** True if at least one flag is set. */
export function hasAnyFlag(flags: ExceptionFlags): boolean {
  return (
    flags.lsq_conflict ||
    flags.uhid_collision ||
    flags.stage_regression ||
    flags.idempotency_conflict
  );
}

// -----------------------------------------------------------------------------
// Query shape
// -----------------------------------------------------------------------------

interface CandidateRow {
  id: string;
  new_thread_id: string;
  existing_thread_id: string;
  similarity: string;
  match_type: string;
  status: string;
  created_at: string;

  new_patient_name: string | null;
  new_phone: string | null;
  new_whatsapp: string | null;
  new_city: string | null;
  new_uhid: string | null;
  new_source_type: string | null;
  new_lsq_lead_id: string | null;
  new_current_stage: string | null;
  new_archived_at: string | null;
  new_merged_into_id: string | null;
  new_created_at: string | null;

  existing_patient_name: string | null;
  existing_phone: string | null;
  existing_whatsapp: string | null;
  existing_city: string | null;
  existing_uhid: string | null;
  existing_source_type: string | null;
  existing_lsq_lead_id: string | null;
  existing_current_stage: string | null;
  existing_archived_at: string | null;
  existing_merged_into_id: string | null;
  existing_created_at: string | null;
}

function rowToSnapshots(r: CandidateRow): {
  newer: ThreadSnapshot;
  existing: ThreadSnapshot;
} {
  return {
    newer: {
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
      merged_into_id: r.new_merged_into_id,
      created_at: r.new_created_at,
    },
    existing: {
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
      merged_into_id: r.existing_merged_into_id,
      created_at: r.existing_created_at,
    },
  };
}

const SELECT_COLUMNS = `
  dc.id,
  dc.new_thread_id,
  dc.existing_thread_id,
  dc.similarity::text AS similarity,
  dc.match_type,
  dc.status,
  dc.created_at,

  pt_new.patient_name    AS new_patient_name,
  pt_new.phone           AS new_phone,
  pt_new.whatsapp_number AS new_whatsapp,
  pt_new.city            AS new_city,
  pt_new.uhid            AS new_uhid,
  pt_new.source_type     AS new_source_type,
  pt_new.lsq_lead_id     AS new_lsq_lead_id,
  pt_new.current_stage   AS new_current_stage,
  pt_new.archived_at     AS new_archived_at,
  pt_new.merged_into_id  AS new_merged_into_id,
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
  pt_ex.merged_into_id   AS existing_merged_into_id,
  pt_ex.created_at       AS existing_created_at
`;

const FROM_JOIN = `
  FROM dedup_candidates dc
  LEFT JOIN patient_threads pt_new ON pt_new.id = dc.new_thread_id
  LEFT JOIN patient_threads pt_ex  ON pt_ex.id  = dc.existing_thread_id
`;

// -----------------------------------------------------------------------------
// GET handler
// -----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);

  // Single-candidate lookup (used by Review Queue override banner)
  const candidateId = searchParams.get('candidate_id');
  if (candidateId) {
    if (!UUID_RE.test(candidateId)) {
      return NextResponse.json(
        { success: false, error: 'candidate_id must be a valid UUID' },
        { status: 400 }
      );
    }
    try {
      const rows = await query<CandidateRow>(
        `SELECT ${SELECT_COLUMNS} ${FROM_JOIN} WHERE dc.id = $1 LIMIT 1`,
        [candidateId]
      );
      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Candidate not found' },
          { status: 404 }
        );
      }
      const r = rows[0];
      const { newer, existing } = rowToSnapshots(r);
      const flags = computeExceptionFlags(newer, existing);
      return NextResponse.json({
        success: true,
        data: {
          exception: {
            id: r.id,
            similarity: parseFloat(r.similarity),
            match_type: r.match_type,
            status: r.status,
            created_at: r.created_at,
            newer,
            existing,
            flags,
            has_any_flag: hasAnyFlag(flags),
          },
        },
      });
    } catch (err) {
      console.error('GET /api/admin/dedup/exceptions (single) error:', err);
      return NextResponse.json(
        { success: false, error: 'Failed to load exception' },
        { status: 500 }
      );
    }
  }

  // List view: parse filters
  const typesParam = searchParams.get('types'); // comma-separated
  let typeFilter: Set<ExceptionType> | null = null;
  if (typesParam) {
    const parts = typesParam.split(',').map((s) => s.trim()).filter(Boolean);
    const invalid = parts.filter(
      (p) => !ALL_EXCEPTION_TYPES.includes(p as ExceptionType)
    );
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid exception types: ${invalid.join(', ')}. Valid: ${ALL_EXCEPTION_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }
    typeFilter = new Set(parts as ExceptionType[]);
  }

  const patientFilter = (searchParams.get('patient') || '').trim();

  const limitRaw = parseInt(searchParams.get('limit') || '100', 10);
  if (!Number.isFinite(limitRaw) || limitRaw <= 0 || limitRaw > 500) {
    return NextResponse.json(
      { success: false, error: 'limit must be an integer between 1 and 500' },
      { status: 400 }
    );
  }
  const limit = limitRaw;

  const offsetRaw = parseInt(searchParams.get('offset') || '0', 10);
  if (!Number.isFinite(offsetRaw) || offsetRaw < 0) {
    return NextResponse.json(
      { success: false, error: 'offset must be a non-negative integer' },
      { status: 400 }
    );
  }
  const offset = offsetRaw;

  try {
    // Only scan pending candidates — resolved candidates aren't exceptions.
    // Patient filter runs in SQL (ILIKE on either side) to shrink the set.
    const params: unknown[] = [];
    let whereClause = `WHERE dc.status = 'pending'`;

    if (patientFilter) {
      params.push(`%${patientFilter}%`);
      whereClause += ` AND (pt_new.patient_name ILIKE $${params.length} OR pt_ex.patient_name ILIKE $${params.length})`;
    }

    // Over-fetch: we compute flags in JS then filter. Hard ceiling at 5000
    // rows scanned to keep the page fast even on very large pending queues.
    // In practice pending dedup_candidates rarely exceeds a few hundred.
    const SCAN_CEILING = 5000;

    const rows = await query<CandidateRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_JOIN} ${whereClause} ORDER BY dc.created_at DESC LIMIT ${SCAN_CEILING}`,
      params
    );

    // Compute flags + filter
    const counts: Record<ExceptionType, number> = {
      lsq_conflict: 0,
      uhid_collision: 0,
      stage_regression: 0,
      idempotency_conflict: 0,
    };

    const flagged = rows
      .map((r) => {
        const { newer, existing } = rowToSnapshots(r);
        const flags = computeExceptionFlags(newer, existing);
        return { r, newer, existing, flags };
      })
      .filter(({ flags }) => hasAnyFlag(flags))
      .filter(({ flags }) => {
        if (!typeFilter) return true;
        // Row is kept if any of the requested types are set
        return Array.from(typeFilter).some((t) => flags[t]);
      });

    // Tally counts across all flagged rows (pre-pagination) so chips
    // reflect the total exception load, not the current page
    for (const { flags } of flagged) {
      if (flags.lsq_conflict) counts.lsq_conflict += 1;
      if (flags.uhid_collision) counts.uhid_collision += 1;
      if (flags.stage_regression) counts.stage_regression += 1;
      if (flags.idempotency_conflict) counts.idempotency_conflict += 1;
    }

    const total = flagged.length;
    const page = flagged.slice(offset, offset + limit);

    // Shape into UI-friendly records
    const exceptions = page.map(({ r, newer, existing, flags }) => {
      // Same "older wins, LSQ tiebreaker" rule as the candidates endpoint
      let recommendedWinnerId = existing.id;
      const newerTs = newer.created_at ? new Date(newer.created_at).getTime() : Infinity;
      const existingTs = existing.created_at
        ? new Date(existing.created_at).getTime()
        : Infinity;
      if (newerTs < existingTs) recommendedWinnerId = newer.id;
      else if (newerTs === existingTs) {
        if (newer.lsq_lead_id && !existing.lsq_lead_id) recommendedWinnerId = newer.id;
      }

      return {
        id: r.id,
        similarity: parseFloat(r.similarity),
        match_type: r.match_type,
        status: r.status,
        created_at: r.created_at,
        recommended_winner_id: recommendedWinnerId,
        newer,
        existing,
        flags,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        exceptions,
        total,
        limit,
        offset,
        has_more: offset + page.length < total,
        counts,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/dedup/exceptions error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load exceptions' },
      { status: 500 }
    );
  }
}
