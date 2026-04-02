// ============================================
// OT Surgery Readiness — Core Business Logic
// Single entry point for all surgery posting mutations
// ============================================

import { neon } from '@neondatabase/serverless';
import type {
  SurgeryPosting, OTReadinessItem, OTEquipmentItem,
  OverallReadiness, OTReadinessItemStatus, OTAuditAction,
} from '@/types';
import { generateReadinessItems } from './readiness-template';
import { computeOverallReadiness } from './readiness-status';
import { getProcedureDefaults } from './procedure-defaults';
import { sendSystemMessage } from '@/lib/getstream';

function getSql() {
  return neon(process.env.POSTGRES_URL!);
}

// ============================================
// CREATE POSTING
// ============================================

interface CreatePostingInput {
  patient_name: string;
  patient_thread_id?: string | null;
  uhid?: string | null;
  ip_number?: string | null;
  age?: number | null;
  gender?: string | null;
  procedure_name: string;
  procedure_side: string;
  case_type?: string;
  wound_class?: string | null;
  case_complexity?: string | null;
  estimated_duration_minutes?: number | null;
  anaesthesia_type?: string | null;
  implant_required?: boolean;
  blood_required?: boolean;
  is_insured?: boolean;
  primary_surgeon_name: string;
  primary_surgeon_id?: string | null;
  assistant_surgeon_name?: string | null;
  anaesthesiologist_name: string;
  anaesthesiologist_id?: string | null;
  scrub_nurse_name?: string | null;
  circulating_nurse_name?: string | null;
  ot_technician_name?: string | null;
  scheduled_date: string;
  scheduled_time?: string | null;
  ot_room: number;
  slot_order?: number | null;
  post_op_destination?: string;
  icu_bed_required?: boolean;
  notes?: string | null;
  posted_by: string;
  posted_via?: string;
}

