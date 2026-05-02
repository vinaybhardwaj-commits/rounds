// =============================================================================
// GET /api/pac-workspace/[caseId]/suggestions   (PCW2.4a)
//
// Returns the live pac_suggestions for one case, partitioned into
//   { pending: [], skipped: [], decided: [] }
// for the inbox UI. Coordinator decisions (already_done / accepted) live
// on the section rows (pac_orders / pac_clearances) so they're not duplicated
// here — only suggestions still in the inbox flow are returned.
//
// Auth: any role with PAC read access (super_admin universally passes via
// hasRole).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const PAC_READ_ROLES = [
  'ip_coordinator',
  'pac_coordinator',
  'anesthesiologist',
  'consultant',
  'surgeon',
  'nurse',
  'charge_nurse',
  'ot_coordinator',
  'department_head',
] as const;

interface SuggestionRow {
  id: string;
  rule_id: string;
  rule_version: number;
  severity: 'required' | 'recommended' | 'info';
  status: 'pending' | 'accepted' | 'already_done' | 'skipped' | 'auto_dismissed' | 'superseded';
  routes_to: 'diagnostic' | 'clearance' | 'order' | 'pac_visit' | 'asa_review' | 'info_only';
  proposed_payload: Record<string, unknown> | null;
  reason_text: string | null;
  sop_reference: string | null;
  recency_window_days: number | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason_code: string | null;
  decision_reason_notes: string | null;
  /** PCW2.6 — populated by Already-Done modal (PCW2.4b); used to detect resurrected rows. */
  already_done_evidence: Record<string, unknown> | null;
  parent_section_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { caseId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, PAC_READ_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    // Tenancy check.
    const existsRow = await queryOne<{ id: string }>(
      `SELECT id FROM surgical_cases
        WHERE id = $1
          AND archived_at IS NULL
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [caseId, user.profileId]
    );
    if (!existsRow) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    // Pull all live (non-superseded, non-auto-dismissed) rows ordered by
    // severity then created_at — matches the inbox sort order in PRD §8.1.
    const rows = await sqlQuery<SuggestionRow>(
      `SELECT id, rule_id, rule_version, severity, status, routes_to,
              proposed_payload, reason_text, sop_reference, recency_window_days,
              decided_by, decided_at, decision_reason_code, decision_reason_notes,
              already_done_evidence,
              parent_section_item_id, created_at::text AS created_at,
              updated_at::text AS updated_at
         FROM pac_suggestions
        WHERE case_id = $1
          AND status NOT IN ('superseded', 'auto_dismissed')
        ORDER BY
          CASE severity
            WHEN 'required'    THEN 0
            WHEN 'recommended' THEN 1
            WHEN 'info'        THEN 2
            ELSE 3
          END,
          created_at ASC`,
      [caseId]
    );

    const pending: SuggestionRow[] = [];
    const skipped: SuggestionRow[] = [];
    const decided: SuggestionRow[] = [];
    for (const r of rows) {
      if (r.status === 'pending') pending.push(r);
      else if (r.status === 'skipped') skipped.push(r);
      else decided.push(r); // accepted / already_done
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          caseId,
          pending,
          skipped,
          decided,
          counts: {
            pending: pending.length,
            skipped: skipped.length,
            decided: decided.length,
            requiredPending: pending.filter((r) => r.severity === 'required').length,
            recommendedPending: pending.filter((r) => r.severity === 'recommended').length,
            infoPending: pending.filter((r) => r.severity === 'info').length,
          },
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('GET /api/pac-workspace/[caseId]/suggestions error:', err);
    return NextResponse.json({ success: false, error: 'Failed to load suggestions' }, { status: 500 });
  }
}
