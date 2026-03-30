// ============================================
// Rounds — Database Helpers for v5 Tables
// CRUD operations for: patient_threads,
// form_submissions, readiness_items,
// escalation_log, admission_tracker,
// duty_roster.
// ============================================

import { sql, query, queryOne } from './db';
import type {
  PatientStage,
  FormType,
  FormStatus,
  ReadinessStatus,
  EscalationSourceType,
} from '@/types';

// ============================================
// PATIENT THREADS
// ============================================

export interface CreatePatientThreadInput {
  patient_name: string;
  uhid?: string;
  ip_number?: string;
  even_member_id?: string;
  getstream_channel_id?: string;
  current_stage?: PatientStage;
  lead_source?: string;
  primary_consultant_id?: string;
  primary_diagnosis?: string;
  planned_procedure?: string;
  department_id?: string;
  admission_date?: string;
  planned_surgery_date?: string;
  created_by: string;
}

export async function createPatientThread(input: CreatePatientThreadInput) {
  const rows = await query<{ id: string }>(
    `INSERT INTO patient_threads (
      patient_name, uhid, ip_number, even_member_id, getstream_channel_id,
      current_stage, lead_source, primary_consultant_id, primary_diagnosis,
      planned_procedure, department_id, admission_date, planned_surgery_date, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING id`,
    [
      input.patient_name,
      input.uhid || null,
      input.ip_number || null,
      input.even_member_id || null,
      input.getstream_channel_id || null,
      input.current_stage || 'opd',
      input.lead_source || null,
      input.primary_consultant_id || null,
      input.primary_diagnosis || null,
      input.planned_procedure || null,
      input.department_id || null,
      input.admission_date || null,
      input.planned_surgery_date || null,
      input.created_by,
    ]
  );
  return rows[0];
}

export async function getPatientThread(id: string) {
  return queryOne(
    `SELECT pt.*, p.full_name as primary_consultant_name, d.name as department_name
     FROM patient_threads pt
     LEFT JOIN profiles p ON pt.primary_consultant_id = p.id
     LEFT JOIN departments d ON pt.department_id = d.id
     WHERE pt.id = $1`,
    [id]
  );
}