export async function createSurgeryPosting(input: CreatePostingInput): Promise<{
  posting: SurgeryPosting;
  readinessItems: OTReadinessItem[];
}> {
  const sql = getSql();

  // Apply procedure defaults for any fields not explicitly provided
  const defaults = getProcedureDefaults(input.procedure_name);
  const wound_class = input.wound_class ?? defaults?.wound_class ?? null;
  const anaesthesia_type = input.anaesthesia_type ?? defaults?.anaesthesia_type ?? null;
  const estimated_duration = input.estimated_duration_minutes ?? defaults?.estimated_duration_minutes ?? null;
  const post_op_destination = input.post_op_destination ?? defaults?.post_op_destination ?? 'PACU';
  const implant_required = input.implant_required ?? defaults?.typically_requires_implant ?? false;
  const blood_required = input.blood_required ?? defaults?.typically_requires_blood ?? false;
  const icu_bed_required = input.icu_bed_required ?? (post_op_destination === 'ICU');

  // 1. Insert the posting
  const rows = await sql(`
    INSERT INTO surgery_postings (
      patient_name, patient_thread_id, uhid, ip_number, age, gender,
      procedure_name, procedure_side, case_type, wound_class, case_complexity,
      estimated_duration_minutes, anaesthesia_type,
      implant_required, blood_required, is_insured,
      primary_surgeon_name, primary_surgeon_id, assistant_surgeon_name,
      anaesthesiologist_name, anaesthesiologist_id,
      scrub_nurse_name, circulating_nurse_name, ot_technician_name,
      scheduled_date, scheduled_time, ot_room, slot_order,
      post_op_destination, icu_bed_required,
      notes, posted_by, posted_via
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13,
      $14, $15, $16,
      $17, $18, $19,
      $20, $21,
      $22, $23, $24,
      $25, $26, $27, $28,
      $29, $30,
      $31, $32, $33
    ) RETURNING *
  `, [
    input.patient_name, input.patient_thread_id || null, input.uhid || null,
    input.ip_number || null, input.age || null, input.gender || null,
    input.procedure_name, input.procedure_side, input.case_type || 'Elective',
    wound_class, input.case_complexity || null,
    estimated_duration, anaesthesia_type,
    implant_required, blood_required, input.is_insured || false,
    input.primary_surgeon_name, input.primary_surgeon_id || null, input.assistant_surgeon_name || null,
    input.anaesthesiologist_name, input.anaesthesiologist_id || null,
    input.scrub_nurse_name || null, input.circulating_nurse_name || null, input.ot_technician_name || null,
    input.scheduled_date, input.scheduled_time || null, input.ot_room, input.slot_order || null,
    post_op_destination, icu_bed_required,
    input.notes || null, input.posted_by, input.posted_via || 'wizard',
  ]);

  const posting = rows[0] as SurgeryPosting;

  // 2. Generate readiness items from template
  const templateItems = generateReadinessItems(posting, posting.id);
  const readinessItems: OTReadinessItem[] = [];

  for (const item of templateItems) {
    const itemRows = await sql(`
      INSERT INTO ot_readiness_items (
        surgery_posting_id, item_key, item_label, item_category,
        responsible_role, sort_order, is_dynamic, due_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      item.surgery_posting_id, item.item_key, item.item_label, item.item_category,
      item.responsible_role, item.sort_order, item.is_dynamic, item.due_by,
    ]);
    readinessItems.push(itemRows[0] as OTReadinessItem);

    // Write audit log for creation
    await sql(`
      INSERT INTO ot_readiness_audit_log (readiness_item_id, surgery_posting_id, action, new_status, performed_by, performed_by_name)
      VALUES ($1, $2, 'created', 'pending', $3, NULL)
    `, [itemRows[0].id, posting.id, input.posted_by]);
  }

  // 3. Compute overall readiness
  const overall = computeOverallReadiness(readinessItems);
  if (overall !== 'not_ready') {
    await sql(`UPDATE surgery_postings SET overall_readiness = $1, updated_at = NOW() WHERE id = $2`, [overall, posting.id]);
    posting.overall_readiness = overall;
  }

  // 4. Post system messages (non-fatal)
  try {
    const msg = `🔵 NEW SURGERY POSTED\n${posting.procedure_name} — ${posting.primary_surgeon_name} — OT ${posting.ot_room}\n${posting.scheduled_date}${posting.scheduled_time ? ', ' + posting.scheduled_time : ''} | ${wound_class || 'TBD'} | ${anaesthesia_type || 'TBD'}\nReadiness: 0/${readinessItems.length} items confirmed\nPosted via Rounds`;
    await sendSystemMessage('cross-functional', 'ot-schedule', msg);

    if (posting.patient_thread_id) {
      const ptChannel = await getPatientChannelId(sql, posting.patient_thread_id);
      if (ptChannel) {
        await sendSystemMessage('patient-thread', ptChannel, msg);
      }
    }
  } catch (err) {
    console.error('[OT] System message failed:', err);
  }

  return { posting, readinessItems };
}

// ============================================
// GET POSTING (with items + equipment)
// ============================================

export async function getSurgeryPosting(id: string): Promise<{
  posting: SurgeryPosting;
  readinessItems: OTReadinessItem[];
  equipmentItems: OTEquipmentItem[];
} | null> {
  const sql = getSql();
  const rows = await sql(`SELECT * FROM surgery_postings WHERE id = $1`, [id]);
  if (rows.length === 0) return null;

  const posting = rows[0] as SurgeryPosting;
  const readinessItems = await sql(`SELECT * FROM ot_readiness_items WHERE surgery_posting_id = $1 ORDER BY sort_order`, [id]) as OTReadinessItem[];
  const equipmentItems = await sql(`SELECT * FROM ot_equipment_items WHERE surgery_posting_id = $1 ORDER BY created_at`, [id]) as OTEquipmentItem[];

  return { posting, readinessItems, equipmentItems };
}

// ============================================
// LIST POSTINGS
// ============================================

export async function listSurgeryPostings(filters: {
  date?: string;
  ot_room?: number;
  status?: string;
  surgeon?: string;
  patient_thread_id?: string;
}): Promise<SurgeryPosting[]> {
  const sql = getSql();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let idx = 1;

  if (filters.date) { conditions.push(`scheduled_date = $${idx++}`); params.push(filters.date); }
  if (filters.ot_room) { conditions.push(`ot_room = $${idx++}`); params.push(filters.ot_room); }
  if (filters.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters.surgeon) { conditions.push(`primary_surgeon_name ILIKE $${idx++}`); params.push(`%${filters.surgeon}%`); }
  if (filters.patient_thread_id) { conditions.push(`patient_thread_id = $${idx++}`); params.push(filters.patient_thread_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await sql(`SELECT * FROM surgery_postings ${where} ORDER BY scheduled_date, ot_room, slot_order NULLS LAST, scheduled_time NULLS LAST`, params);
  return rows as SurgeryPosting[];
}

// ============================================
// UPDATE POSTING
// ============================================

export async function updateSurgeryPosting(
  id: string,
  updates: Partial<CreatePostingInput> & { status?: string; cancellation_reason?: string; postponed_to?: string }
): Promise<SurgeryPosting | null> {
  const sql = getSql();

  // Build dynamic SET clause
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  const allowedFields = [
    'patient_name', 'patient_thread_id', 'uhid', 'ip_number', 'age', 'gender',
    'procedure_name', 'procedure_side', 'case_type', 'wound_class', 'case_complexity',
    'estimated_duration_minutes', 'anaesthesia_type', 'implant_required', 'blood_required', 'is_insured',
    'primary_surgeon_name', 'primary_surgeon_id', 'assistant_surgeon_name',
    'anaesthesiologist_name', 'anaesthesiologist_id',
    'scrub_nurse_name', 'circulating_nurse_name', 'ot_technician_name',
    'scheduled_date', 'scheduled_time', 'ot_room', 'slot_order',
    'post_op_destination', 'icu_bed_required', 'notes', 'status', 'cancellation_reason', 'postponed_to',
  ];

  for (const field of allowedFields) {
    if (field in updates && updates[field as keyof typeof updates] !== undefined) {
      setClauses.push(`${field} = $${idx++}`);
      params.push(updates[field as keyof typeof updates]);
    }
  }

  if (setClauses.length <= 1) return null; // nothing to update besides timestamp

  params.push(id);
  const rows = await sql(
    `UPDATE surgery_postings SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );

  return rows.length > 0 ? (rows[0] as SurgeryPosting) : null;
}

// ============================================
// CANCEL / POSTPONE
// ============================================

export async function cancelSurgeryPosting(id: string, reason: string): Promise<SurgeryPosting | null> {
  return updateSurgeryPosting(id, { status: 'cancelled', cancellation_reason: reason });
}

export async function postponeSurgeryPosting(id: string, newDate: string, reason: string): Promise<SurgeryPosting | null> {
  return updateSurgeryPosting(id, { status: 'postponed', postponed_to: newDate, cancellation_reason: reason });
}

// ============================================
// READINESS ITEM ACTIONS
// ============================================

export async function updateReadinessItem(
  itemId: string,
  action: 'confirm' | 'flag' | 'block' | 'mark_na' | 'reset',
  performedBy: string,
  performedByName: string,
  opts?: { notes?: string; status_detail?: string; asa_score?: number }
): Promise<OTReadinessItem | null> {
  const sql = getSql();

  // Get current item
  const itemRows = await sql(`SELECT * FROM ot_readiness_items WHERE id = $1`, [itemId]);
  if (itemRows.length === 0) return null;
  const item = itemRows[0] as OTReadinessItem;

  const statusMap: Record<string, OTReadinessItemStatus> = {
    confirm: 'confirmed', flag: 'flagged', block: 'blocked',
    mark_na: 'not_applicable', reset: 'pending',
  };
  const auditMap: Record<string, OTAuditAction> = {
    confirm: 'confirmed', flag: 'flagged', block: 'blocked',
    mark_na: 'marked_na', reset: 'reset',
  };

  const newStatus = statusMap[action];
  const auditAction = auditMap[action];

  // Update the item
  const setClauses = [
    `status = $1`, `updated_at = NOW()`,
  ];
  const params: unknown[] = [newStatus];
  let idx = 2;

  if (action === 'confirm') {
    setClauses.push(`confirmed_by = $${idx++}`); params.push(performedBy);
    setClauses.push(`confirmed_by_name = $${idx++}`); params.push(performedByName);
    setClauses.push(`confirmed_at = NOW()`);
    if (opts?.notes) { setClauses.push(`confirmation_notes = $${idx++}`); params.push(opts.notes); }
    if (opts?.asa_score !== undefined) { setClauses.push(`asa_score_given = $${idx++}`); params.push(opts.asa_score); }
  }
  if (opts?.status_detail) { setClauses.push(`status_detail = $${idx++}`); params.push(opts.status_detail); }
  if (action === 'reset') {
    setClauses.push(`confirmed_by = NULL`, `confirmed_by_name = NULL`, `confirmed_at = NULL`, `confirmation_notes = NULL`);
  }

  params.push(itemId);
  const updatedRows = await sql(
    `UPDATE ot_readiness_items SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  const updated = updatedRows[0] as OTReadinessItem;

  // Write audit log
  await sql(`
    INSERT INTO ot_readiness_audit_log (readiness_item_id, surgery_posting_id, action, old_status, new_status, detail, performed_by, performed_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [itemId, item.surgery_posting_id, auditAction, item.status, newStatus, opts?.notes || opts?.status_detail || null, performedBy, performedByName]);

  // Recompute overall readiness
  await recomputeOverallReadiness(item.surgery_posting_id);

  // Post system message (non-fatal)
  try {
    await postReadinessSystemMessage(item.surgery_posting_id, updated, auditAction, performedByName);
  } catch (err) {
    console.error('[OT] Readiness system message failed:', err);
  }

  return updated;
}

// ============================================
// BULK CONFIRM
// ============================================

export async function bulkConfirmItems(
  surgeryPostingId: string,
  itemIds: string[],
  performedBy: string,
  performedByName: string,
  notes?: string
): Promise<OTReadinessItem[]> {
  const sql = getSql();
  const confirmed: OTReadinessItem[] = [];

  for (const itemId of itemIds) {
    const rows = await sql(`
      UPDATE ot_readiness_items
      SET status = 'confirmed', confirmed_by = $1, confirmed_by_name = $2, confirmed_at = NOW(),
          confirmation_notes = $3, updated_at = NOW()
      WHERE id = $4 AND surgery_posting_id = $5 AND status = 'pending'
      RETURNING *
    `, [performedBy, performedByName, notes || null, itemId, surgeryPostingId]);

    if (rows.length > 0) {
      confirmed.push(rows[0] as OTReadinessItem);
      await sql(`
        INSERT INTO ot_readiness_audit_log (readiness_item_id, surgery_posting_id, action, old_status, new_status, detail, performed_by, performed_by_name)
        VALUES ($1, $2, 'bulk_confirmed', 'pending', 'confirmed', $3, $4, $5)
      `, [itemId, surgeryPostingId, notes || null, performedBy, performedByName]);
    }
  }

  // Single recompute after all updates
  await recomputeOverallReadiness(surgeryPostingId);

  // Single system message for bulk
  try {
    const posting = await sql(`SELECT * FROM surgery_postings WHERE id = $1`, [surgeryPostingId]);
    if (posting.length > 0) {
      const p = posting[0] as SurgeryPosting;
      const itemLabels = confirmed.map(i => i.item_label.split(' ')[0] + ' ✓').join(' | ');
      const msg = `✅ ${performedByName} confirmed ${confirmed.length} items\n${p.procedure_name} — ${p.primary_surgeon_name} — OT ${p.ot_room}, ${p.scheduled_date}\n${itemLabels}`;
      await sendSystemMessage('cross-functional', 'ot-schedule', msg);
    }
  } catch (err) {
    console.error('[OT] Bulk confirm system message failed:', err);
  }

  return confirmed;
}

// ============================================
// ADD DYNAMIC ITEM
// ============================================

export async function addDynamicItem(
  surgeryPostingId: string,
  itemType: 'specialist_clearance' | 'equipment',
  data: {
    specialty?: string;
    reason?: string;
    equipment?: {
      item_type: string;
      item_name: string;
      vendor_name?: string;
      is_rental?: boolean;
      quantity?: number;
    };
  },
  performedBy: string,
  performedByName: string
): Promise<OTReadinessItem> {
  const sql = getSql();

  // Get posting for due_by calc
  const postingRows = await sql(`SELECT * FROM surgery_postings WHERE id = $1`, [surgeryPostingId]);
  if (postingRows.length === 0) throw new Error('Surgery posting not found');
  const posting = postingRows[0] as SurgeryPosting;

  const rawDate = posting.scheduled_date;
  let dateStr: string;
  if (rawDate instanceof Date) {
    dateStr = rawDate.toISOString().slice(0, 10);
  } else if (typeof rawDate === 'string' && rawDate.length > 10) {
    dateStr = rawDate.slice(0, 10);
  } else {
    dateStr = String(rawDate);
  }
  const rawTime = posting.scheduled_time || '08:00';
  const timeStr = typeof rawTime === 'string' && rawTime.length > 5 ? rawTime.slice(0, 5) : String(rawTime).slice(0, 5);
  const baseDate = new Date(`${dateStr}T${timeStr}:00+05:30`);
  const dueBy = new Date(baseDate.getTime() - 12 * 60 * 60 * 1000); // 12h before

  // Get next sort_order for dynamic items
  const maxSort = await sql(`SELECT COALESCE(MAX(sort_order), 99) as max_sort FROM ot_readiness_items WHERE surgery_posting_id = $1`, [surgeryPostingId]);
  const sortOrder = (maxSort[0]?.max_sort || 99) + 1;

  let itemKey: string;
  let itemLabel: string;
  let itemCategory: string;
  let responsibleRole: string;

  if (itemType === 'specialist_clearance') {
    const specialty = data.specialty || 'specialist';
    itemKey = `clearance_${specialty.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
    itemLabel = `${specialty} Clearance${data.reason ? ` (${data.reason})` : ''}`;
    itemCategory = 'specialist_clearance';
    responsibleRole = specialty.toLowerCase();
  } else {
    const equipName = data.equipment?.item_name || 'Equipment';
    itemKey = `equip_${equipName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40)}_${Date.now()}`;
    itemLabel = equipName;
    itemCategory = 'equipment';
    responsibleRole = 'supply_chain';
  }

  // Insert readiness item
  const itemRows = await sql(`
    INSERT INTO ot_readiness_items (
      surgery_posting_id, item_key, item_label, item_category,
      responsible_role, sort_order, is_dynamic, due_by
    ) VALUES ($1, $2, $3, $4, $5, $6, true, $7)
    RETURNING *
  `, [surgeryPostingId, itemKey, itemLabel, itemCategory, responsibleRole, sortOrder, dueBy.toISOString()]);

  const newItem = itemRows[0] as OTReadinessItem;

  // If equipment, also insert into ot_equipment_items
  if (itemType === 'equipment' && data.equipment) {
    await sql(`
      INSERT INTO ot_equipment_items (
        surgery_posting_id, readiness_item_id, item_type, item_name,
        vendor_name, is_rental, quantity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      surgeryPostingId, newItem.id, data.equipment.item_type, data.equipment.item_name,
      data.equipment.vendor_name || null, data.equipment.is_rental || false, data.equipment.quantity || 1,
    ]);
  }

  // Audit log
  await sql(`
    INSERT INTO ot_readiness_audit_log (readiness_item_id, surgery_posting_id, action, new_status, detail, performed_by, performed_by_name)
    VALUES ($1, $2, 'added', 'pending', $3, $4, $5)
  `, [newItem.id, surgeryPostingId, `Dynamic ${itemType}: ${itemLabel}`, performedBy, performedByName]);

  // Recompute
  await recomputeOverallReadiness(surgeryPostingId);

  return newItem;
}

