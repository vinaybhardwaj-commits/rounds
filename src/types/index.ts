// ============================================
// Rounds — Type Definitions (v5.0)
// Updated: 29 March 2026
// ============================================

// ============================================
// ROLES & AUTH
// ============================================

export type UserRole =
  | 'super_admin'
  | 'hospital_admin'
  | 'department_head'
  | 'staff'
  | 'ip_coordinator'
  | 'anesthesiologist'
  | 'ot_coordinator'
  | 'nurse'
  // 26 Apr 2026 follow-up FU2: widen the enum so the role gates shipped in
  // F3 actually fire when users carry these roles. Until profiles are
  // backfilled with these values, the gates remain super_admin-only.
  | 'charge_nurse'
  | 'consultant'
  | 'surgeon'
  | 'biomedical_engineer'
  | 'billing_executive'
  | 'insurance_coordinator'
  | 'pharmacist'
  | 'physiotherapist'
  | 'marketing_executive'
  | 'clinical_care'
  | 'pac_coordinator'
  | 'administrator'
  | 'medical_administrator'
  | 'operations_manager'
  | 'unit_head'
  | 'marketing'
  | 'guest';

export type AccountType = 'internal' | 'guest';

export type ProfileStatus = 'pending_approval' | 'active' | 'suspended' | 'rejected';

// ============================================
// PROFILES & DEPARTMENTS
// ============================================

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  account_type: AccountType;
  department_id: string | null;
  department_name?: string;
  designation: string | null;
  phone: string | null;
  status: ProfileStatus;
  is_active: boolean;
  password_hash?: string | null;
  kiosk_pin_hash: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  last_login_at: string | null;
}

export interface Department {
  id: string;
  name: string;
  slug: string;
  head_profile_id: string | null;
  head_name?: string;
  is_active: boolean;
  created_at: string;
}

// ============================================
// MESSAGE TYPES (GetStream extraData)
// ============================================

/** v5 renames 'general' → 'chat'. Legacy v4 'general' type preserved for backward compat. */
export type MessageType =
  | 'chat'
  | 'general' // legacy alias for 'chat'
  | 'request'
  | 'update'
  | 'escalation'
  | 'fyi'
  | 'decision_needed'
  | 'patient_lead';

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

/** Color mapping for message types (used in UI) */
export const MESSAGE_TYPE_COLORS: Record<string, string> = {
  chat: 'transparent',
  general: 'transparent',
  request: '#0055FF',
  update: '#22C55E',
  escalation: '#EF4444',
  fyi: '#6B7280',
  decision_needed: '#F97316',
  patient_lead: '#8B5CF6',
};

export const MESSAGE_TYPE_LABELS: Record<string, string> = {
  chat: 'Chat',
  general: 'Chat',
  request: 'Request',
  update: 'Update',
  escalation: 'Escalation',
  fyi: 'FYI',
  decision_needed: 'Decision Needed',
  patient_lead: 'Patient Lead',
};

// ============================================
// GETSTREAM CHANNEL TYPES
// ============================================

export type ChannelType =
  | 'department'
  | 'cross-functional'
  | 'patient-thread'
  | 'direct'
  | 'ops-broadcast';

// ============================================
// FORMS
// ============================================

export type FormType =
  | 'consolidated_marketing_handoff'
  | 'marketing_cc_handoff'       // legacy — kept for existing form submissions
  | 'admission_advice'
  | 'financial_counseling'
  | 'surgery_booking'
  | 'ot_billing_clearance'
  | 'admission_checklist'
  | 'surgery_posting'
  | 'pre_op_nursing_checklist'
  | 'who_safety_checklist'
  | 'nursing_shift_handoff'
  | 'discharge_readiness'
  | 'post_discharge_followup'
  | 'daily_department_update'
  | 'pac_clearance';

export type FormStatus = 'draft' | 'submitted' | 'reviewed' | 'flagged';