export async function listPatientThreads(filters?: {
  stage?: PatientStage;
  department_id?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.stage) {
    conditions.push(`pt.current_stage = $${paramIndex++}`);
    params.push(filters.stage);
  }
  if (filters?.department_id) {
    conditions.push(`pt.department_id = $${paramIndex++}`);
    params.push(filters.department_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  return query(
    `SELECT pt.*, p.full_name as primary_consultant_name, d.name as department_name,
            at.bed_number, at.room_number, at.room_category, at.financial_category
     FROM patient_threads pt
     LEFT JOIN profiles p ON pt.primary_consultant_id = p.id
     LEFT JOIN departments d ON pt.department_id = d.id
     LEFT JOIN admission_tracker at ON at.patient_thread_id = pt.id
     ${where}
     ORDER BY pt.updated_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );
}

export async function updatePatientThread(
  id: string,
  updates: Partial<{
    current_stage: PatientStage;
    uhid: string;
    ip_number: string;
    getstream_channel_id: string;
    admission_date: string;
    discharge_date: string;
    planned_surgery_date: string;
    primary_diagnosis: string;
    planned_procedure: string;
    primary_consultant_id: string;
  }>
) {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIndex++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return null;

  params.push(id);
  return queryOne(
    `UPDATE patient_threads SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
}

// ============================================
// FORM SUBMISSIONS
// ============================================

export interface CreateFormSubmissionInput {
  form_type: FormType;
  form_version?: number;
  patient_thread_id?: string;
  getstream_message_id?: string;
  getstream_channel_id?: string;
  submitted_by: string;
  department_id?: string;
  form_data: Record<string, unknown>;
  completion_score?: number;
  status?: FormStatus;
}

export async function createFormSubmission(input: CreateFormSubmissionInput) {
  const rows = await query<{ id: string }>(
    `INSERT INTO form_submissions (
      form_type, form_version, patient_thread_id, getstream_message_id,
      getstream_channel_id, submitted_by, department_id, form_data,
      completion_score, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id`,
    [
      input.form_type,
      input.form_version || 1,
      input.patient_thread_id || null,
      input.getstream_message_id || null,
      input.getstream_channel_id || null,
      input.submitted_by,
      input.department_id || null,
      JSON.stringify(input.form_data),
      input.completion_score || null,
      input.status || 'submitted',
    ]
  );
  return rows[0];
}

export async function getFormSubmission(id: string) {
  return queryOne(
    `SELECT fs.*, p.full_name as submitted_by_name
     FROM form_submissions fs
     LEFT JOIN profiles p ON fs.submitted_by = p.id
     WHERE fs.id = $1`,
    [id]
  );
}

export async function listFormSubmissions(filters?: {
  form_type?: FormType;
  patient_thread_id?: string;
  submitted_by?: string;
  status?: FormStatus;
  limit?: number;
  offset?: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.form_type) {
    conditions.push(`fs.form_type = $${paramIndex++}`);
    params.push(filters.form_type);
  }
  if (filters?.patient_thread_id) {
    conditions.push(`fs.patient_thread_id = $${paramIndex++}`);
    params.push(filters.patient_thread_id);
  }
  if (filters?.submitted_by) {
    conditions.push(`fs.submitted_by = $${paramIndex++}`);
    params.push(filters.submitted_by);
  }
  if (filters?.status) {
    conditions.push(`fs.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  return query(
    `SELECT fs.*, p.full_name as submitted_by_name
     FROM form_submissions fs
     LEFT JOIN profiles p ON fs.submitted_by = p.id
     ${where}
     ORDER BY fs.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );
}

// ============================================
// READINESS ITEMS
// ============================================

export interface CreateReadinessItemInput {
  form_submission_id: string;
  patient_thread_id?: string;
  item_name: string;
  item_category: string;
  item_description?: string;
  responsible_role?: string;
  responsible_user_id?: string;
  responsible_department_id?: string;
  due_by?: string;
}

export async function createReadinessItem(input: CreateReadinessItemInput) {
  const rows = await query<{ id: string }>(
    `INSERT INTO readiness_items (
      form_submission_id, patient_thread_id, item_name, item_category,
      item_description, responsible_role, responsible_user_id,
      responsible_department_id, due_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id`,
    [
      input.form_submission_id,
      input.patient_thread_id || null,
      input.item_name,
      input.item_category,
      input.item_description || null,
      input.responsible_role || null,
      input.responsible_user_id || null,
      input.responsible_department_id || null,
      input.due_by || null,
    ]
  );
  return rows[0];
}

export async function createReadinessItemsBatch(
  items: CreateReadinessItemInput[]
) {
  const results: { id: string }[] = [];
  for (const item of items) {
    const result = await createReadinessItem(item);
    results.push(result);
  }
  return results;
}

export async function listReadinessItems(formSubmissionId: string) {
  return query(
    `SELECT ri.*, p.full_name as responsible_user_name, cp.full_name as confirmed_by_name
     FROM readiness_items ri
     LEFT JOIN profiles p ON ri.responsible_user_id = p.id
     LEFT JOIN profiles cp ON ri.confirmed_by = cp.id
     WHERE ri.form_submission_id = $1
     ORDER BY ri.item_category, ri.item_name`,
    [formSubmissionId]
  );
}

export async function listReadinessItemsByPatient(patientThreadId: string) {
  return query(
    `SELECT ri.*, p.full_name as responsible_user_name, fs.form_type
     FROM readiness_items ri
     LEFT JOIN profiles p ON ri.responsible_user_id = p.id
     LEFT JOIN form_submissions fs ON ri.form_submission_id = fs.id
     WHERE ri.patient_thread_id = $1
     ORDER BY ri.created_at DESC`,
    [patientThreadId]
  );
}

export async function updateReadinessItem(
  id: string,
  update: {
    status: ReadinessStatus;
    confirmed_by?: string;
    flagged_reason?: string;
    notes?: string;
  }
) {
  return queryOne(
    `UPDATE readiness_items SET
      status = $1,
      confirmed_by = $2,
      confirmed_at = CASE WHEN $1 = 'confirmed' THEN NOW() ELSE confirmed_at END,
      flagged_reason = $3,
      notes = $4
     WHERE id = $5 RETURNING *`,
    [
      update.status,
      update.confirmed_by || null,
      update.flagged_reason || null,
      update.notes || null,
      id,
    ]
  );
}

export async function getReadinessAggregate(formSubmissionId: string) {
  const rows = await query<{
    total: string;
    confirmed: string;
    pending: string;
    flagged: string;
    not_applicable: string;
  }>(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'flagged') as flagged,
      COUNT(*) FILTER (WHERE status = 'not_applicable') as not_applicable
     FROM readiness_items
     WHERE form_submission_id = $1`,
    [formSubmissionId]
  );
  const r = rows[0];
  const total = parseInt(r.total);
  const confirmed = parseInt(r.confirmed);
  return {
    total,
    confirmed,
    pending: parseInt(r.pending),
    flagged: parseInt(r.flagged),
    not_applicable: parseInt(r.not_applicable),
    percentage: total > 0 ? Math.round((confirmed / total) * 100) : 0,
  };
}

// ============================================
// ESCALATION LOG
// ============================================

export interface CreateEscalationInput {
  source_type: EscalationSourceType | 'manual';
  source_id: string;
  escalated_from?: string;
  escalated_to?: string;
  patient_thread_id?: string;
  getstream_channel_id?: string;
  getstream_message_id?: string;
  reason: string;
  level?: number;
}

export async function createEscalation(input: CreateEscalationInput) {
  const rows = await query<{ id: string }>(
    `INSERT INTO escalation_log (
      source_type, source_id, escalated_from, escalated_to,
      patient_thread_id, getstream_channel_id, getstream_message_id,
      reason, level
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id`,
    [
      input.source_type,
      input.source_id,
      input.escalated_from || null,
      input.escalated_to || null,
      input.patient_thread_id || null,
      input.getstream_channel_id || null,
      input.getstream_message_id || null,
      input.reason,
      input.level || 1,
    ]
  );
  return rows[0];
}

export async function resolveEscalation(
  id: string,
  resolvedBy: string,
  resolutionNotes?: string
) {
  return queryOne(
    `UPDATE escalation_log SET
      resolved = true, resolved_by = $1, resolved_at = NOW(), resolution_notes = $2
     WHERE id = $3 RETURNING *`,
    [resolvedBy, resolutionNotes || null, id]
  );
}

export async function listUnresolvedEscalations(limit = 50) {
  return query(
    `SELECT el.*,
       pf.full_name as escalated_from_name,
       pt2.full_name as escalated_to_name
     FROM escalation_log el
     LEFT JOIN profiles pf ON el.escalated_from = pf.id
     LEFT JOIN profiles pt2 ON el.escalated_to = pt2.id
     WHERE el.resolved = false
     ORDER BY el.created_at DESC
     LIMIT $1`,
    [limit]
  );
}

// ============================================
// ADMISSION TRACKER
// ============================================

export interface CreateAdmissionInput {
  patient_thread_id?: string;
  patient_name: string;
  uhid: string;
  ip_number: string;
  even_member_id?: string;
  admission_date: string;
  admitted_by?: string;
  primary_surgeon?: string;
  primary_surgeon_id?: string;
  surgery_name?: string;
  planned_surgery_date?: string;
  room_number?: string;
  bed_number?: string;
  room_category?: string;
  financial_category?: string;
  package_name?: string;
  estimated_cost?: number;
  deposit_status?: string;
  deposit_amount?: number;
  pre_auth_status?: string;
  tpa_name?: string;
  policy_number?: string;
  ip_coordinator_id?: string;
}

export async function createAdmissionTracker(input: CreateAdmissionInput) {
  const rows = await query<{ id: string }>(
    `INSERT INTO admission_tracker (
      patient_thread_id, patient_name, uhid, ip_number, even_member_id,
      admission_date, admitted_by, primary_surgeon, primary_surgeon_id,
      surgery_name, planned_surgery_date, room_number, bed_number,
      room_category, financial_category, package_name, estimated_cost,
      deposit_status, deposit_amount, pre_auth_status, tpa_name,
      policy_number, ip_coordinator_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    RETURNING id`,
    [
      input.patient_thread_id || null,
      input.patient_name,
      input.uhid,
      input.ip_number,
      input.even_member_id || null,
      input.admission_date,
      input.admitted_by || null,
      input.primary_surgeon || null,
      input.primary_surgeon_id || null,
      input.surgery_name || null,
      input.planned_surgery_date || null,
      input.room_number || null,
      input.bed_number || null,
      input.room_category || 'general',
      input.financial_category || 'insurance',
      input.package_name || null,
      input.estimated_cost || null,
      input.deposit_status || 'pending',
      input.deposit_amount || null,
      input.pre_auth_status || 'not_required',
      input.tpa_name || null,
      input.policy_number || null,
      input.ip_coordinator_id || null,
    ]
  );
  return rows[0];
}

export async function listActiveAdmissions() {
  return query(
    `SELECT at2.*,
       pt.getstream_channel_id,
       p.full_name as ip_coordinator_name
     FROM admission_tracker at2
     LEFT JOIN patient_threads pt ON at2.patient_thread_id = pt.id
     LEFT JOIN profiles p ON at2.ip_coordinator_id = p.id
     WHERE at2.current_status != 'discharged'
     ORDER BY at2.admission_date DESC`,
    []
  );
}

export async function getAdmissionByPatientThread(patientThreadId: string) {
  return queryOne(
    `SELECT * FROM admission_tracker WHERE patient_thread_id = $1`,
    [patientThreadId]
  );
}

export async function updateAdmissionTracker(
  id: string,
  updates: Record<string, unknown>
) {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIndex++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return null;

  params.push(id);
  return queryOne(
    `UPDATE admission_tracker SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
}

// ============================================
// DUTY ROSTER
// ============================================

export async function getCurrentOnDuty(
  departmentId: string,
  role: string
): Promise<{ user_id: string; user_name: string } | null> {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sunday
  const currentTime = now.toTimeString().substring(0, 5); // HH:MM

  // First check for overrides today
  const override = await queryOne<{ user_id: string; user_name: string }>(
    `SELECT dr.user_id, p.full_name as user_name
     FROM duty_roster dr
     JOIN profiles p ON dr.user_id = p.id
     WHERE dr.department_id = $1
       AND dr.role = $2
       AND dr.is_override = true
       AND dr.override_date = CURRENT_DATE
     LIMIT 1`,
    [departmentId, role]
  );

  if (override) return override;

  // Then check regular roster
  return queryOne<{ user_id: string; user_name: string }>(
    `SELECT dr.user_id, p.full_name as user_name
     FROM duty_roster dr
     JOIN profiles p ON dr.user_id = p.id
     WHERE dr.department_id = $1
       AND dr.role = $2
       AND dr.is_override = false
       AND $3 = ANY(dr.day_of_week)
       AND dr.effective_from <= CURRENT_DATE
       AND (dr.effective_to IS NULL OR dr.effective_to >= CURRENT_DATE)
       AND (dr.shift_start_time IS NULL OR dr.shift_start_time <= $4::TIME)
       AND (dr.shift_end_time IS NULL OR dr.shift_end_time > $4::TIME)
     ORDER BY dr.effective_from DESC
     LIMIT 1`,
    [departmentId, role, dayOfWeek, currentTime]
  );
}

export async function listDutyRoster(filters?: {
  department_id?: string;
  role?: string;
  active_only?: boolean;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.department_id) {
    conditions.push(`dr.department_id = $${paramIndex++}`);
    params.push(filters.department_id);
  }
  if (filters?.role) {
    conditions.push(`dr.role = $${paramIndex++}`);
    params.push(filters.role);
  }
  if (filters?.active_only) {
    conditions.push(`(dr.effective_to IS NULL OR dr.effective_to >= CURRENT_DATE)`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return query(
    `SELECT dr.*, p.full_name as user_name, d.name as department_name
     FROM duty_roster dr
     LEFT JOIN profiles p ON dr.user_id = p.id
     LEFT JOIN departments d ON dr.department_id = d.id
     ${where}
     ORDER BY dr.department_id, dr.role, dr.shift_type`,
    params
  );
}

export interface CreateDutyRosterInput {
  user_id: string;
  department_id: string;
  role: string;
  shift_type: string;
  day_of_week: number[];
  shift_start_time?: string;
  shift_end_time?: string;
  effective_from: string;
  effective_to?: string;
  is_override?: boolean;
  override_reason?: string;
  override_date?: string;
  created_by: string;
}

export async function createDutyRosterEntry(input: CreateDutyRosterInput) {
  const rows = await query<{ id: string }>(
    `INSERT INTO duty_roster (
      user_id, department_id, role, shift_type, day_of_week,
      shift_start_time, shift_end_time, effective_from, effective_to,
      is_override, override_reason, override_date, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id`,
    [
      input.user_id,
      input.department_id,
      input.role,
      input.shift_type,
      input.day_of_week,
      input.shift_start_time || null,
      input.shift_end_time || null,
      input.effective_from,
      input.effective_to || null,
      input.is_override || false,
      input.override_reason || null,
      input.override_date || null,
      input.created_by,
    ]
  );
  return rows[0];
}

export async function deleteDutyRosterEntry(id: string) {
  return queryOne(`DELETE FROM duty_roster WHERE id = $1 RETURNING id`, [id]);
}

// ============================================
// OVERDUE READINESS ITEMS (for cron escalation)
// ============================================

// ============================================
// STAFF LOOKUP (for patient channel auto-add)
// ============================================

/**
 * Find active profile IDs by role, optionally in a specific department.
 */
export async function findProfilesByRole(
  roles: string[],
  departmentId?: string | null
): Promise<{ id: string; full_name: string; role: string }[]> {
  if (roles.length === 0) return [];

  const placeholders = roles.map((_, i) => `$${i + 1}`).join(',');
  const params: unknown[] = [...roles];
  let deptClause = '';

  if (departmentId) {
    deptClause = ` AND department_id = $${params.length + 1}`;
    params.push(departmentId);
  }

  return query<{ id: string; full_name: string; role: string }>(
    `SELECT id, full_name, role FROM profiles
     WHERE role IN (${placeholders}) AND status = 'active'${deptClause}
     ORDER BY role, full_name`,
    params
  );
}

/**
 * Get department head profile ID for a given department.
 */
export async function getDepartmentHead(departmentId: string): Promise<string | null> {
  const row = await queryOne<{ head_profile_id: string | null }>(
    `SELECT head_profile_id FROM departments WHERE id = $1`,
    [departmentId]
  );
  return row?.head_profile_id || null;
}

export async function getOverdueReadinessItems() {
  return query<{
    id: string;
    item_name: string;
    item_category: string;
    responsible_role: string;
    responsible_user_id: string | null;
    responsible_department_id: string | null;
    status: string;
    due_by: string;
    escalated: boolean;
    escalation_level: number;
    last_escalated_at: string | null;
    patient_thread_id: string | null;
    form_submission_id: string;
    form_type: string;
    patient_name: string | null;
    department_id: string | null;
  }>(
    `SELECT ri.*, fs.form_type, fs.patient_thread_id,
            pt.patient_name, pt.department_id
     FROM readiness_items ri
     JOIN form_submissions fs ON ri.form_submission_id = fs.id
     LEFT JOIN patient_threads pt ON ri.patient_thread_id = pt.id
     WHERE ri.status = 'pending'
       AND ri.due_by IS NOT NULL
       AND ri.due_by < NOW()
     ORDER BY ri.due_by ASC`,
    []
  );
}

/**
 * Mark a readiness item as escalated, incrementing level.
 */
export async function markReadinessItemEscalated(
  itemId: string,
  newLevel: number
) {
  return queryOne(
    `UPDATE readiness_items SET
      escalated = true,
      escalation_level = $1,
      last_escalated_at = NOW()
     WHERE id = $2 RETURNING id`,
    [newLevel, itemId]
  );
}

/**
 * List all escalation log entries with optional filters.
 */
export async function listEscalations(filters?: {
  resolved?: boolean;
  source_type?: string;
  limit?: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.resolved !== undefined) {
    conditions.push(`el.resolved = $${paramIndex++}`);
    params.push(filters.resolved);
  }
  if (filters?.source_type) {
    conditions.push(`el.source_type = $${paramIndex++}`);
    params.push(filters.source_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit || 100;

  params.push(limit);
  return query(
    `SELECT el.*,
       pf.full_name as escalated_from_name,
       pt2.full_name as escalated_to_name,
       pt3.patient_name
     FROM escalation_log el
     LEFT JOIN profiles pf ON el.escalated_from = pf.id
     LEFT JOIN profiles pt2 ON el.escalated_to = pt2.id
     LEFT JOIN patient_threads pt3 ON el.patient_thread_id = pt3.id
     ${where}
     ORDER BY el.created_at DESC
     LIMIT $${paramIndex}`,
    params
  );
}