// ============================================
// GET MY ITEMS (role-filtered)
// ============================================

export async function getMyReadinessItems(
  userRole: string,
  userId: string,
  countOnly: boolean = false
): Promise<{ items?: (OTReadinessItem & { procedure_name: string; primary_surgeon_name: string; ot_room: number; scheduled_date: string; scheduled_time: string | null; patient_name: string })[]; count?: number }> {
  const sql = getSql();

  if (countOnly) {
    const rows = await sql(`
      SELECT COUNT(*) as count
      FROM ot_readiness_items ori
      JOIN surgery_postings sp ON sp.id = ori.surgery_posting_id
      WHERE ori.status = 'pending'
        AND sp.status NOT IN ('completed', 'cancelled')
        AND (ori.responsible_role = $1 OR ori.responsible_user_id = $2)
    `, [userRole, userId]);
    return { count: parseInt(rows[0]?.count || '0') };
  }

  const rows = await sql(`
    SELECT ori.*,
           sp.procedure_name, sp.primary_surgeon_name, sp.ot_room,
           sp.scheduled_date, sp.scheduled_time, sp.patient_name
    FROM ot_readiness_items ori
    JOIN surgery_postings sp ON sp.id = ori.surgery_posting_id
    WHERE ori.status = 'pending'
      AND sp.status NOT IN ('completed', 'cancelled')
      AND (ori.responsible_role = $1 OR ori.responsible_user_id = $2)
    ORDER BY sp.scheduled_date, sp.scheduled_time NULLS LAST, ori.sort_order
  `, [userRole, userId]);

  return { items: rows as any[] };
}

