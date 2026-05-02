// =============================================================================
// PAC Coordinator Workspace v1 — shared TypeScript types
// =============================================================================

export type PacMode = 'in_person_opd' | 'bedside' | 'telephonic' | 'paper_screening';

export type PacSubState =
  | 'prep_in_progress'
  | 'awaiting_results'
  | 'awaiting_clearance'
  | 'ready_for_anaesthetist'
  | 'anaesthetist_examined'
  | 'published'
  | 'cancelled';

export type PacOrderStatus =
  | 'requested'
  | 'sample_drawn'
  | 'in_lab'
  | 'reported'
  | 'reviewed'
  | 'cancelled';

export type PacClearanceStatus =
  | 'requested'
  | 'specialist_reviewing'
  | 'cleared'
  | 'cleared_with_conditions'
  | 'declined'
  | 'cancelled';

export interface PacChecklistItem {
  id: string;
  label: string;
  state: 'pending' | 'done' | 'na';
  required: boolean;
  gating_condition?: 'day_of_surgery' | null;
  sop_ref?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  ticked_at?: string | null;
  notes?: string | null;
}

export interface PacWorkspaceProgressRow {
  case_id: string;
  hospital_id: string;
  pac_mode: PacMode;
  sub_state: PacSubState;
  checklist_template: string;
  checklist_state: PacChecklistItem[];
  scheduled_pac_at: string | null;
  ipc_owner_id: string | null;
  anaesthetist_id: string | null;
  sla_deadline_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PacOrderRow {
  id: string;
  case_id: string;
  order_type: string;
  order_label: string | null;
  status: PacOrderStatus;
  result_text: string | null;
  result_attached_url: string | null;
  task_id: string | null;
  requested_by: string | null;
  requested_at: string;
  reported_at: string | null;
  reviewed_at: string | null;
  notes: string | null;
  // PCW2.0 columns surfaced through GET in PCW2.5. All optional so the v1
  // path doesn't break when the DB returns NULL for legacy rows.
  kind?: 'order' | 'diagnostic' | null;
  result_value?: Record<string, unknown> | null;
  result_received_at?: string | null;
  done_at?: string | null;
  done_at_source?: 'ehrc' | 'external' | null;
}

export interface PacClearanceRow {
  id: string;
  case_id: string;
  specialty: string;
  specialty_label: string | null;
  status: PacClearanceStatus;
  conditions_text: string | null;
  task_id: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  requested_by: string | null;
  requested_at: string;
  responded_at: string | null;
  notes: string | null;
}

export interface PacWorkspacePatient {
  case_id: string;
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  hospital_slug: string;
  hospital_name: string;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  urgency: string | null;
  case_state: string;
  surgeon_name: string | null;
  anaesthetist_name: string | null;
}

export interface PacPatientContext {
  /** snake_case taxonomy aligned with pac_clearance_specialties.sop_trigger_comorbidities */
  comorbidities: string[];
  /** Free-text allergies as captured on Marketing Handoff form (or null). */
  allergies: string | null;
  /** Free-text current medications. */
  current_medications: string | null;
  /** comorbidities_controlled flag from MH form. */
  comorbidities_controlled: string | null;
  /** Source form_submission id, for audit + 'view source' link. */
  source_form_submission_id: string | null;
  /** ISO timestamp of source form. Null if no MH form found. */
  source_submitted_at: string | null;
}

export interface PacWorkspacePayload {
  patient: PacWorkspacePatient;
  progress: PacWorkspaceProgressRow;
  orders: PacOrderRow[];
  clearances: PacClearanceRow[];
  patient_context: PacPatientContext | null;
  channel_id: string | null;
  generated_at: string;
}

export interface PacChecklistTemplate {
  code: string;
  pac_mode: PacMode;
  items_json: Array<{
    id: string;
    label: string;
    required: boolean;
    gating_condition?: 'day_of_surgery' | null;
    sop_ref?: string | null;
  }>;
}

export const VALID_PAC_MODES: readonly PacMode[] = [
  'in_person_opd',
  'bedside',
  'telephonic',
  'paper_screening',
];

export const PAC_MODE_LABELS: Record<PacMode, string> = {
  in_person_opd: 'In-person OPD PAC',
  bedside: 'Bedside PAC (admitted patient)',
  telephonic: 'Telephonic / video PAC',
  paper_screening: 'Paper / questionnaire screening',
};

export const PAC_MODE_DEFAULT_TEMPLATE: Record<PacMode, string> = {
  in_person_opd: 'in_person_opd_v1',
  bedside: 'bedside_v1',
  telephonic: 'telephonic_v1',
  paper_screening: 'paper_screening_v1',
};
