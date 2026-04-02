// ============================================
// Billing Intelligence — Metrics & Analytics
//
// Aggregated metrics from insurance_claims,
// claim_events, discharge_milestones, and
// form_submissions to prove/disprove operational
// improvement in revenue, speed, and satisfaction.
// ============================================

import { query, queryOne } from './db';

// ── Types ──

export interface RevenueMetrics {
  recoveryRate: number | null;           // avg final_approved / final_bill × 100
  totalBilled: number;
  totalRecovered: number;
  totalLeakage: number;
  proportionalDeductionsPrevented: number; // patients with deduction_pct = 0
  proportionalDeductionsTotal: number;     // total insurance patients with room data
  enhancementCaptureRate: number | null;   // submitted / triggered × 100
  avgRecoveryPerClaim: number | null;
  denialRateByInsurer: InsurerStat[];
  preAuthApprovalRate: number | null;
  leakageByReason: { reason: string; amount: number; count: number }[];
}

export interface SpeedMetrics {
  avgDischargeTatMinutes: number | null;
  avgTatByStep: {
    orderToPharmacy: number | null;
    orderToSummary: number | null;
    summaryToBilling: number | null;
    billingToSubmission: number | null;
    submissionToApproval: number | null;
  };
  avgBillingTatMinutes: number | null;    // summary_to_billing + billing_to_submission
  avgPreAuthTatMinutes: number | null;
  avgFinalSettlementTatMinutes: number | null;
  avgEnhancementResponseMinutes: number | null;
  avgQueryResponseMinutes: number | null;
}

export interface SatisfactionMetrics {
  avgBillingDocumentation: number | null;
  avgInsuranceProcessing: number | null;
  avgClinicalHandoff: number | null;
  avgDepartmentClearance: number | null;
  avgOverallSpeed: number | null;
  totalResponses: number;
  attributionAccuracy: {
    totalLowRatings: number;
    incorrectlyBlamed: number;
    accuracyPct: number | null;
  };
}

export interface InsurerStat {
  insurerName: string;
  totalClaims: number;
  deniedClaims: number;
  denialRate: number;
  avgRecoveryRate: number | null;
  avgPreAuthTat: number | null;
  avgFinalTat: number | null;
  totalQueries: number;
  avgQueriesPerClaim: number;
}

export interface BillingDashboard {
  period: { from: string; to: string };
  revenue: RevenueMetrics;
  speed: SpeedMetrics;
  satisfaction: SatisfactionMetrics;
}

export interface MilestoneAttribution {
  longestStep: string;
  longestStepMinutes: number;
  billingContributionMinutes: number;
  clinicalContributionMinutes: number;
  insurerContributionMinutes: number;
  totalDischargeMinutes: number;
}

// ── Revenue Metrics ──