// ============================================
// GET OVERDUE OT ITEMS
// ============================================

export async function getOverdueOTItems(): Promise<OTReadinessItem[]> {
  const sql = getSql();
  const rows = await sql(`
    SELECT ori.*, sp.procedure_name, sp.primary_surgeon_name, sp.ot_room,
           sp.scheduled_date, sp.patient_name, sp.patient_thread_id
    FROM ot_readiness_items ori
    JOIN surgery_postings sp ON sp.id = ori.surgery_posting_id
    WHERE ori.status = 'pending'
      AND ori.due_by < NOW()
      AND sp.status NOT IN ('completed', 'cancelled')
    ORDER BY ori.due_by ASC
  `);
  return rows as OTReadinessItem[];
}

// ============================================
// SCHEDULE / DASHBOARD
// ============================================

export async function getOTSchedule(date: string, otRoom?: number): Promise<(SurgeryPosting & { readiness_confirmed: number; readiness_total: number })[]> {
  const sql = getSql();
  const params: (string | number)[] = [date];
  let roomFilter = '';
  if (otRoom) { roomFilter = `AND sp.ot_room = $2`; params.push(otRoom); }

  const rows = await sql(`
    SELECT sp.*,
      COALESCE((SELECT COUNT(*) FROM ot_readiness_items ori WHERE ori.surgery_posting_id = sp.id AND ori.status = 'confirmed'), 0)::int as readiness_confirmed,
      COALESCE((SELECT COUNT(*) FROM ot_readiness_items ori WHERE ori.surgery_posting_id = sp.id AND ori.status != 'not_applicable'), 0)::int as readiness_total
    FROM surgery_postings sp
    WHERE sp.scheduled_date = $1 AND sp.status NOT IN ('cancelled')
    ${roomFilter}
    ORDER BY sp.ot_room, sp.slot_order NULLS LAST, sp.scheduled_time NULLS LAST
  `, params);

  return rows as any[];
}

