// =============================================================================
// GET /api/pac-workspace/[caseId]
//
// PAC Coordinator Workspace v1 — single payload for the workspace UI.
// Behaviour:
//   1. Tenancy check via user_accessible_hospital_ids().
//   2. Auto-create pac_workspace_progress row on first open (default mode =
//      in_person_opd; checklist seeded from pac_checklist_templates;
//      sla_deadline_at computed from urgency per SOP §6.1).
//   3. Stamps surgical_cases.pac_workspace_started_at on first creation
//      (denormalised so PAC queue rendering doesn't need an outer join).
//   4. Lazily provisions a GetStream channel `pac-workspace:pacw-<caseId>`.
//      Best-effort — if Stream is unreachable the workspace still loads.
//   5. Returns { patient, progress, orders, clearances, channel_id, generated_at }.
//
// PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
// SOP: EHRC/SOP/OT/001 v5.0
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { ensurePacWorkspaceChannel } from '@/lib/getstream';
import { computeSLADeadline } from '@/lib/pac-workspace/sla';
import { seedChecklistFromTemplate } from '@/lib/pac-workspace/checklist';
import { loadIntakeContext, autoTickChecklist } from '@/lib/pac-workspace/intake-prefill';
import type {
  PacWorkspacePatient,
  PacWorkspaceProgressRow,
  PacOrderRow,
  PacClearanceRow,
  PacWorkspacePayload,
  PacChecklistItem,
  PacPatientContext,
} from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface PatientRow {
  case_id: string;
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  hospital_id: string;
  hospital_slug: string;
  hospital_name: string;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  urgency: string | null;
  case_state: string;
  surgeon_name: string | null;
  anaesthetist_name: string | null;
  pac_workspace_started_at: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    // ── 1. Load case + tenancy guard ────────────────────────────────────────
    const patientRow = await queryOne<PatientRow>(
      `SELECT
         sc.id::text AS case_id,
         sc.patient_thread_id::text AS patient_thread_id,
         pt.patient_name,
         pt.uhid,
         pt.age,
         pt.gender,
         sc.hospital_id::text AS hospital_id,
         h.slug AS hospital_slug,
         h.name AS hospital_name,
         sc.planned_procedure,
         sc.planned_surgery_date::text AS planned_surgery_date,
         sc.urgency,
         sc.state AS case_state,
         COALESCE(sp.full_name, '') AS surgeon_name,
         COALESCE(ap.full_name, '') AS anaesthetist_name,
         sc.pac_workspace_started_at::text AS pac_workspace_started_at
       FROM surgical_cases sc
       JOIN hospitals h ON h.id = sc.hospital_id
       LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
       LEFT JOIN profiles sp ON sp.id = sc.surgeon_id
       LEFT JOIN profiles ap ON ap.id = sc.anaesthetist_id
       WHERE sc.id = $1::uuid
         AND sc.archived_at IS NULL
         AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::uuid))
       LIMIT 1`,
      [caseId, user.profileId],
    );

    if (!patientRow) {
      // 404 (not 403) — don't leak existence of inaccessible cases.
      return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
    }

    // ── 2. Load existing workspace row, or create it ────────────────────────
    let progress = await queryOne<PacWorkspaceProgressRow>(
      `SELECT
         case_id::text AS case_id,
         hospital_id::text AS hospital_id,
         pac_mode,
         sub_state,
         checklist_template,
         checklist_state,
         scheduled_pac_at::text AS scheduled_pac_at,
         ipc_owner_id::text AS ipc_owner_id,
         anaesthetist_id::text AS anaesthetist_id,
         sla_deadline_at::text AS sla_deadline_at,
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM pac_workspace_progress
       WHERE case_id = $1::uuid AND archived_at IS NULL`,
      [caseId],
    );

    let patientContext: PacPatientContext | null = null;
    try {
      patientContext = await loadIntakeContext(patientRow.patient_thread_id);
    } catch (e) {
      console.error('[pcw.3] loadIntakeContext failed (non-fatal):', e instanceof Error ? e.message : e);
    }

    if (!progress) {
      // First open — seed everything.
      const { templateCode, items } = await seedChecklistFromTemplate('in_person_opd', patientRow.hospital_id);
      const sla = computeSLADeadline(patientRow.urgency, null);
      const ipcOwnerId = isPacWriteRole(user.role) ? user.profileId : null;

      // PCW.3 Q5 pre-fill: auto-tick allergy_history + current_medications when
      // the intake form has data populated. Marks the actor as the user who
      // first opened the workspace (closest available proxy) and adds a 'Pre-filled
      // from intake form' notes string.
      const itemsAfterPrefill = patientContext
        ? autoTickChecklist(
            items,
            {
              hasAllergies: !!patientContext.allergies,
              hasMedications: !!patientContext.current_medications,
            },
            user.profileId,
            // We don't have the user's full name on the JWT — use email as the
            // safer non-null fallback. PCW.4 can swap in profile name when the
            // session includes it.
            user.email,
          )
        : items;

      progress = await queryOne<PacWorkspaceProgressRow>(
        `INSERT INTO pac_workspace_progress
           (case_id, hospital_id, pac_mode, sub_state, checklist_template, checklist_state,
            ipc_owner_id, sla_deadline_at, updated_by)
         VALUES ($1::uuid, $2::uuid, 'in_person_opd', 'prep_in_progress', $3, $4::jsonb, $5, $6::timestamptz, $5)
         ON CONFLICT (case_id) DO UPDATE SET updated_at = NOW()
         RETURNING
           case_id::text AS case_id,
           hospital_id::text AS hospital_id,
           pac_mode,
           sub_state,
           checklist_template,
           checklist_state,
           scheduled_pac_at::text AS scheduled_pac_at,
           ipc_owner_id::text AS ipc_owner_id,
           anaesthetist_id::text AS anaesthetist_id,
           sla_deadline_at::text AS sla_deadline_at,
           created_at::text AS created_at,
           updated_at::text AS updated_at`,
        [caseId, patientRow.hospital_id, templateCode, JSON.stringify(itemsAfterPrefill), ipcOwnerId, sla],
      );

      // Stamp surgical_cases denorm column once. Ignored if re-opened by ON CONFLICT.
      if (!patientRow.pac_workspace_started_at) {
        await query(
          `UPDATE surgical_cases SET pac_workspace_started_at = NOW() WHERE id = $1::uuid AND pac_workspace_started_at IS NULL`,
          [caseId],
        );
      }
    }

    if (!progress) {
      return NextResponse.json({ success: false, error: 'Failed to initialise workspace' }, { status: 500 });
    }

    // ── 3. Load orders + clearances (likely empty in PCW.1 since UI ships in PCW.2) ──
    const [orders, clearances] = await Promise.all([
      query<PacOrderRow>(
        `SELECT
           po.id::text AS id,
           po.case_id::text AS case_id,
           po.order_type,
           pot.label AS order_label,
           po.status,
           po.result_text,
           po.result_attached_url,
           po.task_id::text AS task_id,
           po.requested_by::text AS requested_by,
           po.requested_at::text AS requested_at,
           po.reported_at::text AS reported_at,
           po.reviewed_at::text AS reviewed_at,
           po.notes,
           po.kind,
           po.result_value,
           po.result_received_at::text AS result_received_at,
           po.done_at::text AS done_at,
           po.done_at_source
         FROM pac_orders po
         LEFT JOIN pac_order_types pot ON pot.code = po.order_type
         WHERE po.case_id = $1::uuid
         ORDER BY po.requested_at ASC`,
        [caseId],
      ),
      query<PacClearanceRow>(
        `SELECT
           pc.id::text AS id,
           pc.case_id::text AS case_id,
           pc.specialty,
           pcs.label AS specialty_label,
           pc.status,
           pc.conditions_text,
           pc.task_id::text AS task_id,
           pc.assigned_to::text AS assigned_to,
           ap.full_name AS assigned_to_name,
           pc.requested_by::text AS requested_by,
           pc.requested_at::text AS requested_at,
           pc.responded_at::text AS responded_at,
           pc.notes
         FROM pac_clearances pc
         LEFT JOIN profiles ap ON ap.id = pc.assigned_to
         LEFT JOIN pac_clearance_specialties pcs ON pcs.code = pc.specialty
         WHERE pc.case_id = $1::uuid
         ORDER BY pc.requested_at ASC`,
        [caseId],
      ),
    ]);

    // ── 4. GetStream channel — best-effort ──────────────────────────────────
    let channelId: string | null = null;
    try {
      channelId = await ensurePacWorkspaceChannel({
        caseId,
        hospitalId: patientRow.hospital_id,
        patientName: patientRow.patient_name,
        uhid: patientRow.uhid,
        ipcOwnerId: progress.ipc_owner_id,
        anaesthetistId: progress.anaesthetist_id,
        initiatorId: user.profileId,
      });
    } catch (e) {
      console.error('[pcw.1] GetStream channel provision failed (non-fatal):', e instanceof Error ? e.message : e);
    }

    const payload: PacWorkspacePayload = {
      patient: extractPatient(patientRow),
      progress: { ...progress, checklist_state: ensureChecklistArray(progress.checklist_state) },
      orders,
      clearances,
      patient_context: patientContext,
      channel_id: channelId,
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    console.error('GET /api/pac-workspace/[caseId] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load workspace' },
      { status: 500 },
    );
  }
}

function extractPatient(row: PatientRow): PacWorkspacePatient {
  return {
    case_id: row.case_id,
    patient_thread_id: row.patient_thread_id,
    patient_name: row.patient_name,
    uhid: row.uhid,
    age: row.age,
    gender: row.gender,
    hospital_slug: row.hospital_slug,
    hospital_name: row.hospital_name,
    planned_procedure: row.planned_procedure,
    planned_surgery_date: row.planned_surgery_date,
    urgency: row.urgency,
    case_state: row.case_state,
    surgeon_name: row.surgeon_name,
    anaesthetist_name: row.anaesthetist_name,
  };
}

function ensureChecklistArray(value: unknown): PacChecklistItem[] {
  if (Array.isArray(value)) return value as PacChecklistItem[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as PacChecklistItem[];
    } catch {
      /* fallthrough */
    }
  }
  return [];
}

function isPacWriteRole(role: string | undefined | null): boolean {
  if (!role) return false;
  return (
    role === 'super_admin' ||
    role === 'ip_coordinator' ||
    role === 'pac_coordinator' ||
    role === 'anesthesiologist'
  );
}
