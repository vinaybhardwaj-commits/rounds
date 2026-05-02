// =============================================================================
// PATCH /api/pac-workspace/[caseId]/appointments/[appointmentId]   (PCW2.7a)
//
// Updates an appointment. Supports:
//   - Reschedule: { action: 'reschedule', scheduled_at, modality?, provider*, notes? }
//     → marks current row 'rescheduled' + INSERTs new 'scheduled' row referencing
//       the same parent. Original row preserved for audit trail.
//   - Mark complete: { action: 'complete' } → status='completed'.
//   - Cancel: { action: 'cancel', cancelled_reason } → status='cancelled'.
//   - Inline update: { action: 'update', ...fields } → patches non-status fields
//     in place (used for quick edits without rescheduling chain).
//
// Auth: PAC write roles + super_admin universal pass.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { audit } from '@/lib/audit';
import type {
  PacAppointmentRow,
  PacAppointmentModality,
} from '@/lib/pac-workspace/types';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;

const VALID_MODALITIES = new Set<PacAppointmentModality>([
  'in_person_opd', 'bedside', 'telephonic', 'video', 'paper', 'walk_in',
]);

interface PatchBody {
  action: 'reschedule' | 'complete' | 'cancel' | 'update';
  scheduled_at?: string | null;
  modality?: PacAppointmentModality | null;
  provider_id?: string | null;
  provider_name?: string | null;
  provider_specialty?: string | null;
  location?: string | null;
  notes?: string | null;
  expected_duration_min?: number | null;
  deadline_at?: string | null;
  cancelled_reason?: string | null;
}