export async function getOTScheduleStats(date: string): Promise<{
  total: number; ready: number; partial: number; not_ready: number; blocked: number;
}> {
  const sql = getSql();
  const rows = await sql(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE overall_readiness = 'ready') as ready,
      COUNT(*) FILTER (WHERE overall_readiness = 'partial') as partial,
      COUNT(*) FILTER (WHERE overall_readiness = 'not_ready') as not_ready,
      COUNT(*) FILTER (WHERE overall_readiness = 'blocked') as blocked
    FROM surgery_postings
    WHERE scheduled_date = $1 AND status NOT IN ('cancelled')
  `, [date]);
  const r = rows[0];
  return {
    total: parseInt(r.total), ready: parseInt(r.ready),
    partial: parseInt(r.partial), not_ready: parseInt(r.not_ready), blocked: parseInt(r.blocked),
  };
}

// ============================================
// EQUIPMENT STATUS UPDATE
// ============================================

export async function updateEquipmentStatus(
  equipmentId: string,
  newStatus: string,
  opts?: { delivery_eta?: string; status_notes?: string; verified_by?: string }
): Promise<OTEquipmentItem | null> {
  const sql = getSql();

  const setClauses = [`status = $1`, `updated_at = NOW()`];
  const params: unknown[] = [newStatus];
  let idx = 2;

  if (opts?.delivery_eta) { setClauses.push(`delivery_eta = $${idx++}`); params.push(opts.delivery_eta); }
  if (opts?.status_notes) { setClauses.push(`status_notes = $${idx++}`); params.push(opts.status_notes); }
  if (newStatus === 'delivered') { setClauses.push(`delivered_at = NOW()`); }
  if (newStatus === 'verified' && opts?.verified_by) {
    setClauses.push(`verified_by = $${idx++}`); params.push(opts.verified_by);
    setClauses.push(`verified_at = NOW()`);
  }

  params.push(equipmentId);
  const rows = await sql(
    `UPDATE ot_equipment_items SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );

  return rows.length > 0 ? (rows[0] as OTEquipmentItem) : null;
}

