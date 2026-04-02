// ============================================
// Enhancement Alerts — Business Logic Layer
//
// Monitors the gap between running bill and
// approved amount. When it exceeds the threshold,
// alerts the patient thread + #billing + doctor.
// Also handles doctor case summary submission.
// ============================================

import { query, queryOne } from './db';
import { sendSystemMessage } from './getstream';
import { logClaimEvent, type ClaimRow } from './insurance-claims';
import { DEFAULT_ENHANCEMENT_THRESHOLD } from '@/types';

// ── Types ──

export interface EnhancementCheckResult {
  patientThreadId: string;
  patientName: string;
  claimId: string;
  runningBill: number;
  approvedAmount: number;
  gap: number;
  threshold: number;
  needsEnhancement: boolean;
  roomNumber: string | null;
  primarySurgeon: string | null;
}

export interface CaseSummaryInput {
  currentDiagnosis: string;
  ongoingTreatment: string;
  reasonForExtension: string;
  revisedEstimate: number;
}

// ── Core Functions ──

/**
 * Check a single patient for enhancement need.
 * Returns null if no claim or not applicable.
 */
export async function checkPatientEnhancement(
  patientThreadId: string,
): Promise<EnhancementCheckResult | null> {
  // Get admission tracker with billing data
  const tracker = await queryOne<{
    patient_thread_id: string;
    insurance_claim_id: string | null;
    running_bill_amount: number | null;
    cumulative_approved_amount: number | null;
    enhancement_alert_threshold: number | null;
    room_number: string | null;
    primary_surgeon: string | null;
  }>(
    `SELECT patient_thread_id, insurance_claim_id, running_bill_amount,
            cumulative_approved_amount, enhancement_alert_threshold,
            room_number, primary_surgeon
     FROM admission_tracker
     WHERE patient_thread_id = $1 AND current_status != 'discharged'
     ORDER BY created_at DESC LIMIT 1`,
    [patientThreadId]
  );

  if (!tracker?.insurance_claim_id || !tracker.running_bill_amount) return null;

  // Get claim for cumulative approved (more accurate than tracker snapshot)
  const claim = await queryOne<ClaimRow>(
    `SELECT * FROM insurance_claims WHERE id = $1`,
    [tracker.insurance_claim_id]
  );
  if (!claim) return null;

  const runningBill = Number(tracker.running_bill_amount);
  const approvedAmount = claim.cumulative_approved_amount ? Number(claim.cumulative_approved_amount) : 0;
  const threshold = tracker.enhancement_alert_threshold
    ? Number(tracker.enhancement_alert_threshold)
    : DEFAULT_ENHANCEMENT_THRESHOLD;
  const gap = runningBill - approvedAmount;

  // Get patient name
  const patient = await queryOne<{ patient_name: string }>(
    `SELECT patient_name FROM patient_threads WHERE id = $1`,
    [patientThreadId]
  );

  return {
    patientThreadId,
    patientName: patient?.patient_name || 'Unknown',
    claimId: claim.id,
    runningBill,
    approvedAmount,
    gap,
    threshold,
    needsEnhancement: gap >= threshold,
    roomNumber: tracker.room_number,
    primarySurgeon: tracker.primary_surgeon,
  };
}

/**
 * Check ALL active insurance patients for enhancement needs.
 * Returns list of patients who need enhancement.
 */
export async function checkAllEnhancements(): Promise<EnhancementCheckResult[]> {
  // Get all active admitted patients with insurance claims
  const patients = await query<{ patient_thread_id: string }>(
    `SELECT at.patient_thread_id
     FROM admission_tracker at
     WHERE at.current_status != 'discharged'
       AND at.insurance_claim_id IS NOT NULL
       AND at.running_bill_amount IS NOT NULL
       AND at.running_bill_amount > 0
     ORDER BY at.created_at DESC`
  );

  const results: EnhancementCheckResult[] = [];
  for (const p of patients) {
    const check = await checkPatientEnhancement(p.patient_thread_id);
    if (check?.needsEnhancement) {
      results.push(check);
    }
  }
  return results;
}

/**
 * Fire enhancement alert for a patient.
 * Posts system messages + logs claim event.
 */
