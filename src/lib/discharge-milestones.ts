// ============================================
// Discharge Milestones — Business Logic Layer
//
// Handles creating, updating, and querying
// discharge milestone chains. Each milestone
// step auto-calculates TAT and posts system
// messages to patient thread + #billing.
// ============================================

import { query, queryOne } from './db';
import { sendSystemMessage } from './getstream';
import { postPatientActivity, type ActivityEvent } from './patient-activity';
import type { DischargeMilestoneStep } from '@/types';
import { DISCHARGE_MILESTONE_LABELS, DISCHARGE_MILESTONE_ORDER } from '@/types';

// ── Types ──

export interface MilestoneRow {
  id: string;
  patient_thread_id: string;
  admission_tracker_id: string | null;
  insurance_claim_id: string | null;
  discharge_ordered_at: string | null;
  discharge_ordered_by: string | null;
  pharmacy_clearance_at: string | null;
  pharmacy_cleared_by: string | null;
  lab_clearance_at: string | null;
  lab_cleared_by: string | null;
  discharge_summary_at: string | null;
  discharge_summary_by: string | null;
  billing_closure_at: string | null;
  billing_closed_by: string | null;
  final_bill_submitted_at: string | null;
  final_bill_submitted_by: string | null;
  final_approval_at: string | null;
  final_approval_logged_by: string | null;
  patient_settled_at: string | null;
  patient_settled_by: string | null;
  patient_departed_at: string | null;
  tat_order_to_pharmacy: number | null;
  tat_order_to_summary: number | null;
  tat_summary_to_billing: number | null;
  tat_billing_to_submission: number | null;
  tat_submission_to_approval: number | null;
  tat_order_to_departure: number | null;
  is_complete: boolean;
  is_cancelled: boolean;
  cancellation_reason: string | null;
  bottleneck_step: string | null;
  bottleneck_minutes: number | null;
  created_at: string;
  updated_at: string;
}

// ── Milestone step → DB column mapping ──

const STEP_COLUMNS: Record<DischargeMilestoneStep, { at: string; by: string | null }> = {
  discharge_ordered: { at: 'discharge_ordered_at', by: 'discharge_ordered_by' },
  pharmacy_clearance: { at: 'pharmacy_clearance_at', by: 'pharmacy_cleared_by' },
  lab_clearance: { at: 'lab_clearance_at', by: 'lab_cleared_by' },
  discharge_summary: { at: 'discharge_summary_at', by: 'discharge_summary_by' },
  billing_closure: { at: 'billing_closure_at', by: 'billing_closed_by' },
  final_bill_submitted: { at: 'final_bill_submitted_at', by: 'final_bill_submitted_by' },
  final_approval: { at: 'final_approval_at', by: 'final_approval_logged_by' },
  patient_settled: { at: 'patient_settled_at', by: 'patient_settled_by' },
  patient_departed: { at: 'patient_departed_at', by: null },
};

// Emoji for each step
const STEP_EMOJI: Record<DischargeMilestoneStep, string> = {
  discharge_ordered: '🏁',
  pharmacy_clearance: '💊',
  lab_clearance: '🔬',
  discharge_summary: '📝',
  billing_closure: '💰',
  final_bill_submitted: '📤',
  final_approval: '✅',
  patient_settled: '🧾',
  patient_departed: '🚪',
};

// ── Helpers ──