// ============================================
// ESCALATION CHECK (cron)
// ============================================

export async function checkOTEscalations(): Promise<{ escalated: number; errors: string[] }> {
  const sql = getSql();
  const errors: string[] = [];
  let escalated = 0;

  // Find pending items past due_by that haven't been escalated to max level
  const overdue = await sql(`
    SELECT ori.*, sp.procedure_name, sp.primary_surgeon_name, sp.ot_room, sp.scheduled_date, sp.patient_thread_id
    FROM ot_readiness_items ori
    JOIN surgery_postings sp ON sp.id = ori.surgery_posting_id
    WHERE ori.status = 'pending'
      AND ori.due_by < NOW()
      AND sp.status NOT IN ('completed', 'cancelled')
      AND ori.escalation_level < 2
    ORDER BY ori.due_by ASC
  `);

  for (const item of overdue) {
    try {
      const newLevel = (item.escalation_level || 0) + 1;
      // Level 1: 0h overdue → dept head. Level 2: 2h+ overdue → GM
      const hoursOverdue = (Date.now() - new Date(item.due_by).getTime()) / (1000 * 60 * 60);

      if (newLevel === 1 || (newLevel === 2 && hoursOverdue >= 2)) {
        await sql(`
          UPDATE ot_readiness_items
          SET escalated = true, escalated_at = NOW(), escalation_level = $1, updated_at = NOW()
          WHERE id = $2
        `, [newLevel, item.id]);

        await sql(`
          INSERT INTO ot_readiness_audit_log (readiness_item_id, surgery_posting_id, action, old_status, new_status, detail, performed_by, performed_by_name)
          VALUES ($1, $2, 'escalated', $3, $3, $4, 'rounds-system', 'System')
        `, [item.id, item.surgery_posting_id, item.status, `Escalated to level ${newLevel}. ${Math.round(hoursOverdue)}h overdue.`]);

        // If level 2, mark posting as blocked
        if (newLevel === 2) {
          await sql(`UPDATE surgery_postings SET overall_readiness = 'blocked', updated_at = NOW() WHERE id = $1`, [item.surgery_posting_id]);
        }

        // Post escalation message
        const msg = `🔴 ESCALATION: ${item.item_label}\n${item.procedure_name} — ${item.primary_surgeon_name} — OT ${item.ot_room}, ${item.scheduled_date}\nItem: "${item.item_label}" — ${Math.round(hoursOverdue)}h overdue\nEscalation Level: ${newLevel}`;
        await sendSystemMessage('cross-functional', 'ot-schedule', msg);

        escalated++;
      }
    } catch (err) {
      errors.push(`Item ${item.id}: ${err}`);
    }
  }

  return { escalated, errors };
}