interface AppointmentRow {
  id: string;
  case_id: string;
  parent_type: string;
  parent_id: string | null;
  status: string;
  hospital_id: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { caseId: string; appointmentId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const { caseId, appointmentId } = params;
    if (!UUID_RE.test(caseId) || !UUID_RE.test(appointmentId)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const body = (await request.json()) as PatchBody;
    if (!body || !body.action) {
      return NextResponse.json({ success: false, error: 'action required' }, { status: 400 });
    }

    // Tenancy + load row
    const appt = await queryOne<AppointmentRow>(
      `SELECT a.id::text AS id, a.case_id::text AS case_id, a.parent_type,
              a.parent_id::text AS parent_id, a.status, sc.hospital_id::text AS hospital_id
         FROM pac_appointments a
         JOIN surgical_cases sc ON sc.id = a.case_id
        WHERE a.id = $1 AND a.case_id = $2
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($3::UUID))`,
      [appointmentId, caseId, user.profileId]
    );
    if (!appt) {
      return NextResponse.json(
        { success: false, error: 'Appointment not found or access denied' },
        { status: 404 }
      );
    }
    if (appt.status === 'cancelled' || appt.status === 'rescheduled') {
      return NextResponse.json(
        {
          success: false,
          error: `Appointment is ${appt.status} — already terminal in lifecycle`,
        },
        { status: 409 }
      );
    }

    if (body.modality && !VALID_MODALITIES.has(body.modality)) {
      return NextResponse.json(
        { success: false, error: `Invalid modality: ${body.modality}` },
        { status: 400 }
      );
    }

    let result: PacAppointmentRow | null = null;

    if (body.action === 'complete') {
      result = await queryOne<PacAppointmentRow>(
        `UPDATE pac_appointments
            SET status = 'completed',
                updated_at = NOW(),
                updated_by = $2
          WHERE id = $1
          RETURNING id::text AS id, case_id::text AS case_id, parent_type,
                    parent_id::text AS parent_id, scheduled_at::text AS scheduled_at,
                    modality, provider_id::text AS provider_id, provider_name,
                    provider_specialty, location, status,
                    deadline_at::text AS deadline_at, expected_duration_min,
                    notes, cancelled_reason,
                    created_at::text AS created_at, updated_at::text AS updated_at`,
        [appointmentId, user.profileId]
      );
    } else if (body.action === 'cancel') {
      result = await queryOne<PacAppointmentRow>(
        `UPDATE pac_appointments
            SET status = 'cancelled',
                cancelled_reason = $2,
                updated_at = NOW(),
                updated_by = $3
          WHERE id = $1
          RETURNING id::text AS id, case_id::text AS case_id, parent_type,
                    parent_id::text AS parent_id, scheduled_at::text AS scheduled_at,
                    modality, provider_id::text AS provider_id, provider_name,
                    provider_specialty, location, status,
                    deadline_at::text AS deadline_at, expected_duration_min,
                    notes, cancelled_reason,
                    created_at::text AS created_at, updated_at::text AS updated_at`,
        [appointmentId, body.cancelled_reason ?? null, user.profileId]
      );
    } else if (body.action === 'reschedule') {
      // Mark current as rescheduled; insert new row referencing same parent.
      await sqlQuery(
        `UPDATE pac_appointments
            SET status = 'rescheduled',
                updated_at = NOW(),
                updated_by = $2
          WHERE id = $1`,
        [appointmentId, user.profileId]
      );
      result = await queryOne<PacAppointmentRow>(
        `INSERT INTO pac_appointments
           (case_id, parent_type, parent_id, scheduled_at, modality,
            provider_id, provider_name, provider_specialty, location,
            notes, expected_duration_min, deadline_at, status, created_by)
         SELECT case_id, parent_type, parent_id,
                COALESCE($2::timestamptz, scheduled_at),
                COALESCE($3, modality),
                COALESCE($4::uuid, provider_id),
                COALESCE($5, provider_name),
                COALESCE($6, provider_specialty),
                COALESCE($7, location),
                COALESCE($8, notes),
                COALESCE($9, expected_duration_min),
                COALESCE($10::timestamptz, deadline_at),
                'scheduled',
                $11
           FROM pac_appointments
          WHERE id = $1
         RETURNING id::text AS id, case_id::text AS case_id, parent_type,
                   parent_id::text AS parent_id, scheduled_at::text AS scheduled_at,
                   modality, provider_id::text AS provider_id, provider_name,
                   provider_specialty, location, status,
                   deadline_at::text AS deadline_at, expected_duration_min,
                   notes, cancelled_reason,
                   created_at::text AS created_at, updated_at::text AS updated_at`,
        [
          appointmentId,
          body.scheduled_at ?? null,
          body.modality ?? null,
          body.provider_id ?? null,
          body.provider_name ?? null,
          body.provider_specialty ?? null,
          body.location ?? null,
          body.notes ?? null,
          body.expected_duration_min ?? null,
          body.deadline_at ?? null,
          user.profileId,
        ]
      );
    } else {
      // 'update': inline edit without status change
      result = await queryOne<PacAppointmentRow>(
        `UPDATE pac_appointments
            SET scheduled_at  = COALESCE($2::timestamptz, scheduled_at),
                modality      = COALESCE($3, modality),
                provider_id   = COALESCE($4::uuid, provider_id),
                provider_name = COALESCE($5, provider_name),
                provider_specialty = COALESCE($6, provider_specialty),
                location      = COALESCE($7, location),
                notes         = COALESCE($8, notes),
                expected_duration_min = COALESCE($9, expected_duration_min),
                deadline_at   = COALESCE($10::timestamptz, deadline_at),
                updated_at    = NOW(),
                updated_by    = $11
          WHERE id = $1
          RETURNING id::text AS id, case_id::text AS case_id, parent_type,
                    parent_id::text AS parent_id, scheduled_at::text AS scheduled_at,
                    modality, provider_id::text AS provider_id, provider_name,
                    provider_specialty, location, status,
                    deadline_at::text AS deadline_at, expected_duration_min,
                    notes, cancelled_reason,
                    created_at::text AS created_at, updated_at::text AS updated_at`,
        [
          appointmentId,
          body.scheduled_at ?? null,
          body.modality ?? null,
          body.provider_id ?? null,
          body.provider_name ?? null,
          body.provider_specialty ?? null,
          body.location ?? null,
          body.notes ?? null,
          body.expected_duration_min ?? null,
          body.deadline_at ?? null,
          user.profileId,
        ]
      );
    }

    if (!result) {
      return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 });
    }

    audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: appt.hospital_id,
      action: `pac.appointment.${body.action}`,
      targetType: 'pac_appointment',
      targetId: result.id,
      summary: `Appointment ${body.action}${
        body.scheduled_at ? ` to ${body.scheduled_at}` : ''
      }${body.cancelled_reason ? ` (${body.cancelled_reason})` : ''}`,
      payloadAfter: { ...body, parent_type: appt.parent_type },
      request,
    }).catch((e) => console.error('[audit] pac.appointment failed:', e));

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('PATCH /pac-workspace/[caseId]/appointments/[id] error:', err);
    return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 });
  }
}