export interface FormSubmission {
  id: string;
  form_type: FormType;
  patient_thread_id: string | null;
  getstream_message_id: string | null;
  submitted_by: string;
  submitted_by_name?: string;
  form_data: Record<string, unknown>;
  completion_score: number | null;
  ai_gap_report: Record<string, unknown> | null;
  status: FormStatus;
  form_version: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// PATIENT JOURNEY
// ============================================

export type PatientStage =
  | 'opd'
  | 'pre_admission'
  | 'admitted'
  | 'pre_op'
  | 'surgery'
  | 'post_op'
  | 'discharge'
  | 'post_discharge'
  | 'medical_management'
  | 'post_op_care'
  | 'long_term_followup';

export const PATIENT_STAGE_LABELS: Record<PatientStage, string> = {
  opd: 'OPD',
  pre_admission: 'Pre-Admission',
  admitted: 'Admitted',
  pre_op: 'Pre-Op',
  surgery: 'Surgery',
  post_op: 'Post-Op',
  discharge: 'Discharge',
  post_discharge: 'Post-Discharge',
  medical_management: 'Medical Management',
  post_op_care: 'Post-Op Care',
  long_term_followup: 'Long Term Follow-up',
};

// Valid stage transitions (shared between API route + slash commands)
export const VALID_STAGE_TRANSITIONS: Record<PatientStage, PatientStage[]> = {
  opd: ['pre_admission', 'admitted'],
  pre_admission: ['admitted', 'opd'],
  admitted: ['pre_op', 'medical_management', 'discharge'],
  medical_management: ['discharge', 'admitted'],
  pre_op: ['surgery', 'admitted'],
  surgery: ['post_op'],
  post_op: ['discharge', 'surgery'],
  discharge: ['post_discharge', 'post_op_care', 'long_term_followup', 'admitted'],
  post_discharge: [],
  post_op_care: ['discharge'],
  long_term_followup: ['discharge'],
};

export const PATIENT_STAGE_COLORS: Record<PatientStage, string> = {
  opd: '#6B7280',
  pre_admission: '#8B5CF6',
  admitted: '#0055FF',
  pre_op: '#F97316',
  surgery: '#EF4444',
  post_op: '#F97316',
  discharge: '#22C55E',
  post_discharge: '#6B7280',
  medical_management: '#0D9488',
  post_op_care: '#7C3AED',
  long_term_followup: '#6366F1',
};

// ============================================
// PAC STATUS
// ============================================

export type PacStatus =
  | 'telemed_pac_pending'
  | 'inpatient_pac_pending'
  | 'telemed_pac_passed'
  | 'inpatient_pac_passed';

export const PAC_STATUS_LABELS: Record<PacStatus, string> = {
  telemed_pac_pending: 'TeleMed PAC Pending',
  inpatient_pac_pending: 'In-Patient PAC Pending',
  telemed_pac_passed: 'TeleMed PAC Passed',
  inpatient_pac_passed: 'In-Patient PAC Passed',
};

export const PAC_STATUS_COLORS: Record<PacStatus, { bg: string; text: string }> = {
  telemed_pac_pending: { bg: 'bg-amber-100', text: 'text-amber-700' },
  inpatient_pac_pending: { bg: 'bg-orange-100', text: 'text-orange-700' },
  telemed_pac_passed: { bg: 'bg-green-100', text: 'text-green-700' },
  inpatient_pac_passed: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

// Stages where PAC status / PAC workspace is relevant.
// 1 May 2026 (sub-sprint A): expanded to all stages from intake onward.
// V's mental model — every patient not yet in surgery is "pre-op" and may
// need PAC. Modules should be available from the moment a patient enters
// Rounds, not gated to a discrete pre_op journey stage.
// Surgery and beyond are kept so historical PAC records still render.
export const PAC_RELEVANT_STAGES: PatientStage[] = [
  'opd', 'pre_admission', 'admitted', 'medical_management',
  'pre_op', 'surgery', 'post_op', 'post_op_care',
  'discharge', 'post_discharge', 'long_term_followup',
];

// ============================================
// CHANGELOG
// ============================================

export type ChangelogType = 'stage_change' | 'field_edit' | 'pac_status_change' | 'form_submission';

export interface PatientChangelogEntry {
  id: string;
  patient_thread_id: string;
  change_type: ChangelogType;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  old_display: string | null;
  new_display: string | null;
  changed_by: string;
  changed_by_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface PatientThread {
  id: string;
  patient_name: string;
  uhid: string | null;
  ip_number: string | null;
  getstream_channel_id: string;
  current_stage: PatientStage;
  lead_source: string | null;
  primary_consultant_id: string | null;
  primary_consultant_name?: string;
  department_id: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// READINESS SYSTEM
// ============================================

export type ReadinessStatus = 'pending' | 'confirmed' | 'flagged' | 'not_applicable';

export const READINESS_ICONS: Record<ReadinessStatus, string> = {
  pending: '⏳',
  confirmed: '✅',
  flagged: '❌',
  not_applicable: '➖',
};

export const READINESS_COLORS: Record<ReadinessStatus, string> = {
  pending: '#F97316',
  confirmed: '#22C55E',
  flagged: '#EF4444',
  not_applicable: '#D1D5DB',
};

export interface ReadinessItem {
  id: string;
  form_submission_id: string;
  item_name: string;
  item_category: string;
  responsible_role: string;
  responsible_user_id: string | null;
  responsible_user_name?: string;
  status: ReadinessStatus;
  confirmed_by: string | null;
  confirmed_by_name?: string;
  confirmed_at: string | null;
  notes: string | null;
  due_by: string | null;
  escalated: boolean;
  escalation_level: number;
  created_at: string;
}

export interface ReadinessAggregate {
  total: number;
  confirmed: number;
  pending: number;
  flagged: number;
  not_applicable: number;
  percentage: number;
}

// ============================================
// ESCALATION
// ============================================

export type EscalationSourceType = 'message' | 'readiness_item' | 'form_gap' | 'sla_breach';

export interface EscalationLogEntry {
  id: string;
  source_type: EscalationSourceType | 'manual';
  source_id: string;
  escalated_from: string | null;
  escalated_from_name?: string;
  escalated_to: string | null;
  escalated_to_name?: string;
  patient_thread_id: string | null;
  patient_name?: string;
  getstream_channel_id: string | null;
  getstream_message_id: string | null;
  reason: string;
  level: number;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

// ============================================
// ADMISSION TRACKER
// ============================================

export type RoomCategory = 'general' | 'semi_private' | 'private' | 'suite' | 'icu' | 'nicu';
export type FinancialCategory = 'cash' | 'insurance' | 'credit';
export type DepositStatus = 'pending' | 'partial' | 'collected' | 'waived';
export type PreAuthStatus = 'not_required' | 'pending' | 'approved' | 'denied' | 'extension_pending';
export type SurgeryReadiness = 'not_started' | 'in_progress' | 'ready' | 'blocked';
export type PatientStatus = 'admitted' | 'pre_op' | 'in_surgery' | 'post_op' | 'discharge_planned' | 'discharged';
export type DischargeType = 'normal' | 'dama' | 'lama' | 'transfer' | 'death';

export const PATIENT_STATUS_LABELS: Record<PatientStatus, string> = {
  admitted: 'Admitted',
  pre_op: 'Pre-Op',
  in_surgery: 'In Surgery',
  post_op: 'Post-Op',
  discharge_planned: 'Discharge Planned',
  discharged: 'Discharged',
};

export const PATIENT_STATUS_COLORS: Record<PatientStatus, string> = {
  admitted: '#0055FF',
  pre_op: '#F97316',
  in_surgery: '#EF4444',
  post_op: '#8B5CF6',
  discharge_planned: '#22C55E',
  discharged: '#6B7280',
};

export const SURGERY_READINESS_LABELS: Record<SurgeryReadiness, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  ready: 'Ready',
  blocked: 'Blocked',
};

export const SURGERY_READINESS_COLORS: Record<SurgeryReadiness, string> = {
  not_started: '#6B7280',
  in_progress: '#F97316',
  ready: '#22C55E',
  blocked: '#EF4444',
};

export interface AdmissionTrackerEntry {
  id: string;
  patient_thread_id: string | null;
  patient_name: string;
  uhid: string;
  ip_number: string;
  even_member_id: string | null;
  admission_date: string;
  admitted_by: string | null;
  // Clinical
  primary_surgeon: string | null;
  primary_surgeon_id: string | null;
  surgery_name: string | null;
  planned_surgery_date: string | null;
  actual_surgery_date: string | null;
  // Room
  room_number: string | null;
  bed_number: string | null;
  room_category: RoomCategory;
  // Financial
  financial_category: FinancialCategory;
  package_name: string | null;
  estimated_cost: number | null;
  deposit_status: DepositStatus;
  deposit_amount: number | null;
  deposit_collected_at: string | null;
  // Insurance
  pre_auth_status: PreAuthStatus;
  pre_auth_amount: number | null;
  tpa_name: string | null;
  policy_number: string | null;
  // Clearances
  financial_counselling_complete: boolean;
  ot_clearance_complete: boolean;
  pac_complete: boolean;
  physician_clearance_required: boolean;
  physician_clearance_done: boolean;
  cardiologist_clearance_required: boolean;
  cardiologist_clearance_done: boolean;
  // Status
  surgery_readiness: SurgeryReadiness;
  current_status: PatientStatus;
  // Discharge
  discharge_order_at: string | null;
  discharge_completed_at: string | null;
  discharge_tat_minutes: number | null;
  discharge_type: DischargeType | null;
  // Coordination
  ip_coordinator_id: string | null;
  ip_coordinator_name?: string;
  // Billing integration
  insurance_claim_id: string | null;
  insurer_name: string | null;
  submission_channel: SubmissionChannel | null;
  sum_insured: number | null;
  room_rent_eligibility: number | null;
  proportional_deduction_risk: number | null;
  running_bill_amount: number | null;
  cumulative_approved_amount: number | null;
  enhancement_alert_threshold: number | null;
  // Joined fields
  getstream_channel_id?: string;
  // Metadata
  created_at: string;
  updated_at: string;
}

// ============================================
// BILLING & INSURANCE CLAIMS
// ============================================

export type ClaimStatus =
  | 'counseling'
  | 'pre_auth_pending'
  | 'pre_auth_queried'
  | 'pre_auth_approved'
  | 'pre_auth_denied'
  | 'enhancement_pending'
  | 'active'
  | 'final_submitted'
  | 'final_queried'
  | 'settled'
  | 'rejected'
  | 'disputed';

export type ClaimPreAuthStatus =
  | 'not_started'
  | 'submitted'
  | 'queried'
  | 'approved'
  | 'denied'
  | 'partial';

export type SubmissionChannel = 'tpa' | 'direct';

export type ClaimEventType =
  | 'pre_auth_submitted' | 'pre_auth_queried' | 'pre_auth_query_responded'
  | 'pre_auth_approved' | 'pre_auth_denied' | 'pre_auth_partial'
  | 'enhancement_triggered' | 'enhancement_doctor_notified'
  | 'enhancement_case_summary_submitted'
  | 'enhancement_submitted' | 'enhancement_approved' | 'enhancement_denied'
  | 'final_bill_prepared' | 'final_submitted' | 'final_queried'
  | 'final_query_responded' | 'final_approved' | 'final_rejected'
  | 'dispute_initiated' | 'dispute_resolved'
  | 'counseling_completed' | 'room_change'
  | 'follow_up_needed' | 'follow_up_completed'
  | 'note_added' | 'document_uploaded';

export type DischargeMilestoneStep =
  | 'discharge_ordered'
  | 'pharmacy_clearance'
  | 'lab_clearance'
  | 'discharge_summary'
  | 'billing_closure'
  | 'final_bill_submitted'
  | 'final_approval'
  | 'patient_settled'
  | 'patient_departed';

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  counseling: 'Financial Counseling',
  pre_auth_pending: 'Pre-Auth Pending',
  pre_auth_queried: 'Pre-Auth Queried',
  pre_auth_approved: 'Pre-Auth Approved',
  pre_auth_denied: 'Pre-Auth Denied',
  enhancement_pending: 'Enhancement Pending',
  active: 'Active (In Treatment)',
  final_submitted: 'Final Bill Submitted',
  final_queried: 'Final Bill Queried',
  settled: 'Settled',
  rejected: 'Rejected',
  disputed: 'Disputed',
};

export const CLAIM_STATUS_COLORS: Record<ClaimStatus, string> = {
  counseling: '#6B7280',
  pre_auth_pending: '#F97316',
  pre_auth_queried: '#EAB308',
  pre_auth_approved: '#22C55E',
  pre_auth_denied: '#EF4444',
  enhancement_pending: '#F97316',
  active: '#0055FF',
  final_submitted: '#8B5CF6',
  final_queried: '#EAB308',
  settled: '#22C55E',
  rejected: '#EF4444',
  disputed: '#DC2626',
};

export const CLAIM_EVENT_LABELS: Record<ClaimEventType, string> = {
  pre_auth_submitted: 'Pre-Auth Submitted',
  pre_auth_queried: 'Insurer Query',
  pre_auth_query_responded: 'Query Responded',
  pre_auth_approved: 'Pre-Auth Approved',
  pre_auth_denied: 'Pre-Auth Denied',
  pre_auth_partial: 'Partial Approval',
  enhancement_triggered: 'Enhancement Needed',
  enhancement_doctor_notified: 'Doctor Notified',
  enhancement_case_summary_submitted: 'Case Summary Submitted',
  enhancement_submitted: 'Enhancement Submitted',
  enhancement_approved: 'Enhancement Approved',
  enhancement_denied: 'Enhancement Denied',
  final_bill_prepared: 'Final Bill Prepared',
  final_submitted: 'Final Bill Submitted',
  final_queried: 'Final Bill Queried',
  final_query_responded: 'Query Responded',
  final_approved: 'Final Approval',
  final_rejected: 'Final Rejected',
  dispute_initiated: 'Dispute Initiated',
  dispute_resolved: 'Dispute Resolved',
  counseling_completed: 'Counseling Complete',
  room_change: 'Room Changed',
  follow_up_needed: 'Follow-Up Needed',
  follow_up_completed: 'Follow-Up Done',
  note_added: 'Note Added',
  document_uploaded: 'Document Uploaded',
};

export const CLAIM_EVENT_COLORS: Record<string, string> = {
  // Green — approvals
  pre_auth_approved: '#22C55E',
  enhancement_approved: '#22C55E',
  final_approved: '#22C55E',
  dispute_resolved: '#22C55E',
  counseling_completed: '#22C55E',
  // Amber — pending/queries
  pre_auth_submitted: '#F97316',
  pre_auth_queried: '#EAB308',
  pre_auth_query_responded: '#F97316',
  enhancement_triggered: '#EAB308',
  enhancement_doctor_notified: '#F97316',
  enhancement_submitted: '#F97316',
  final_submitted: '#8B5CF6',
  final_queried: '#EAB308',
  final_query_responded: '#F97316',
  follow_up_needed: '#EAB308',
  follow_up_completed: '#6B7280',
  // Red — denials/rejections
  pre_auth_denied: '#EF4444',
  pre_auth_partial: '#F97316',
  enhancement_denied: '#EF4444',
  final_rejected: '#EF4444',
  dispute_initiated: '#DC2626',
  // Neutral
  enhancement_case_summary_submitted: '#0055FF',
  final_bill_prepared: '#0055FF',
  room_change: '#6B7280',
  note_added: '#6B7280',
  document_uploaded: '#6B7280',
};

export const DISCHARGE_MILESTONE_LABELS: Record<DischargeMilestoneStep, string> = {
  discharge_ordered: 'Discharge Ordered',
  pharmacy_clearance: 'Pharmacy Cleared',
  lab_clearance: 'Lab Cleared',
  discharge_summary: 'Summary Finalized',
  billing_closure: 'Billing Closed',
  final_bill_submitted: 'Submitted to Insurer',
  final_approval: 'Insurer Approved',
  patient_settled: 'Patient Settled',
  patient_departed: 'Patient Departed',
};

export const DISCHARGE_MILESTONE_ORDER: DischargeMilestoneStep[] = [
  'discharge_ordered',
  'pharmacy_clearance',
  'lab_clearance',
  'discharge_summary',
  'billing_closure',
  'final_bill_submitted',
  'final_approval',
  'patient_settled',
  'patient_departed',
];

// Room rent eligibility constants (industry standard)
export const ROOM_RENT_ELIGIBILITY_PCT = {
  standard: 0.01,  // 1% of sum insured
  icu: 0.015,      // 1.5% of sum insured
};

// Enhancement alert threshold (default ₹50,000)
export const DEFAULT_ENHANCEMENT_THRESHOLD = 50000;

// IRDA-mandated TATs (in minutes)
export const IRDA_TAT = {
  pre_auth: 480,      // 8 hours
  final_approval: 240, // 4 hours
  follow_up_alert: 180, // 3 hours — Mohan's rule: call if no response
};

export interface InsuranceClaim {
  id: string;
  patient_thread_id: string;
  admission_tracker_id: string | null;
  // Insurance identity
  insurer_name: string | null;
  tpa_name: string | null;
  submission_channel: SubmissionChannel;
  portal_used: string | null;
  policy_number: string | null;
  claim_number: string | null;
  patient_card_photo_url: string | null;
  // Financial counseling snapshot
  sum_insured: number | null;
  room_rent_eligibility: number | null;
  room_category_selected: RoomCategory | null;
  actual_room_rent: number | null;
  proportional_deduction_pct: number | null;
  co_pay_pct: number | null;
  has_room_rent_waiver: boolean;
  // Pre-auth
  estimated_cost: number | null;
  pre_auth_submitted_at: string | null;
  pre_auth_approved_at: string | null;
  pre_auth_amount: number | null;
  pre_auth_status: ClaimPreAuthStatus;
  pre_auth_tat_minutes: number | null;
  // Enhancement
  total_enhancements: number;
  latest_enhancement_amount: number | null;
  cumulative_approved_amount: number | null;
  // Final settlement
  final_bill_amount: number | null;
  final_submitted_at: string | null;
  final_approved_at: string | null;
  final_approved_amount: number | null;
  final_settlement_tat_minutes: number | null;
  hospital_discount: number | null;
  non_payable_deductions: number | null;
  patient_liability: number | null;
  // Status
  claim_status: ClaimStatus;
  // Revenue recovery
  recovery_rate: number | null;
  revenue_leakage: number | null;
  leakage_reason: string | null;
  // Metadata
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaimEvent {
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

export interface DischargeMilestone {
  id: string;
  patient_thread_id: string;
  admission_tracker_id: string | null;
  insurance_claim_id: string | null;
  // Milestone chain
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
  // Calculated TATs
  tat_order_to_pharmacy: number | null;
  tat_order_to_summary: number | null;
  tat_summary_to_billing: number | null;
  tat_billing_to_submission: number | null;
  tat_submission_to_approval: number | null;
  tat_order_to_departure: number | null;
  // Status
  is_complete: boolean;
  is_cancelled: boolean;
  cancellation_reason: string | null;
  // Bottleneck
  bottleneck_step: DischargeMilestoneStep | null;
  bottleneck_minutes: number | null;
  // Metadata
  created_at: string;
  updated_at: string;
}

// ============================================
// DUTY ROSTER
// ============================================

export type ShiftType = 'day' | 'evening' | 'night' | 'on_call' | 'visiting';

export const SHIFT_TYPE_LABELS: Record<ShiftType, string> = {
  day: 'Day',
  evening: 'Evening',
  night: 'Night',
  on_call: 'On Call',
  visiting: 'Visiting',
};

export const DAY_LABELS: Record<number, string> = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
};

export interface DutyRosterEntry {
  id: string;
  user_id: string;
  user_name?: string;
  department_id: string;
  department_name?: string;
  role: string;
  shift_type: ShiftType;
  day_of_week: number[]; // 0=Sunday ... 6=Saturday
  shift_start_time: string | null; // HH:MM format
  shift_end_time: string | null;   // HH:MM format
  effective_from: string;
  effective_to: string | null;
  is_override: boolean;
  override_reason: string | null;
  override_date: string | null;    // specific date for one-off overrides
  created_by: string;
  created_at: string;
}

// ============================================
// WORKFLOW CASCADE
// ============================================

export type CascadePriority = 'critical' | 'high' | 'normal';

export interface CascadeTarget {
  id: string;
  channel_target: {
    type: 'named' | 'department' | 'patient_thread' | 'dm';
    channel_id?: string;
    department_id?: string;
    patient_thread_id?: string;
    user_id?: string;
  };
  user_target: {
    type: 'specific' | 'role_in_department' | 'on_duty' | 'form_field' | 'channel_members';
    user_id?: string;
    role?: string;
    department?: string;
    field?: string;
  };
  message_template: string;
  attached_form?: FormType;
  sla_hours?: number;
  sla_escalation_to?: string;
  condition?: string;
  priority: CascadePriority;
}

export interface CascadeDefinition {
  trigger_form: FormType;
  cascades: CascadeTarget[];
}

// ============================================
// LEGACY v4 TYPES (kept for backward compatibility)
// These map to tables that still exist in DB but are
// no longer used for messaging (GetStream handles that).
// ============================================

export type ConversationType = 'group' | 'dm';

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  description: string | null;
  department_id: string | null;
  created_by: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name?: string;
  message_type: MessageType;
  priority: MessagePriority;
  content: string;
  parent_message_id: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  profile_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  last_read_at: string | null;
}

// ============================================
// UTILITY TYPES
// ============================================

export interface CSVImportRow {
  email: string;
  full_name: string;
  department: string;
  role?: string;
  designation?: string;
  phone?: string;
}

export interface CSVImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; email: string; error: string }[];
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface GuestInvitation {
  id: string;
  email: string;
  invited_by: string;
  role: UserRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

// ============================================
// OT SURGERY READINESS
// ============================================

export type ProcedureSide = 'Left' | 'Right' | 'Bilateral' | 'N/A' | 'Midline';
export type CaseType = 'Elective' | 'Emergency' | 'Day Care';
export type WoundClass = 'Clean' | 'Clean-Contaminated' | 'Dirty' | 'Infected';
export type CaseComplexity = 'Minor' | 'Moderate' | 'Major' | 'Super-Major';
export type AnaesthesiaType = 'GA' | 'SA' | 'Regional' | 'LA' | 'Block' | 'Sedation';
export type PostOpDestination = 'PACU' | 'ICU' | 'Ward';

export type SurgeryPostingStatus = 'posted' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'postponed';
export type OverallReadiness = 'not_ready' | 'partial' | 'ready' | 'blocked';
export type OTReadinessItemStatus = 'pending' | 'confirmed' | 'not_applicable' | 'flagged' | 'blocked';
export type OTReadinessCategory = 'clinical' | 'financial' | 'logistics' | 'nursing' | 'team' | 'specialist_clearance' | 'equipment';
export type OTEquipmentType = 'implant' | 'rental_equipment' | 'special_instrument' | 'consumable';
export type OTEquipmentStatus = 'requested' | 'vendor_confirmed' | 'in_transit' | 'delivered' | 'in_ot' | 'verified' | 'returned';
export type OTAuditAction = 'created' | 'confirmed' | 'flagged' | 'blocked' | 'escalated' | 'reset' | 'marked_na' | 'added' | 'bulk_confirmed';
export type PostedVia = 'wizard' | 'slash_command' | 'api' | 'migration';

export interface SurgeryPosting {
  id: string;
  patient_name: string;
  patient_thread_id: string | null;
  uhid: string | null;
  ip_number: string | null;
  age: number | null;
  gender: string | null;
  procedure_name: string;
  procedure_side: ProcedureSide;
  case_type: CaseType;
  wound_class: WoundClass | null;
  case_complexity: CaseComplexity | null;
  estimated_duration_minutes: number | null;
  anaesthesia_type: AnaesthesiaType | null;
  implant_required: boolean;
  blood_required: boolean;
  is_insured: boolean;
  asa_score: number | null;
  asa_confirmed_by: string | null;
  asa_confirmed_at: string | null;
  pac_notes: string | null;
  is_high_risk: boolean;
  primary_surgeon_name: string;
  primary_surgeon_id: string | null;
  assistant_surgeon_name: string | null;
  anaesthesiologist_name: string;
  anaesthesiologist_id: string | null;
  scrub_nurse_name: string | null;
  circulating_nurse_name: string | null;
  ot_technician_name: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  ot_room: number;
  slot_order: number | null;
  post_op_destination: PostOpDestination;
  icu_bed_required: boolean;
  overall_readiness: OverallReadiness;
  status: SurgeryPostingStatus;
  cancellation_reason: string | null;
  postponed_to: string | null;
  posted_by: string;
  posted_via: PostedVia;
  getstream_message_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OTReadinessItem {
  id: string;
  surgery_posting_id: string;
  item_key: string;
  item_label: string;
  item_category: OTReadinessCategory;
  sort_order: number;
  is_dynamic: boolean;
  responsible_role: string;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  status: OTReadinessItemStatus;
  status_detail: string | null;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  confirmation_notes: string | null;
  asa_score_given: number | null;
  due_by: string | null;
  escalated: boolean;
  escalated_at: string | null;
  escalated_to: string | null;
  escalation_level: number;
  created_at: string;
  updated_at: string;
}

export interface OTReadinessAuditLog {
  id: string;
  readiness_item_id: string;
  surgery_posting_id: string;
  action: OTAuditAction;
  old_status: string | null;
  new_status: string | null;
  detail: string | null;
  performed_by: string;
  performed_by_name: string | null;
  performed_at: string;
}

export interface OTEquipmentItem {
  id: string;
  surgery_posting_id: string;
  readiness_item_id: string | null;
  item_type: OTEquipmentType;
  item_name: string;
  item_description: string | null;
  quantity: number;
  vendor_name: string | null;
  vendor_contact: string | null;
  is_rental: boolean;
  rental_cost_estimate: number | null;
  status: OTEquipmentStatus;
  delivery_eta: string | null;
  delivered_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  status_notes: string | null;
  created_at: string;
  updated_at: string;
}

// OT Labels & Colors
export const SURGERY_STATUS_LABELS: Record<SurgeryPostingStatus, string> = {
  posted: 'Posted', confirmed: 'Confirmed', in_progress: 'In Progress',
  completed: 'Completed', cancelled: 'Cancelled', postponed: 'Postponed',
};
export const SURGERY_STATUS_COLORS: Record<SurgeryPostingStatus, string> = {
  posted: 'bg-blue-100 text-blue-800', confirmed: 'bg-green-100 text-green-800',
  in_progress: 'bg-yellow-100 text-yellow-800', completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800', postponed: 'bg-orange-100 text-orange-800',
};
export const READINESS_STATUS_LABELS: Record<OverallReadiness, string> = {
  not_ready: 'Not Ready', partial: 'Partial', ready: 'Ready', blocked: 'Blocked',
};
export const READINESS_STATUS_COLORS: Record<OverallReadiness, string> = {
  not_ready: 'bg-red-100 text-red-800', partial: 'bg-orange-100 text-orange-800',
  ready: 'bg-green-100 text-green-800', blocked: 'bg-red-200 text-red-900',
};
export const READINESS_STATUS_DOT_COLORS: Record<OverallReadiness, string> = {
  not_ready: '#ef4444', partial: '#f59e0b', ready: '#22c55e', blocked: '#dc2626',
};
export const OT_ITEM_STATUS_LABELS: Record<OTReadinessItemStatus, string> = {
  pending: 'Pending', confirmed: 'Confirmed', not_applicable: 'N/A',
  flagged: 'Flagged', blocked: 'Blocked',
};
export const OT_ITEM_STATUS_COLORS: Record<OTReadinessItemStatus, string> = {
  pending: 'text-gray-500', confirmed: 'text-green-600',
  not_applicable: 'text-gray-400', flagged: 'text-orange-600', blocked: 'text-red-600',
};
export const OT_ITEM_STATUS_ICONS: Record<OTReadinessItemStatus, string> = {
  pending: '⏳', confirmed: '✅', not_applicable: '➖', flagged: '🚫', blocked: '🔴',
};
export const OT_CATEGORY_LABELS: Record<OTReadinessCategory, string> = {
  clinical: 'Clinical', financial: 'Financial', logistics: 'Logistics',
  nursing: 'Nursing', team: 'Team', specialist_clearance: 'Specialist Clearances',
  equipment: 'Equipment',
};
export const OT_EQUIPMENT_STATUS_LABELS: Record<OTEquipmentStatus, string> = {
  requested: 'Requested', vendor_confirmed: 'Vendor Confirmed', in_transit: 'In Transit',
  delivered: 'Delivered', in_ot: 'In OT', verified: 'Verified', returned: 'Returned',
};
export const OT_EQUIPMENT_STATUS_COLORS: Record<OTEquipmentStatus, string> = {
  requested: 'text-gray-500', vendor_confirmed: 'text-blue-600', in_transit: 'text-yellow-600',
  delivered: 'text-green-600', in_ot: 'text-green-700', verified: 'text-green-800', returned: 'text-gray-400',
};
// Simplified status for non-SCM roles
export const OT_EQUIPMENT_SIMPLE_STATUS: Record<OTEquipmentStatus, { label: string; color: string }> = {
  requested: { label: 'Pending', color: '🔴' },
  vendor_confirmed: { label: 'In Progress', color: '🟡' },
  in_transit: { label: 'In Transit', color: '🟡' },
  delivered: { label: 'Available', color: '🟢' },
  in_ot: { label: 'Available', color: '🟢' },
  verified: { label: 'Available', color: '🟢' },
  returned: { label: 'Returned', color: '⚪' },
};
export const WOUND_CLASS_LABELS: Record<WoundClass, string> = {
  Clean: 'Clean', 'Clean-Contaminated': 'Clean-Contaminated', Dirty: 'Dirty', Infected: 'Infected',
};
export const ANAESTHESIA_TYPE_LABELS: Record<AnaesthesiaType, string> = {
  GA: 'General', SA: 'Spinal', Regional: 'Regional', LA: 'Local', Block: 'Block', Sedation: 'Sedation',
};