// ============================================
// HELPERS
// ============================================

async function recomputeOverallReadiness(surgeryPostingId: string): Promise<void> {
  const sql = getSql();
  const items = await sql(`SELECT status FROM ot_readiness_items WHERE surgery_posting_id = $1`, [surgeryPostingId]);
  const overall = computeOverallReadiness(items as Pick<OTReadinessItem, 'status'>[]);
  await sql(`UPDATE surgery_postings SET overall_readiness = $1, updated_at = NOW() WHERE id = $2`, [overall, surgeryPostingId]);

  // If all ready, post system message
  if (overall === 'ready') {
    try {
      const posting = await sql(`SELECT * FROM surgery_postings WHERE id = $1`, [surgeryPostingId]);
      if (posting.length > 0) {
        const p = posting[0] as SurgeryPosting;
        const total = items.filter(i => (i as any).status !== 'not_applicable').length;
        const msg = `🟢 SURGERY READY — All items confirmed\n${p.procedure_name} — ${p.primary_surgeon_name} — OT ${p.ot_room}, ${p.scheduled_date}\n${total}/${total} items green ✅`;
        await sendSystemMessage('cross-functional', 'ot-schedule', msg);
      }
    } catch (err) {
      console.error('[OT] Ready notification failed:', err);
    }
  }
}

