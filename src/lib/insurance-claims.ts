// ============================================
// Insurance Claims — Business Logic Layer
//
// Handles creating, updating, and querying
// insurance claims and claim events. Each event
// auto-posts system messages to patient thread +
// #billing department channel.
// ============================================

import { query, queryOne } from './db';
import { sendSystemMessage } from './getstream';
import type { ClaimStatus, ClaimEventType } from '@/types';
import {
  CLAIM_STATUS_LABELS,
  CLAIM_EVENT_LABELS,
  CLAIM_EVENT_COLORS,
  IRDA_TAT,
} from '@/types';

// ── Types ──

export interface ClaimRow {
  id: string;
  patient_thread_id: string;
  admission_tracker_id: string | null;
  insurer_name: string | null;
  tpa_name: string | null;
  submission_channel: string;
  portal_used: string | null;
  policy_number: string | null;
  claim_number: string | null;
  sum_insured: number | null;
  room_rent_eligibility: number | null;
  room_category_selected: string | null;
  actual_room_rent: number | null;
  proportional_deduction_pct: number | null;
  co_pay_pct: number | null;
  has_room_rent_waiver: boolean;
  estimated_cost: number | null;
  pre_auth_submitted_at: string | null;
  pre_auth_approved_at: string | null;
  pre_auth_amount: number | null;
  pre_auth_status: string;
  pre_auth_tat_minutes: number | null;
  total_enhancements: number;
  latest_enhancement_amount: number | null;
  cumulative_approved_amount: number | null;
  final_bill_amount: number | null;
  final_submitted_at: string | null;
  final_approved_at: string | null;
  final_approved_amount: number | null;
  final_settlement_tat_minutes: number | null;
  hospital_discount: number | null;
  non_payable_deductions: number | null;
  patient_liability: number | null;
  claim_status: ClaimStatus;
  recovery_rate: number | null;
  revenue_leakage: number | null;
  leakage_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaimEventRow {
  id: string;
  insurance_claim_id: string;
  patient_thread_id: string;
  event_type: ClaimEventType;
  description: string;
  amount: number | null;
  portal_reference: string | null;
  document_urls: string[] | null;
  insurer_response_needed: boolean;
  insurer_response_deadline: string | null;
  performed_by: string | null;
  performed_by_name: string | null;
  getstream_message_id: string | null;
  created_at: string;
}

// ── Status transition map: which event types move to which status ──

const EVENT_STATUS_MAP: Partial<Record<ClaimEventType, ClaimStatus>> = {
  counseling_completed: 'pre_auth_pending',
  pre_auth_submitted: 'pre_auth_pending',
  pre_auth_queried: 'pre_auth_queried',
  pre_auth_query_responded: 'pre_auth_pending',
  pre_auth_approved: 'pre_auth_approved',
  pre_auth_denied: 'pre_auth_denied',
  pre_auth_partial: 'pre_auth_approved',
  enhancement_submitted: 'enhancement_pending',
  enhancement_approved: 'active',
  enhancement_denied: 'active',
  final_submitted: 'final_submitted',
  final_queried: 'final_queried',
  final_query_responded: 'final_submitted',
  final_approved: 'settled',
  final_rejected: 'rejected',
  dispute_initiated: 'disputed',
  dispute_resolved: 'settled',
};

// ── Emoji for event types ──

const EVENT_EMOJI: Partial<Record<ClaimEventType, string>> = {
  counseling_completed: '📋',
  pre_auth_submitted: '📤',
  pre_auth_queried: '❓',
  pre_auth_query_responded: '💬',
  pre_auth_approved: '✅',
  pre_auth_denied: '❌',
  pre_auth_partial: '⚠️',
  enhancement_triggered: '🔔',
  enhancement_doctor_notified: '👨‍⚕️',
  enhancement_case_summary_submitted: '📄',
  enhancement_submitted: '📤',
  enhancement_approved: '✅',
  enhancement_denied: '❌',
  final_bill_prepared: '📝',
  final_submitted: '📤',
  final_queried: '❓',
  final_query_responded: '💬',
  final_approved: '🟢',
  final_rejected: '🔴',
  dispute_initiated: '⚖️',
  dispute_resolved: '🤝',
  room_change: '🏠',
  follow_up_needed: '⏰',
  follow_up_completed: '✅',
  note_added: '📝',
  document_uploaded: '📎',
};

// ── Helpers ──

function minutesBetween(a: string | Date, b: string | Date): number {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  return Math.round((end - start) / 60000);
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function getSubmissionTimingAdvisory(): string {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sunday

  if (day === 0 && hour >= 13) {
    return '\n⚠️ Sunday afternoon — processing unlikely until Monday.';
  }
  if (hour >= 16) {
    return '\n⚠️ Insurer staff typically transition shifts 5–6 PM. Same-day approval less likely.';
  }
  if (hour >= 13) {
    return '\n⚠️ After 1 PM — same-day processing less likely.';
  }
  if (hour >= 11) {
    return '\nSubmitting now — on track for same-day processing.';
  }
  return '\n✓ Good timing — submissions before 1 PM typically processed same-day.';
}

// ── Core Functions ──

/**
 * Get or create an insurance claim for a patient.
 */
export async function getOrCreateClaim(
  patientThreadId: string,
  createdById: string,
): Promise<ClaimRow> {
  // Check for existing active claim
  const existing = await queryOne<ClaimRow>(
    `SELECT * FROM insurance_claims
     WHERE patient_thread_id = $1
     AND claim_status NOT IN ('settled', 'rejected')
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );
  if (existing) return existing;

  // Also return settled claims if no active one
  const settled = await queryOne<ClaimRow>(
    `SELECT * FROM insurance_claims
     WHERE patient_thread_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );
  if (settled) return settled;

  // Look up admission_tracker for linking
  const tracker = await queryOne<{
    id: string;
    insurer_name: string | null;
    tpa_name: string | null;
    submission_channel: string | null;
    sum_insured: number | null;
    room_rent_eligibility: number | null;
    financial_category: string;
    pre_auth_amount: number | null;
    policy_number: string | null;
  }>(
    `SELECT id, insurer_name, tpa_name, submission_channel, sum_insured,
            room_rent_eligibility, financial_category, pre_auth_amount, policy_number
     FROM admission_tracker
     WHERE patient_thread_id = $1 AND current_status != 'discharged'
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );

  const rows = await query<ClaimRow>(
    `INSERT INTO insurance_claims (
      patient_thread_id, admission_tracker_id,
      insurer_name, tpa_name, submission_channel,
      policy_number, sum_insured, room_rent_eligibility,
      pre_auth_amount, claim_status, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      patientThreadId,
      tracker?.id || null,
      tracker?.insurer_name || null,
      tracker?.tpa_name || null,
      tracker?.submission_channel || 'tpa',
      tracker?.policy_number || null,
      tracker?.sum_insured || null,
      tracker?.room_rent_eligibility || null,
      tracker?.pre_auth_amount || null,
      'counseling',
      createdById,
    ]
  );

  // Link back to admission_tracker
  if (tracker?.id && rows[0]) {
    try {
      await query(
        `UPDATE admission_tracker SET insurance_claim_id = $1 WHERE id = $2`,
        [rows[0].id, tracker.id]
      );
    } catch {
      // Non-fatal
    }
  }

  return rows[0];
}

/**
 * Get a claim by patient thread ID (most recent).
 */
export async function getClaimByPatient(patientThreadId: string): Promise<ClaimRow | null> {
  return queryOne<ClaimRow>(
    `SELECT * FROM insurance_claims
     WHERE patient_thread_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );
}

/**
 * Get the full event timeline for a claim.
 */
export async function getClaimTimeline(claimId: string): Promise<ClaimEventRow[]> {
  return query<ClaimEventRow>(
    `SELECT * FROM claim_events
     WHERE insurance_claim_id = $1
     ORDER BY created_at ASC`,
    [claimId]
  );
}

/**
 * Log a claim event. This is the main action — it:
 * 1. Inserts an immutable event row
 * 2. Updates claim status + relevant fields
 * 3. Calculates TATs where applicable
 * 4. Returns the updated claim + event
 */
export async function logClaimEvent(
  claimId: string,
  patientThreadId: string,
  eventType: ClaimEventType,
  description: string,
  performedById: string,
  performedByName: string,
  opts?: {
    amount?: number;
    portalReference?: string;
    documentUrls?: string[];
  },
): Promise<{ claim: ClaimRow; event: ClaimEventRow }> {
  const now = new Date().toISOString();

  // Determine if insurer response is needed + deadline
  let insurerResponseNeeded = false;
  let insurerResponseDeadline: string | null = null;

  if (eventType === 'pre_auth_submitted') {
    insurerResponseNeeded = true;
    const deadline = new Date(Date.now() + IRDA_TAT.pre_auth * 60000);
    insurerResponseDeadline = deadline.toISOString();
  } else if (eventType === 'final_submitted') {
    insurerResponseNeeded = true;
    const deadline = new Date(Date.now() + IRDA_TAT.final_approval * 60000);
    insurerResponseDeadline = deadline.toISOString();
  }

  // 1. Insert event
  const events = await query<ClaimEventRow>(
    `INSERT INTO claim_events (
      insurance_claim_id, patient_thread_id, event_type,
      description, amount, portal_reference, document_urls,
      insurer_response_needed, insurer_response_deadline,
      performed_by, performed_by_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      claimId, patientThreadId, eventType,
      description, opts?.amount || null, opts?.portalReference || null,
      opts?.documentUrls || null,
      insurerResponseNeeded, insurerResponseDeadline,
      performedById, performedByName,
    ]
  );

  // 2. Build claim updates based on event type
  const sets: string[] = [];
  const params: unknown[] = [claimId];
  let idx = 2;

  // Status transition
  const newStatus = EVENT_STATUS_MAP[eventType];
  if (newStatus) {
    sets.push(`claim_status = $${idx}`);
    params.push(newStatus);
    idx++;
  }

  // Event-specific field updates
  switch (eventType) {
    case 'pre_auth_submitted':
      sets.push(`pre_auth_submitted_at = $${idx}`);
      params.push(now);
      idx++;
      sets.push(`pre_auth_status = $${idx}`);
      params.push('submitted');
      idx++;
      if (opts?.amount) {
        sets.push(`estimated_cost = $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      if (opts?.portalReference) {
        sets.push(`claim_number = $${idx}`);
        params.push(opts.portalReference);
        idx++;
      }
      break;

    case 'pre_auth_approved':
    case 'pre_auth_partial':
      sets.push(`pre_auth_approved_at = $${idx}`);
      params.push(now);
      idx++;
      sets.push(`pre_auth_status = $${idx}`);
      params.push(eventType === 'pre_auth_partial' ? 'partial' : 'approved');
      idx++;
      if (opts?.amount) {
        sets.push(`pre_auth_amount = $${idx}`);
        params.push(opts.amount);
        idx++;
        sets.push(`cumulative_approved_amount = $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      // Calculate pre-auth TAT
      {
        const claim = await queryOne<ClaimRow>(
          `SELECT pre_auth_submitted_at FROM insurance_claims WHERE id = $1`,
          [claimId]
        );
        if (claim?.pre_auth_submitted_at) {
          const tat = minutesBetween(claim.pre_auth_submitted_at, now);
          sets.push(`pre_auth_tat_minutes = $${idx}`);
          params.push(tat);
          idx++;
        }
      }
      break;

    case 'pre_auth_denied':
      sets.push(`pre_auth_status = $${idx}`);
      params.push('denied');
      idx++;
      break;

    case 'pre_auth_queried':
      sets.push(`pre_auth_status = $${idx}`);
      params.push('queried');
      idx++;
      break;

    case 'enhancement_submitted':
      if (opts?.amount) {
        sets.push(`latest_enhancement_amount = $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      sets.push(`total_enhancements = total_enhancements + 1`);
      break;

    case 'enhancement_approved':
      if (opts?.amount) {
        sets.push(`cumulative_approved_amount = COALESCE(cumulative_approved_amount, 0) + $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      break;

    case 'final_bill_prepared':
      if (opts?.amount) {
        sets.push(`final_bill_amount = $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      break;

    case 'final_submitted':
      sets.push(`final_submitted_at = $${idx}`);
      params.push(now);
      idx++;
      if (opts?.amount) {
        sets.push(`final_bill_amount = $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      break;

    case 'final_approved': {
      sets.push(`final_approved_at = $${idx}`);
      params.push(now);
      idx++;
      if (opts?.amount) {
        sets.push(`final_approved_amount = $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      // Calculate final settlement TAT
      const claim = await queryOne<ClaimRow>(
        `SELECT final_submitted_at, final_bill_amount FROM insurance_claims WHERE id = $1`,
        [claimId]
      );
      if (claim?.final_submitted_at) {
        const tat = minutesBetween(claim.final_submitted_at, now);
        sets.push(`final_settlement_tat_minutes = $${idx}`);
        params.push(tat);
        idx++;
      }
      // Calculate recovery rate
      if (opts?.amount && claim?.final_bill_amount) {
        const rate = (opts.amount / Number(claim.final_bill_amount)) * 100;
        sets.push(`recovery_rate = $${idx}`);
        params.push(Math.round(rate * 100) / 100);
        idx++;
        const leakage = Number(claim.final_bill_amount) - opts.amount;
        if (leakage > 0) {
          sets.push(`revenue_leakage = $${idx}`);
          params.push(leakage);
          idx++;
        }
      }
      break;
    }

    case 'final_rejected':
      if (description) {
        sets.push(`leakage_reason = $${idx}`);
        params.push(description);
        idx++;
      }
      break;

    case 'room_change':
      if (opts?.amount) {
        sets.push(`actual_room_rent = $${idx}`);
        params.push(opts.amount);
        idx++;
      }
      break;
  }

  // 3. Update claim
  let updatedClaim: ClaimRow;
  if (sets.length > 0) {
    const updateSql = `UPDATE insurance_claims SET ${sets.join(', ')} WHERE id = $1 RETURNING *`;
    const rows = await query<ClaimRow>(updateSql, params);
    updatedClaim = rows[0];
  } else {
    updatedClaim = (await queryOne<ClaimRow>(
      `SELECT * FROM insurance_claims WHERE id = $1`,
      [claimId]
    ))!;
  }

  return { claim: updatedClaim, event: events[0] };
}

// ── System Message Formatting ──

/**
 * Build a system message for a claim event.
 */
export function formatClaimMessage(
  eventType: ClaimEventType,
  actorName: string,
  claim: ClaimRow,
  description: string,
  amount?: number | null,
  portalReference?: string | null,
): string {
  const emoji = EVENT_EMOJI[eventType] || '📋';
  const label = CLAIM_EVENT_LABELS[eventType] || eventType;
  const color = CLAIM_EVENT_COLORS[eventType] || '#6b7280';

  let msg = `${emoji} **${label}** by ${actorName}`;

  // Add contextual details per event type
  switch (eventType) {
    case 'pre_auth_submitted':
      msg += `\nEstimated: ${formatCurrency(amount)}`;
      if (portalReference) msg += ` | Claim #: ${portalReference}`;
      if (claim.portal_used) msg += ` via ${claim.portal_used}`;
      msg += `\nExpected response by ${new Date(Date.now() + IRDA_TAT.pre_auth * 60000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} (IRDA 8-hr TAT)`;
      msg += getSubmissionTimingAdvisory();
      break;

    case 'pre_auth_approved':
    case 'pre_auth_partial':
      msg += `\nApproved: ${formatCurrency(amount)}`;
      if (claim.estimated_cost) {
        const pct = amount ? Math.round((amount / Number(claim.estimated_cost)) * 100) : 0;
        msg += ` of ${formatCurrency(Number(claim.estimated_cost))} estimated (${pct}%)`;
      }
      if (claim.pre_auth_tat_minutes) {
        const h = Math.floor(claim.pre_auth_tat_minutes / 60);
        const m = claim.pre_auth_tat_minutes % 60;
        msg += ` | TAT: ${h}h ${m}m`;
      }
      break;

    case 'pre_auth_denied':
      msg += `\nReason: ${description}`;
      break;

    case 'pre_auth_queried':
      msg += `\n"${description}"`;
      msg += '\n⏱ Response needed promptly to avoid TAT breach';
      break;

    case 'enhancement_submitted':
      msg += `\nEnhancement #${(claim.total_enhancements || 0) + 1}: ${formatCurrency(amount)}`;
      msg += `\nCurrent approved: ${formatCurrency(claim.cumulative_approved_amount ? Number(claim.cumulative_approved_amount) : null)}`;
      break;

    case 'enhancement_approved':
      msg += `\nAdditional approved: ${formatCurrency(amount)}`;
      msg += `\nNew total approved: ${formatCurrency(amount ? (Number(claim.cumulative_approved_amount || 0) + amount) : null)}`;
      break;

    case 'final_submitted':
      msg += `\nFinal bill: ${formatCurrency(amount)}`;
      msg += `\nApproved so far: ${formatCurrency(claim.cumulative_approved_amount ? Number(claim.cumulative_approved_amount) : null)}`;
      msg += getSubmissionTimingAdvisory();
      break;

    case 'final_approved':
      msg += `\nSettled: ${formatCurrency(amount)}`;
      if (claim.final_bill_amount) {
        const pct = amount ? Math.round((amount / Number(claim.final_bill_amount)) * 100) : 0;
        msg += ` of ${formatCurrency(Number(claim.final_bill_amount))} billed (${pct}% recovery)`;
      }
      break;

    case 'final_rejected':
      msg += `\nReason: ${description}`;
      break;

    default:
      if (description && description !== label) {
        msg += `\n${description}`;
      }
      if (amount) msg += ` | Amount: ${formatCurrency(amount)}`;
      break;
  }

  return msg;
}

/**
 * Post a claim event system message to patient thread + #billing channel.
 */
export async function postClaimMessage(
  eventType: ClaimEventType,
  actorName: string,
  patientName: string,
  patientChannelId: string | null,
  claim: ClaimRow,
  description: string,
  amount?: number | null,
  portalReference?: string | null,
): Promise<void> {
  const message = formatClaimMessage(eventType, actorName, claim, description, amount, portalReference);
  const label = CLAIM_EVENT_LABELS[eventType] || eventType;
  const emoji = EVENT_EMOJI[eventType] || '📋';

  // 1. Post to patient thread
  if (patientChannelId) {
    try {
      await sendSystemMessage('patient-thread', patientChannelId, message);
    } catch (err) {
      console.error(`[Claim] Failed to post to patient channel:`, err);
    }
  }

  // 2. Post summary to #billing department channel
  try {
    const deptMsg = `${emoji} ${patientName}: ${label} — by ${actorName}`;
    await sendSystemMessage('department', 'billing', deptMsg);
  } catch (err) {
    console.error(`[Claim] Failed to post to #billing:`, err);
  }
}

/**
 * Get a summary of the claim for display in patient detail view.
 */
export function getClaimSummary(claim: ClaimRow): {
  statusLabel: string;
  statusColor: string;
  headroom: number | null;
  enhancementSoonWarning: boolean;
  proportionalDeductionRisk: boolean;
  recoveryPct: number | null;
} {
  const statusLabel = CLAIM_STATUS_LABELS[claim.claim_status] || claim.claim_status;
  const statusColorMap: Record<string, string> = {
    counseling: '#6b7280',
    pre_auth_pending: '#f59e0b',
    pre_auth_queried: '#f59e0b',
    pre_auth_approved: '#22c55e',
    pre_auth_denied: '#ef4444',
    enhancement_pending: '#f59e0b',
    active: '#3b82f6',
    final_submitted: '#f59e0b',
    final_queried: '#f59e0b',
    settled: '#22c55e',
    rejected: '#ef4444',
    disputed: '#ef4444',
  };
  const statusColor = statusColorMap[claim.claim_status] || '#6b7280';

  // Headroom: approved - running bill (from admission_tracker)
  const approved = claim.cumulative_approved_amount ? Number(claim.cumulative_approved_amount) : null;
  // We'll let the API layer inject running_bill_amount if available
  const headroom = approved; // Will be calculated at display time with running bill

  // Enhancement warning: if cumulative approved and we know a threshold
  const enhancementSoonWarning = false; // Calculated at API layer with running_bill_amount

  // Proportional deduction risk
  const proportionalDeductionRisk = claim.proportional_deduction_pct != null &&
    Number(claim.proportional_deduction_pct) > 0 &&
    !claim.has_room_rent_waiver;

  // Recovery percentage
  const recoveryPct = claim.recovery_rate ? Number(claim.recovery_rate) : null;

  return {
    statusLabel,
    statusColor,
    headroom,
    enhancementSoonWarning,
    proportionalDeductionRisk,
    recoveryPct,
  };
}
