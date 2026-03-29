// ============================================
// Rounds — Type Definitions (v5.0)
// Updated: 29 March 2026
// ============================================

// ============================================
// ROLES & AUTH
// ============================================

export type UserRole =
  | 'super_admin'
  | 'department_head'
  | 'staff'
  | 'ip_coordinator'
  | 'anesthesiologist'
  | 'ot_coordinator'
  | 'nurse'
  | 'billing_executive'
  | 'insurance_coordinator'
  | 'pharmacist'
  | 'physiotherapist'
  | 'marketing_executive'
  | 'clinical_care'
  | 'pac_coordinator'
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
  | 'marketing_cc_handoff'
  | 'admission_advice'
  | 'financial_counseling'
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
  | 'post_discharge';

export const PATIENT_STAGE_LABELS: Record<PatientStage, string> = {
  opd: 'OPD',
  pre_admission: 'Pre-Admission',
  admitted: 'Admitted',
  pre_op: 'Pre-Op',
  surgery: 'Surgery',
  post_op: 'Post-Op',
  discharge: 'Discharge',
  post_discharge: 'Post-Discharge',
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
};

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
  source_type: EscalationSourceType;
  source_id: string;
  escalated_from: string;
  escalated_from_name?: string;
  escalated_to: string;
  escalated_to_name?: string;
  reason: string;
  level: number;
  created_at: string;
}

// ============================================
// ADMISSION TRACKER
// ============================================

export type RoomCategory = 'general' | 'semi_private' | 'private' | 'suite';
export type FinancialCategory = 'cash' | 'insurance' | 'credit';
export type DepositStatus = 'pending' | 'collected' | 'waived';
export type PreAuthStatus = 'not_required' | 'pending' | 'approved' | 'denied';
export type SurgeryReadiness = 'not_started' | 'in_progress' | 'ready' | 'blocked';
export type PatientStatus = 'admitted' | 'pre_op' | 'in_surgery' | 'post_op' | 'discharged';

export interface AdmissionTrackerEntry {
  id: string;
  patient_thread_id: string;
  patient_name: string;
  uhid: string;
  ip_number: string;
  admission_date: string;
  planned_surgery_date: string | null;
  surgery_name: string | null;
  primary_surgeon: string;
  package_name: string | null;
  room_number: string | null;
  room_category: RoomCategory;
  financial_category: FinancialCategory;
  deposit_status: DepositStatus;
  deposit_amount: number | null;
  pre_auth_status: PreAuthStatus;
  surgery_readiness: SurgeryReadiness;
  current_status: PatientStatus;
  discharge_date: string | null;
  discharge_tat_minutes: number | null;
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