async function getPatientChannelId(sql: ReturnType<typeof neon>, patientThreadId: string): Promise<string | null> {
  const rows = await sql(`SELECT getstream_channel_id FROM patient_threads WHERE id = $1`, [patientThreadId]);
  return rows.length > 0 ? rows[0].getstream_channel_id : null;
}

async function postReadinessSystemMessage(
  surgeryPostingId: string,
  item: OTReadinessItem,
  action: OTAuditAction,
  performedByName: string
): Promise<void> {
  const sql = getSql();
  const posting = await sql(`SELECT * FROM surgery_postings WHERE id = $1`, [surgeryPostingId]);
  if (posting.length === 0) return;
  const p = posting[0] as SurgeryPosting;

  const icons: Record<string, string> = {
    confirmed: '✅', flagged: '🚫', blocked: '🔴', reset: '🔄', marked_na: '➖', added: '➕',
  };
  const icon = icons[action] || '📝';
  const msg = `${icon} ${item.item_label} — ${action} by ${performedByName}\n${p.procedure_name} — ${p.primary_surgeon_name} — OT ${p.ot_room}, ${p.scheduled_date}`;

  await sendSystemMessage('cross-functional', 'ot-schedule', msg);

  if (p.patient_thread_id) {
    const ptChannel = await getPatientChannelId(sql, p.patient_thread_id);
    if (ptChannel) {
      await sendSystemMessage('patient-thread', ptChannel, msg);
    }
  }
}