function minutesBetween(a: string | Date, b: string | Date): number {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  return Math.round((end - start) / 60000);
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Core Functions ──

/**
 * Create a new discharge milestone chain for a patient.
 * Called when discharge is ordered (stage → discharge).
 */
export async function createDischargeMilestone(
  patientThreadId: string,
  orderedById: string,
): Promise<MilestoneRow> {
  // Check for existing active milestone
  const existing = await queryOne<MilestoneRow>(
    `SELECT * FROM discharge_milestones
     WHERE patient_thread_id = $1 AND is_complete = false AND is_cancelled = false`,
    [patientThreadId]
  );
  if (existing) return existing;

  // Look up admission_tracker and insurance_claim if they exist
  const tracker = await queryOne<{ id: string; insurance_claim_id: string | null }>(
    `SELECT id, insurance_claim_id FROM admission_tracker
     WHERE patient_thread_id = $1 AND current_status != 'discharged'
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );

  const now = new Date().toISOString();
  const rows = await query<MilestoneRow>(
    `INSERT INTO discharge_milestones (
      patient_thread_id, admission_tracker_id, insurance_claim_id,
      discharge_ordered_at, discharge_ordered_by
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [
      patientThreadId,
      tracker?.id || null,
      tracker?.insurance_claim_id || null,
      now,
      orderedById,
    ]
  );

  return rows[0];
}

/**
 * Update a specific milestone step. Auto-calculates TAT.
 * Returns the updated row.
 */
export async function updateMilestoneStep(
  milestoneId: string,
  step: DischargeMilestoneStep,
  userId: string,
): Promise<MilestoneRow> {
  const now = new Date().toISOString();
  const col = STEP_COLUMNS[step];

  // Build the SET clause
  const sets: string[] = [`${col.at} = $2`];
  const params: unknown[] = [milestoneId, now];
  let paramIdx = 3;

  if (col.by) {
    sets.push(`${col.by} = $${paramIdx}`);
    params.push(userId);
    paramIdx++;
  }

  const updateSql = `UPDATE discharge_milestones SET ${sets.join(', ')} WHERE id = $1 RETURNING *`;
  const rows = await query<MilestoneRow>(updateSql, params);

  if (rows.length === 0) {
    throw new Error(`Milestone ${milestoneId} not found`);
  }

  const milestone = rows[0];

  // Recalculate TATs
  await recalculateTATs(milestone);

  return milestone;
}

/**
 * Recalculate all TAT columns and bottleneck detection.
 */
async function recalculateTATs(m: MilestoneRow): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [m.id];
  let idx = 2;

  const orderTime = m.discharge_ordered_at;
  if (!orderTime) return;

  // TAT calculations
  const tats: { col: string; val: number | null }[] = [];

  if (m.pharmacy_clearance_at) {
    const val = minutesBetween(orderTime, m.pharmacy_clearance_at);
    tats.push({ col: 'tat_order_to_pharmacy', val });
  }
  if (m.discharge_summary_at) {
    const val = minutesBetween(orderTime, m.discharge_summary_at);
    tats.push({ col: 'tat_order_to_summary', val });
  }
  if (m.discharge_summary_at && m.billing_closure_at) {
    const val = minutesBetween(m.discharge_summary_at, m.billing_closure_at);
    tats.push({ col: 'tat_summary_to_billing', val });
  }
  if (m.billing_closure_at && m.final_bill_submitted_at) {
    const val = minutesBetween(m.billing_closure_at, m.final_bill_submitted_at);
    tats.push({ col: 'tat_billing_to_submission', val });
  }
  if (m.final_bill_submitted_at && m.final_approval_at) {
    const val = minutesBetween(m.final_bill_submitted_at, m.final_approval_at);
    tats.push({ col: 'tat_submission_to_approval', val });
  }
  if (m.patient_departed_at) {
    const val = minutesBetween(orderTime, m.patient_departed_at);
    tats.push({ col: 'tat_order_to_departure', val });
  }

  for (const t of tats) {
    sets.push(`${t.col} = $${idx}`);
    params.push(t.val);
    idx++;
  }

  // Bottleneck detection — find the step with the longest individual duration
  const steps: { step: string; minutes: number }[] = [];
  if (m.pharmacy_clearance_at) {
    steps.push({ step: 'pharmacy_clearance', minutes: minutesBetween(orderTime, m.pharmacy_clearance_at) });
  }
  if (m.discharge_summary_at) {
    const start = m.pharmacy_clearance_at || orderTime;
    steps.push({ step: 'discharge_summary', minutes: minutesBetween(start, m.discharge_summary_at) });
  }
  if (m.billing_closure_at && m.discharge_summary_at) {
    steps.push({ step: 'billing_closure', minutes: minutesBetween(m.discharge_summary_at, m.billing_closure_at) });
  }
  if (m.final_bill_submitted_at && m.billing_closure_at) {
    steps.push({ step: 'final_bill_submitted', minutes: minutesBetween(m.billing_closure_at, m.final_bill_submitted_at) });
  }
  if (m.final_approval_at && m.final_bill_submitted_at) {
    steps.push({ step: 'final_approval', minutes: minutesBetween(m.final_bill_submitted_at, m.final_approval_at) });
  }

  if (steps.length > 0) {
    const bottleneck = steps.reduce((max, s) => s.minutes > max.minutes ? s : max, steps[0]);
    sets.push(`bottleneck_step = $${idx}`);
    params.push(bottleneck.step);
    idx++;
    sets.push(`bottleneck_minutes = $${idx}`);
    params.push(bottleneck.minutes);
    idx++;
  }

  // Check if complete (patient has departed)
  if (m.patient_departed_at) {
    sets.push(`is_complete = $${idx}`);
    params.push(true);
    idx++;
  }

  if (sets.length > 0) {
    await query(`UPDATE discharge_milestones SET ${sets.join(', ')} WHERE id = $1`, params);
  }
}

/**
 * Get the active discharge milestone for a patient (if any).
 */
export async function getActiveMilestone(patientThreadId: string): Promise<MilestoneRow | null> {
  return queryOne<MilestoneRow>(
    `SELECT * FROM discharge_milestones
     WHERE patient_thread_id = $1 AND is_cancelled = false
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );
}

/**
 * Cancel an active discharge milestone (if discharge is reversed).
 */
export async function cancelMilestone(
  milestoneId: string,
  reason: string
): Promise<void> {
  await query(
    `UPDATE discharge_milestones SET is_cancelled = true, cancellation_reason = $2 WHERE id = $1`,
    [milestoneId, reason]
  );
}

// ── System Message Formatting ──

/**
 * Build a system message for a milestone step completion.
 * Includes elapsed time from previous step and from discharge order.
 */
export function formatMilestoneMessage(
  step: DischargeMilestoneStep,
  actorName: string,
  milestone: MilestoneRow,
): string {
  const emoji = STEP_EMOJI[step];
  const label = DISCHARGE_MILESTONE_LABELS[step];
  const now = new Date();
  const orderTime = milestone.discharge_ordered_at ? new Date(milestone.discharge_ordered_at) : null;

  // Calculate elapsed since discharge order
  let elapsedStr = '';
  if (orderTime && step !== 'discharge_ordered') {
    const elapsed = Math.round((now.getTime() - orderTime.getTime()) / 60000);
    elapsedStr = ` (${formatDuration(elapsed)} after discharge order)`;
  }

  // Calculate elapsed since previous step
  let prevStr = '';
  const stepIdx = DISCHARGE_MILESTONE_ORDER.indexOf(step);
  if (stepIdx > 1) { // Skip for first two (ordered + pharmacy)
    // Find the most recent completed prior step
    for (let i = stepIdx - 1; i >= 0; i--) {
      const prevStep = DISCHARGE_MILESTONE_ORDER[i];
      const prevCol = STEP_COLUMNS[prevStep].at;
      const prevTime = (milestone as Record<string, unknown>)[prevCol] as string | null;
      if (prevTime) {
        const prevMinutes = Math.round((now.getTime() - new Date(prevTime).getTime()) / 60000);
        prevStr = ` · ${formatDuration(prevMinutes)} since ${DISCHARGE_MILESTONE_LABELS[prevStep].toLowerCase()}`;
        break;
      }
    }
  }

  if (step === 'discharge_ordered') {
    return `${emoji} **Discharge ordered** by ${actorName}\nMilestone chain started — pharmacy, labs, summary, billing, submission, approval.`;
  }

  return `${emoji} **${label}** by ${actorName}${elapsedStr}${prevStr}`;
}

/**
 * Post a milestone system message to both patient thread and #billing channel.
 */
export async function postMilestoneMessage(
  step: DischargeMilestoneStep,
  actorName: string,
  patientName: string,
  patientChannelId: string | null,
  patientThreadId: string,
  milestone: MilestoneRow,
): Promise<void> {
  const message = formatMilestoneMessage(step, actorName, milestone);
  const shortLabel = DISCHARGE_MILESTONE_LABELS[step];

  // 1. Post to patient thread
  if (patientChannelId) {
    try {
      await sendSystemMessage('patient-thread', patientChannelId, message);
    } catch (err) {
      console.error(`[Discharge] Failed to post to patient channel:`, err);
    }
  }

  // 2. Post summary to #billing department channel
  try {
    const billingSlug = 'billing';
    const deptMsg = step === 'discharge_ordered'
      ? `🏁 Discharge ordered: ${patientName} — milestone chain started`
      : `${STEP_EMOJI[step]} ${patientName}: ${shortLabel} — by ${actorName}`;
    await sendSystemMessage('department', billingSlug, deptMsg);
  } catch (err) {
    console.error(`[Discharge] Failed to post to #billing:`, err);
  }

  // 3. Also post to discharge-coordination cross-functional channel
  try {
    await sendSystemMessage(
      'cross-functional',
      'discharge-coordination',
      `${STEP_EMOJI[step]} ${patientName}: ${shortLabel}${step === 'discharge_ordered' ? ' — chain started' : ''}`
    );
  } catch (err) {
    // Channel may not exist — non-fatal
  }
}

/**
 * Get a summary of completed vs pending milestones for display.
 */
export function getMilestoneProgress(milestone: MilestoneRow): {
  completed: DischargeMilestoneStep[];
  current: DischargeMilestoneStep | null;
  pending: DischargeMilestoneStep[];
  totalElapsedMinutes: number | null;
} {
  const completed: DischargeMilestoneStep[] = [];
  let current: DischargeMilestoneStep | null = null;

  for (const step of DISCHARGE_MILESTONE_ORDER) {
    const col = STEP_COLUMNS[step].at;
    const val = (milestone as Record<string, unknown>)[col] as string | null;
    if (val) {
      completed.push(step);
    } else if (!current) {
      current = step;
    }
  }

  const pending = DISCHARGE_MILESTONE_ORDER.filter(
    (s) => !completed.includes(s) && s !== current
  );

  let totalElapsedMinutes: number | null = null;
  if (milestone.discharge_ordered_at) {
    totalElapsedMinutes = minutesBetween(
      milestone.discharge_ordered_at,
      milestone.patient_departed_at || new Date().toISOString()
    );
  }

  return { completed, current, pending, totalElapsedMinutes };
}