export async function fireEnhancementAlert(
  check: EnhancementCheckResult,
  triggeredById: string,
  triggeredByName: string,
): Promise<void> {
  const formatCurrency = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  // Build alert message
  const alertMsg = [
    `🔔 **Enhancement recommended**`,
    `Running bill: ${formatCurrency(check.runningBill)} | Approved: ${formatCurrency(check.approvedAmount)} | Gap: ${formatCurrency(check.gap)}`,
    check.primarySurgeon ? `@${check.primarySurgeon} — please prepare case summary via /enhance` : 'Doctor — please prepare case summary',
    `@Billing — enhancement submission needed after case summary`,
  ].join('\n');

  // Get patient channel
  const patient = await queryOne<{ getstream_channel_id: string | null }>(
    `SELECT getstream_channel_id FROM patient_threads WHERE id = $1`,
    [check.patientThreadId]
  );

  // 1. Post to patient thread
  if (patient?.getstream_channel_id) {
    try {
      await sendSystemMessage('patient-thread', patient.getstream_channel_id, alertMsg);
    } catch (err) {
      console.error('[Enhancement] Failed to post to patient channel:', err);
    }
  }

  // 2. Post to #billing
  try {
    const roomInfo = check.roomNumber ? ` (Room ${check.roomNumber})` : '';
    await sendSystemMessage('department', 'billing',
      `🔔 Enhancement needed: ${check.patientName}${roomInfo}\nGap: ${formatCurrency(check.gap)} | Waiting on doctor case summary`
    );
  } catch (err) {
    console.error('[Enhancement] Failed to post to #billing:', err);
  }

  // 3. Log claim event
  try {
    await logClaimEvent(
      check.claimId,
      check.patientThreadId,
      'enhancement_triggered',
      `Running bill ${formatCurrency(check.runningBill)} exceeds approved ${formatCurrency(check.approvedAmount)} by ${formatCurrency(check.gap)} (threshold: ${formatCurrency(check.threshold)})`,
      triggeredById,
      triggeredByName,
      { amount: check.gap },
    );
  } catch (err) {
    console.error('[Enhancement] Failed to log event:', err);
  }
}

/**
 * Submit a doctor's case summary for enhancement.
 * Posts system messages + logs claim event.
 */
export async function submitCaseSummary(
  patientThreadId: string,
  claimId: string,
  summary: CaseSummaryInput,
  doctorId: string,
  doctorName: string,
): Promise<void> {
  const formatCurrency = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  // Log the event
  const description = [
    `Diagnosis: ${summary.currentDiagnosis}`,
    `Treatment: ${summary.ongoingTreatment}`,
    `Reason for extension: ${summary.reasonForExtension}`,
    `Revised estimate: ${formatCurrency(summary.revisedEstimate)}`,
  ].join('\n');

  await logClaimEvent(
    claimId,
    patientThreadId,
    'enhancement_case_summary_submitted',
    description,
    doctorId,
    doctorName,
    { amount: summary.revisedEstimate },
  );

  // Get patient info
  const patient = await queryOne<{
    patient_name: string;
    getstream_channel_id: string | null;
  }>(
    `SELECT patient_name, getstream_channel_id FROM patient_threads WHERE id = $1`,
    [patientThreadId]
  );

  // Post to patient thread
  const msg = [
    `👨‍⚕️ **Case summary submitted** by ${doctorName}`,
    `Diagnosis: ${summary.currentDiagnosis}`,
    `Revised estimate: ${formatCurrency(summary.revisedEstimate)}`,
    `✅ Billing can now proceed with enhancement submission`,
  ].join('\n');

  if (patient?.getstream_channel_id) {
    try {
      await sendSystemMessage('patient-thread', patient.getstream_channel_id, msg);
    } catch { /* non-fatal */ }
  }

  // Post to #billing
  try {
    await sendSystemMessage('department', 'billing',
      `👨‍⚕️ ${patient?.patient_name || 'Patient'}: Case summary ready — proceed with enhancement submission (revised: ${formatCurrency(summary.revisedEstimate)})`
    );
  } catch { /* non-fatal */ }

  // Also notify doctor — log that they've been notified
  try {
    await logClaimEvent(
      claimId,
      patientThreadId,
      'enhancement_doctor_notified',
      `Case summary received from ${doctorName}. Billing team notified to proceed.`,
      doctorId,
      doctorName,
    );
  } catch { /* non-fatal */ }
}

/**
 * Update the running bill amount for a patient.
 * Called manually or from external system sync.
 */
export async function updateRunningBill(
  patientThreadId: string,
  newAmount: number,
): Promise<{ updated: boolean; needsEnhancement: boolean }> {
  const result = await query(
    `UPDATE admission_tracker SET running_bill_amount = $2
     WHERE patient_thread_id = $1 AND current_status != 'discharged'
     RETURNING id`,
    [patientThreadId, newAmount]
  );

  if (result.length === 0) {
    return { updated: false, needsEnhancement: false };
  }

  // Check if this triggers an enhancement alert
  const check = await checkPatientEnhancement(patientThreadId);
  return {
    updated: true,
    needsEnhancement: check?.needsEnhancement || false,
  };
}
