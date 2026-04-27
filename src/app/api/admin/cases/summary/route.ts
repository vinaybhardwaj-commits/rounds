// ============================================
// GET /api/admin/cases/summary
//
// Aggregate metrics for the /admin/cases page. Per PRD §7.7: Overview +
// SLA breaches + Per-role + Objections+LSQ + By Hospital tabs. Sprint 3 Day 13
// ships Overview + By Hospital; others are stubs for Sprint 3.5.
//
// Access: central (role_scope='central') gets cross-hospital aggregates;
// hospital_bound gets only their hospital's metrics.
//
// Query:
//   window_days?: number  (default 7, max 90)
//
// Response:
//   {
//     window_days, generated_at,
//     by_hospital: [{ slug, name, is_active,
//                     handoffs_submitted, handoffs_acked, ack_rate,
//                     avg_ack_min,
//                     sla_breaches,
//                     cases_active, cases_completed, cases_cancelled, cases_postponed,
//                     pac_published, avg_pac_latency_min,
//                     ot_list_lock_rate
//                  }],
//     overview: { totals aggregated across accessible hospitals }
//   }
//
// Sprint 3 Day 13 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { getAdminHospitalScope, isAdminRole } from '@/lib/admin-hospital-scope';

interface PerHospital {
  slug: string;
  name: string;
  is_active: boolean;
  handoffs_submitted: number;
  sla_breaches: number;
  cases_active: number;
  cases_completed: number;
  cases_cancelled: number;
  cases_postponed: number;
  pac_published: number;
  ot_list_locks: number;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!isAdminRole(user.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const scope = await getAdminHospitalScope(user.role, user.primary_hospital_id ?? '');

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({
        success: true,
        feature_enabled: false,
        overview: null,
        by_hospital: [],
        message: 'Case model is disabled.',
      });
    }

    const { searchParams } = new URL(request.url);
    const rawWindow = parseInt(searchParams.get('window_days') || '7', 10);
    const windowDays = Math.max(1, Math.min(90, isNaN(rawWindow) ? 7 : rawWindow));

    // Pull all accessible hospitals in one query.
    const hospitals = await query<{
      id: string; slug: string; name: string; is_active: boolean;
    }>(
      `
      SELECT h.id, h.slug, h.name, h.is_active
      FROM hospitals h
      WHERE h.id = ANY(user_accessible_hospital_ids($1::UUID))
      ORDER BY h.slug
      `,
      [user.profileId]
    );

    const perHospital: PerHospital[] = [];

    for (const h of hospitals) {
      // Run all aggregates in a single round-trip where feasible. Neon HTTP
      // doesn't support CTEs across different queries efficiently, but each
      // single-statement query is cheap.
      const r = await query<{
        handoffs_submitted: number;
        sla_breaches: number;
        cases_active: number;
        cases_completed: number;
        cases_cancelled: number;
        cases_postponed: number;
        pac_published: number;
        ot_list_locks: number;
      }>(
        `
        SELECT
          (SELECT COUNT(*)::int FROM form_submissions fs
             WHERE fs.hospital_id = $1
               AND fs.submitted_at > NOW() - ($2 || ' days')::interval
               AND fs.form_type IN ('consolidated_marketing_handoff','financial_counseling','surgery_booking','admission_advice')
          ) AS handoffs_submitted,
          (SELECT COUNT(*)::int FROM form_submissions fs
             WHERE fs.hospital_id = $1
               AND fs.submitted_at > NOW() - ($2 || ' days')::interval
               AND fs.metadata ? 'sla_breach_posted_at'
          ) AS sla_breaches,
          (SELECT COUNT(*)::int FROM surgical_cases sc
             WHERE sc.hospital_id = $1
               AND sc.state NOT IN ('completed','cancelled','postponed')
               AND sc.archived_at IS NULL
          ) AS cases_active,
          (SELECT COUNT(*)::int FROM surgical_cases sc
             WHERE sc.hospital_id = $1
               AND sc.state = 'completed'
               AND sc.updated_at > NOW() - ($2 || ' days')::interval
          ) AS cases_completed,
          (SELECT COUNT(*)::int FROM surgical_cases sc
             WHERE sc.hospital_id = $1
               AND sc.state = 'cancelled'
               AND sc.updated_at > NOW() - ($2 || ' days')::interval
          ) AS cases_cancelled,
          (SELECT COUNT(*)::int FROM surgical_cases sc
             WHERE sc.hospital_id = $1
               AND sc.state = 'postponed'
               AND sc.updated_at > NOW() - ($2 || ' days')::interval
          ) AS cases_postponed,
          (SELECT COUNT(*)::int FROM pac_events pe
             JOIN surgical_cases sc ON sc.id = pe.case_id
             WHERE sc.hospital_id = $1
               AND pe.published_at > NOW() - ($2 || ' days')::interval
          ) AS pac_published,
          (SELECT COUNT(*)::int FROM ot_list_versions olv
             WHERE olv.hospital_id = $1
               AND olv.version_type = 'final_930pm'
               AND olv.created_at > NOW() - ($2 || ' days')::interval
          ) AS ot_list_locks
        `,
        [h.id, windowDays]
      );
      const row = r[0];
      perHospital.push({
        slug: h.slug,
        name: h.name,
        is_active: h.is_active,
        handoffs_submitted: row?.handoffs_submitted ?? 0,
        sla_breaches: row?.sla_breaches ?? 0,
        cases_active: row?.cases_active ?? 0,
        cases_completed: row?.cases_completed ?? 0,
        cases_cancelled: row?.cases_cancelled ?? 0,
        cases_postponed: row?.cases_postponed ?? 0,
        pac_published: row?.pac_published ?? 0,
        ot_list_locks: row?.ot_list_locks ?? 0,
      });
    }

    // Cross-hospital overview (sums)
    const overview = perHospital.reduce(
      (acc, h) => ({
        handoffs_submitted: acc.handoffs_submitted + h.handoffs_submitted,
        sla_breaches: acc.sla_breaches + h.sla_breaches,
        cases_active: acc.cases_active + h.cases_active,
        cases_completed: acc.cases_completed + h.cases_completed,
        cases_cancelled: acc.cases_cancelled + h.cases_cancelled,
        cases_postponed: acc.cases_postponed + h.cases_postponed,
        pac_published: acc.pac_published + h.pac_published,
        ot_list_locks: acc.ot_list_locks + h.ot_list_locks,
      }),
      {
        handoffs_submitted: 0, sla_breaches: 0, cases_active: 0,
        cases_completed: 0, cases_cancelled: 0, cases_postponed: 0,
        pac_published: 0, ot_list_locks: 0,
      }
    );

    return NextResponse.json({
      success: true,
      feature_enabled: true,
      window_days: windowDays,
      generated_at: new Date().toISOString(),
      hospitals_accessible: hospitals.length,
      overview,
      by_hospital: perHospital,
    });
  } catch (error) {
    console.error('GET /api/admin/cases/summary error:', error);
    return NextResponse.json(
      { success: false, error: 'Summary failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