export async function getRevenueMetrics(
  fromDate?: string,
  toDate?: string,
): Promise<RevenueMetrics> {
  const dateFilter = buildDateFilter('created_at', fromDate, toDate);

  // Recovery rate, totals
  const recovery = await queryOne<{
    avg_rate: number | null;
    total_billed: number;
    total_recovered: number;
    total_leakage: number;
    avg_per_claim: number | null;
  }>(
    `SELECT
       ROUND(AVG(recovery_rate)::numeric, 2) as avg_rate,
       COALESCE(SUM(final_bill_amount), 0) as total_billed,
       COALESCE(SUM(final_approved_amount), 0) as total_recovered,
       COALESCE(SUM(revenue_leakage), 0) as total_leakage,
       ROUND(AVG(final_approved_amount)::numeric, 2) as avg_per_claim
     FROM insurance_claims
     WHERE claim_status = 'settled' ${dateFilter}`
  );

  // Proportional deduction prevention
  const propDed = await queryOne<{
    prevented: number;
    total_with_room: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE proportional_deduction_pct IS NULL OR proportional_deduction_pct = 0) as prevented,
       COUNT(*) as total_with_room
     FROM insurance_claims
     WHERE room_category_selected IS NOT NULL ${dateFilter}`
  );

  // Enhancement capture rate
  const enhancement = await queryOne<{
    triggered: number;
    submitted: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'enhancement_triggered') as triggered,
       COUNT(*) FILTER (WHERE event_type = 'enhancement_submitted') as submitted
     FROM claim_events ${dateFilter ? 'WHERE ' + dateFilter.replace(' AND ', '') : ''}`
  );

  // Pre-auth approval rate
  const preAuth = await queryOne<{
    total_submitted: number;
    total_approved: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE pre_auth_status IN ('submitted', 'queried', 'approved', 'partial', 'denied')) as total_submitted,
       COUNT(*) FILTER (WHERE pre_auth_status IN ('approved', 'partial')) as total_approved
     FROM insurance_claims
     WHERE pre_auth_submitted_at IS NOT NULL ${dateFilter}`
  );

  // Denial rate by insurer
  const insurerDenials = await query<{
    insurer_name: string;
    total: number;
    denied: number;
    denial_rate: number;
  }>(
    `SELECT
       insurer_name,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE claim_status IN ('rejected', 'pre_auth_denied')) as denied,
       ROUND(
         (COUNT(*) FILTER (WHERE claim_status IN ('rejected', 'pre_auth_denied'))::numeric /
          NULLIF(COUNT(*), 0) * 100), 2
       ) as denial_rate
     FROM insurance_claims
     WHERE insurer_name IS NOT NULL ${dateFilter}
     GROUP BY insurer_name
     ORDER BY total DESC`
  );

  // Leakage by reason
  const leakage = await query<{
    reason: string;
    amount: number;
    count: number;
  }>(
    `SELECT
       COALESCE(leakage_reason, 'unspecified') as reason,
       COALESCE(SUM(revenue_leakage), 0) as amount,
       COUNT(*) as count
     FROM insurance_claims
     WHERE revenue_leakage > 0 ${dateFilter}
     GROUP BY leakage_reason
     ORDER BY amount DESC`
  );

  return {
    recoveryRate: recovery?.avg_rate ?? null,
    totalBilled: Number(recovery?.total_billed ?? 0),
    totalRecovered: Number(recovery?.total_recovered ?? 0),
    totalLeakage: Number(recovery?.total_leakage ?? 0),
    proportionalDeductionsPrevented: Number(propDed?.prevented ?? 0),
    proportionalDeductionsTotal: Number(propDed?.total_with_room ?? 0),
    enhancementCaptureRate: enhancement?.triggered
      ? Math.round((Number(enhancement.submitted) / Number(enhancement.triggered)) * 10000) / 100
      : null,
    avgRecoveryPerClaim: recovery?.avg_per_claim ? Number(recovery.avg_per_claim) : null,
    denialRateByInsurer: insurerDenials.map((d) => ({
      insurerName: d.insurer_name,
      totalClaims: Number(d.total),
      deniedClaims: Number(d.denied),
      denialRate: Number(d.denial_rate),
      avgRecoveryRate: null,
      avgPreAuthTat: null,
      avgFinalTat: null,
      totalQueries: 0,
      avgQueriesPerClaim: 0,
    })),
    preAuthApprovalRate: preAuth?.total_submitted
      ? Math.round((Number(preAuth.total_approved) / Number(preAuth.total_submitted)) * 10000) / 100
      : null,
    leakageByReason: leakage.map((l) => ({
      reason: l.reason,
      amount: Number(l.amount),
      count: Number(l.count),
    })),
  };
}

// ── Speed Metrics ──

export async function getSpeedMetrics(
  fromDate?: string,
  toDate?: string,
): Promise<SpeedMetrics> {
  const dateFilter = buildDateFilter('created_at', fromDate, toDate);

  // Discharge TATs from discharge_milestones
  const dischargeTat = await queryOne<{
    avg_total: number | null;
    avg_order_pharmacy: number | null;
    avg_order_summary: number | null;
    avg_summary_billing: number | null;
    avg_billing_submission: number | null;
    avg_submission_approval: number | null;
  }>(
    `SELECT
       ROUND(AVG(tat_order_to_departure)::numeric, 1) as avg_total,
       ROUND(AVG(tat_order_to_pharmacy)::numeric, 1) as avg_order_pharmacy,
       ROUND(AVG(tat_order_to_summary)::numeric, 1) as avg_order_summary,
       ROUND(AVG(tat_summary_to_billing)::numeric, 1) as avg_summary_billing,
       ROUND(AVG(tat_billing_to_submission)::numeric, 1) as avg_billing_submission,
       ROUND(AVG(tat_submission_to_approval)::numeric, 1) as avg_submission_approval
     FROM discharge_milestones
     WHERE is_complete = true AND is_cancelled = false ${dateFilter}`
  );

  // Billing TAT = summary_to_billing + billing_to_submission
  const billingTat = dischargeTat?.avg_summary_billing != null && dischargeTat?.avg_billing_submission != null
    ? Number(dischargeTat.avg_summary_billing) + Number(dischargeTat.avg_billing_submission)
    : null;

  // Insurance TATs from insurance_claims
  const insuranceTat = await queryOne<{
    avg_pre_auth: number | null;
    avg_final: number | null;
  }>(
    `SELECT
       ROUND(AVG(pre_auth_tat_minutes)::numeric, 1) as avg_pre_auth,
       ROUND(AVG(final_settlement_tat_minutes)::numeric, 1) as avg_final
     FROM insurance_claims
     WHERE claim_status IN ('settled', 'pre_auth_approved', 'active') ${dateFilter}`
  );

  // Enhancement response time: time between enhancement_triggered and enhancement_submitted
  const enhancementResp = await queryOne<{ avg_minutes: number | null }>(
    `SELECT ROUND(AVG(resp_minutes)::numeric, 1) as avg_minutes
     FROM (
       SELECT
         e1.insurance_claim_id,
         EXTRACT(EPOCH FROM (MIN(e2.created_at) - e1.created_at)) / 60 as resp_minutes
       FROM claim_events e1
       JOIN claim_events e2 ON e2.insurance_claim_id = e1.insurance_claim_id
         AND e2.event_type = 'enhancement_submitted'
         AND e2.created_at > e1.created_at
       WHERE e1.event_type = 'enhancement_triggered'
       GROUP BY e1.insurance_claim_id, e1.created_at
     ) sub`
  );

  // Query response time: pre_auth_queried → pre_auth_query_responded
  const queryResp = await queryOne<{ avg_minutes: number | null }>(
    `SELECT ROUND(AVG(resp_minutes)::numeric, 1) as avg_minutes
     FROM (
       SELECT
         e1.insurance_claim_id,
         EXTRACT(EPOCH FROM (MIN(e2.created_at) - e1.created_at)) / 60 as resp_minutes
       FROM claim_events e1
       JOIN claim_events e2 ON e2.insurance_claim_id = e1.insurance_claim_id
         AND e2.event_type = 'pre_auth_query_responded'
         AND e2.created_at > e1.created_at
       WHERE e1.event_type = 'pre_auth_queried'
       GROUP BY e1.insurance_claim_id, e1.created_at
     ) sub`
  );

  return {
    avgDischargeTatMinutes: dischargeTat?.avg_total ? Number(dischargeTat.avg_total) : null,
    avgTatByStep: {
      orderToPharmacy: dischargeTat?.avg_order_pharmacy ? Number(dischargeTat.avg_order_pharmacy) : null,
      orderToSummary: dischargeTat?.avg_order_summary ? Number(dischargeTat.avg_order_summary) : null,
      summaryToBilling: dischargeTat?.avg_summary_billing ? Number(dischargeTat.avg_summary_billing) : null,
      billingToSubmission: dischargeTat?.avg_billing_submission ? Number(dischargeTat.avg_billing_submission) : null,
      submissionToApproval: dischargeTat?.avg_submission_approval ? Number(dischargeTat.avg_submission_approval) : null,
    },
    avgBillingTatMinutes: billingTat,
    avgPreAuthTatMinutes: insuranceTat?.avg_pre_auth ? Number(insuranceTat.avg_pre_auth) : null,
    avgFinalSettlementTatMinutes: insuranceTat?.avg_final ? Number(insuranceTat.avg_final) : null,
    avgEnhancementResponseMinutes: enhancementResp?.avg_minutes ? Number(enhancementResp.avg_minutes) : null,
    avgQueryResponseMinutes: queryResp?.avg_minutes ? Number(queryResp.avg_minutes) : null,
  };
}

// ── Satisfaction Metrics ──

export async function getSatisfactionMetrics(
  fromDate?: string,
  toDate?: string,
): Promise<SatisfactionMetrics> {
  const dateFilter = buildDateFilter('created_at', fromDate, toDate);

  // Ratings from post_discharge_followup form submissions
  const ratings = await queryOne<{
    avg_billing: number | null;
    avg_insurance: number | null;
    avg_clinical: number | null;
    avg_clearance: number | null;
    avg_speed: number | null;
    total: number;
  }>(
    `SELECT
       ROUND(AVG((form_data->>'rating_billing_documentation')::numeric), 2) as avg_billing,
       ROUND(AVG((form_data->>'rating_insurance_processing')::numeric), 2) as avg_insurance,
       ROUND(AVG((form_data->>'rating_clinical_handoff')::numeric), 2) as avg_clinical,
       ROUND(AVG((form_data->>'rating_department_clearance')::numeric), 2) as avg_clearance,
       ROUND(AVG((form_data->>'rating_overall_speed')::numeric), 2) as avg_speed,
       COUNT(*) as total
     FROM form_submissions
     WHERE form_type = 'post_discharge_followup'
       AND status = 'submitted'
       AND form_data->>'rating_billing_documentation' IS NOT NULL
       ${dateFilter}`
  );

  // Attribution accuracy: how many low billing ratings (<= 2) were actually caused by non-billing delays
  const attribution = await queryOne<{
    total_low: number;
    incorrectly_blamed: number;
  }>(
    `SELECT
       COUNT(*) as total_low,
       COUNT(*) FILTER (
         WHERE form_data->'milestone_attribution'->>'longest_step' NOT LIKE 'billing%'
           AND form_data->'milestone_attribution'->>'longest_step' NOT LIKE 'summary_to_billing%'
       ) as incorrectly_blamed
     FROM form_submissions
     WHERE form_type = 'post_discharge_followup'
       AND status = 'submitted'
       AND (form_data->>'rating_billing_documentation')::int <= 2
       AND form_data->'milestone_attribution' IS NOT NULL
       ${dateFilter}`
  );

  const totalLow = Number(attribution?.total_low ?? 0);
  const incorrectlyBlamed = Number(attribution?.incorrectly_blamed ?? 0);

  return {
    avgBillingDocumentation: ratings?.avg_billing ? Number(ratings.avg_billing) : null,
    avgInsuranceProcessing: ratings?.avg_insurance ? Number(ratings.avg_insurance) : null,
    avgClinicalHandoff: ratings?.avg_clinical ? Number(ratings.avg_clinical) : null,
    avgDepartmentClearance: ratings?.avg_clearance ? Number(ratings.avg_clearance) : null,
    avgOverallSpeed: ratings?.avg_speed ? Number(ratings.avg_speed) : null,
    totalResponses: Number(ratings?.total ?? 0),
    attributionAccuracy: {
      totalLowRatings: totalLow,
      incorrectlyBlamed,
      accuracyPct: totalLow > 0
        ? Math.round((incorrectlyBlamed / totalLow) * 10000) / 100
        : null,
    },
  };
}

// ── Insurer Performance ──

export async function getInsurerPerformance(
  fromDate?: string,
  toDate?: string,
): Promise<InsurerStat[]> {
  const dateFilter = buildDateFilter('ic.created_at', fromDate, toDate);

  const insurers = await query<{
    insurer_name: string;
    total_claims: number;
    denied_claims: number;
    denial_rate: number;
    avg_recovery: number | null;
    avg_pre_auth_tat: number | null;
    avg_final_tat: number | null;
    total_queries: number;
  }>(
    `SELECT
       ic.insurer_name,
       COUNT(DISTINCT ic.id) as total_claims,
       COUNT(DISTINCT ic.id) FILTER (WHERE ic.claim_status IN ('rejected', 'pre_auth_denied')) as denied_claims,
       ROUND(
         (COUNT(DISTINCT ic.id) FILTER (WHERE ic.claim_status IN ('rejected', 'pre_auth_denied'))::numeric /
          NULLIF(COUNT(DISTINCT ic.id), 0) * 100), 2
       ) as denial_rate,
       ROUND(AVG(ic.recovery_rate)::numeric, 2) as avg_recovery,
       ROUND(AVG(ic.pre_auth_tat_minutes)::numeric, 1) as avg_pre_auth_tat,
       ROUND(AVG(ic.final_settlement_tat_minutes)::numeric, 1) as avg_final_tat,
       COALESCE(SUM(
         CASE WHEN ce.event_type IN ('pre_auth_queried', 'final_queried') THEN 1 ELSE 0 END
       ), 0) as total_queries
     FROM insurance_claims ic
     LEFT JOIN claim_events ce ON ce.insurance_claim_id = ic.id
     WHERE ic.insurer_name IS NOT NULL ${dateFilter}
     GROUP BY ic.insurer_name
     ORDER BY total_claims DESC`
  );

  return insurers.map((i) => ({
    insurerName: i.insurer_name,
    totalClaims: Number(i.total_claims),
    deniedClaims: Number(i.denied_claims),
    denialRate: Number(i.denial_rate),
    avgRecoveryRate: i.avg_recovery ? Number(i.avg_recovery) : null,
    avgPreAuthTat: i.avg_pre_auth_tat ? Number(i.avg_pre_auth_tat) : null,
    avgFinalTat: i.avg_final_tat ? Number(i.avg_final_tat) : null,
    totalQueries: Number(i.total_queries),
    avgQueriesPerClaim: Number(i.total_claims)
      ? Math.round((Number(i.total_queries) / Number(i.total_claims)) * 10) / 10
      : 0,
  }));
}

// ── Full Dashboard ──

export async function getBillingDashboard(
  fromDate?: string,
  toDate?: string,
): Promise<BillingDashboard> {
  const [revenue, speed, satisfaction] = await Promise.all([
    getRevenueMetrics(fromDate, toDate),
    getSpeedMetrics(fromDate, toDate),
    getSatisfactionMetrics(fromDate, toDate),
  ]);

  return {
    period: {
      from: fromDate || 'all-time',
      to: toDate || 'now',
    },
    revenue,
    speed,
    satisfaction,
  };
}

// ── Feedback Attribution ──

/**
 * Calculate milestone attribution for a discharged patient.
 * Cross-references actual discharge_milestones TATs with
 * claim event timings to determine what caused delays.
 */
export async function calculateMilestoneAttribution(
  patientThreadId: string,
): Promise<MilestoneAttribution | null> {
  // Get the completed discharge milestones
  const milestone = await queryOne<{
    tat_order_to_pharmacy: number | null;
    tat_order_to_summary: number | null;
    tat_summary_to_billing: number | null;
    tat_billing_to_submission: number | null;
    tat_submission_to_approval: number | null;
    tat_order_to_departure: number | null;
  }>(
    `SELECT tat_order_to_pharmacy, tat_order_to_summary,
            tat_summary_to_billing, tat_billing_to_submission,
            tat_submission_to_approval, tat_order_to_departure
     FROM discharge_milestones
     WHERE patient_thread_id = $1
       AND is_complete = true
       AND is_cancelled = false
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );

  if (!milestone || !milestone.tat_order_to_departure) return null;

  // Break down by responsibility:
  // Clinical: order_to_summary (doctor writing discharge summary)
  // Billing: summary_to_billing + billing_to_submission
  // Insurer: submission_to_approval
  const clinical = (Number(milestone.tat_order_to_summary) || 0);
  const billing = (Number(milestone.tat_summary_to_billing) || 0) +
                  (Number(milestone.tat_billing_to_submission) || 0);
  const insurer = (Number(milestone.tat_submission_to_approval) || 0);
  const total = Number(milestone.tat_order_to_departure);

  // Find the longest step
  const steps: Record<string, number> = {
    clinical_summary: Number(milestone.tat_order_to_summary) || 0,
    pharmacy_clearance: Number(milestone.tat_order_to_pharmacy) || 0,
    billing_closure: Number(milestone.tat_summary_to_billing) || 0,
    bill_submission: Number(milestone.tat_billing_to_submission) || 0,
    insurer_approval: insurer,
  };

  let longestStep = 'unknown';
  let longestMinutes = 0;
  for (const [step, minutes] of Object.entries(steps)) {
    if (minutes > longestMinutes) {
      longestStep = step;
      longestMinutes = minutes;
    }
  }

  return {
    longestStep,
    longestStepMinutes: longestMinutes,
    billingContributionMinutes: billing,
    clinicalContributionMinutes: clinical,
    insurerContributionMinutes: insurer,
    totalDischargeMinutes: total,
  };
}

// ── Helpers ──

function buildDateFilter(
  column: string,
  fromDate?: string,
  toDate?: string,
): string {
  const parts: string[] = [];
  if (fromDate) parts.push(`${column} >= '${fromDate}'`);
  if (toDate) parts.push(`${column} <= '${toDate}'`);
  return parts.length > 0 ? ' AND ' + parts.join(' AND ') : '';
}
