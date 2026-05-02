// =============================================================================
// POST /api/pac-workspace/[caseId]/appointments   (PCW2.7a)
//
// Creates a pac_appointments row. Accepts:
//   parent_type: 'pac_visit' | 'clearance' | 'diagnostic'
//   parent_id: UUID (required for clearance / diagnostic; NULL for pac_visit)
//   scheduled_at: ISO timestamp
//   modality: enum
//   provider_id / provider_name / provider_specialty
//   location, notes, expected_duration_min, deadline_at
//
// PRD §15.3 acceptance: schedule a clearance for cardiology → pac_appointments
// row + (PCW2.7b) GetStream system message in patient channel.
//
// Auth: PAC write roles + super_admin universal pass.
// Audit: pac.appointment.create.
// Multiple appointments per parent allowed (rescheduling chain via
// status='rescheduled' on the prior row).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { audit } from '@/lib/audit';
import { sendSystemMessage } from '@/lib/getstream';
import type {
  PacAppointmentRow,
  PacAppointmentParentType,
  PacAppointmentModality,
} from '@/lib/pac-workspace/types';

const MODALITY_LABEL: Record<string, string> = {
  in_person_opd: 'in-person OPD',
  bedside: 'bedside',
  telephonic: 'telephonic',
  video: 'video',
  walk_in: 'walk-in',
  paper: 'paper screening',
};

function buildScheduleMessage(args: {
  parent_type: PacAppointmentParentType;
  parent_label: string;
  scheduled_at: string | null;
  provider_name: string | null;
  modality: PacAppointmentModality | null;
  isReschedule?: boolean;
}): string {
  const ts = args.scheduled_at
    ? new Date(args.scheduled_at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
      })
    : 'TBD';
  const provider = args.provider_name ? ` with ${args.provider_name}` : '';
  const modality = args.modality ? ` (${MODALITY_LABEL[args.modality] ?? args.modality})` : '';
  const verb = args.isReschedule ? '🔄 rescheduled' : '🗓 scheduled';
  return `${verb} ${args.parent_label} — ${ts}${provider}${modality}`;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;

const VALID_PARENT_TYPES = new Set<PacAppointmentParentType>(['pac_visit', 'clearance', 'diagnostic']);
const VALID_MODALITIES = new Set<PacAppointmentModality>([
  'in_person_opd',
  'bedside',
  'telephonic',
  'video',
  'paper',
  'walk_in',
]);

interface CreateBody {
  parent_type: PacAppointmentParentType;
  parent_id?: string | null;
  scheduled_at?: string | null;     // ISO timestamp
  modality?: PacAppointmentModality | null;
  provider_id?: string | null;
  provider_name?: string | null;
  provider_specialty?: string | null;
  location?: string | null;
  notes?: string | null;
  expected_duration_min?: number | null;
  deadline_at?: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as CreateBody;
    if (!body || !VALID_PARENT_TYPES.has(body.parent_type)) {
      return NextResponse.json(
        { success: false, error: 'parent_type required (pac_visit | clearance | diagnostic)' },
        { status: 400 }
      );
    }
    if (
      (body.parent_type === 'clearance' || body.parent_type === 'diagnostic') &&
      (!body.parent_id || !UUID_RE.test(body.parent_id))
    ) {
      return NextResponse.json(
        { success: false, error: 'parent_id required for clearance/diagnostic appointments' },
        { status: 400 }
      );
    }
    if (body.modality && !VALID_MODALITIES.has(body.modality)) {
      return NextResponse.json(
        { success: false, error: `Invalid modality: ${body.modality}` },
        { status: 400 }
      );
    }

    // Tenancy + load case
    const caseRow = await queryOne<{ id: string; hospital_id: string }>(
      `SELECT id, hospital_id FROM surgical_cases
        WHERE id = $1 AND archived_at IS NULL
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [caseId, user.profileId]
    );
    if (!caseRow) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    const inserted = await queryOne<PacAppointmentRow>(
      `INSERT INTO pac_appointments
         (case_id, parent_type, parent_id, scheduled_at, modality,
          provider_id, provider_name, provider_specialty, location,
          notes, expected_duration_min, deadline_at, status, created_by)
       VALUES ($1, $2, $3, $4::timestamptz, $5,
               $6, $7, $8, $9,
               $10, $11, $12::timestamptz, 'scheduled', $13)
       RETURNING id, case_id, parent_type, parent_id::text AS parent_id,
                 scheduled_at::text AS scheduled_at, modality,
                 provider_id::text AS provider_id, provider_name, provider_specialty,
                 location, status, deadline_at::text AS deadline_at,
                 expected_duration_min, notes, cancelled_reason,
                 created_at::text AS created_at, updated_at::text AS updated_at`,
      [
        caseId,
        body.parent_type,
        body.parent_id ?? null,
        body.scheduled_at ?? null,
        body.modality ?? null,
        body.provider_id ?? null,
        body.provider_name ?? null,
        body.provider_specialty ?? null,
        body.location ?? null,
        body.notes ?? null,
        body.expected_duration_min ?? 20,
        body.deadline_at ?? null,
        user.profileId,
      ]
    );

    if (!inserted) {
      return NextResponse.json({ success: false, error: 'Insert failed' }, { status: 500 });
    }

    // PCW2.8 — GetStream system message to the patient thread channel.
    // Best-effort; failure logs but doesn't roll back the appointment.
    try {
      const channelRow = await queryOne<{ getstream_channel_id: string | null; patient_name: string | null }>(
        `SELECT pt.getstream_channel_id, pt.patient_name
           FROM surgical_cases sc
           JOIN patient_threads pt ON pt.id = sc.patient_thread_id
          WHERE sc.id = $1`,
        [caseId]
      );
      if (channelRow?.getstream_channel_id) {
        const parentLabelMap: Record<PacAppointmentParentType, string> = {
          pac_visit: 'PAC visit',
          clearance: body.provider_specialty
            ? `${body.provider_specialty} clearance`
            : 'Specialist clearance',
          diagnostic: 'Diagnostic',
        };
        const msg = buildScheduleMessage({
          parent_type: body.parent_type,
          parent_label: parentLabelMap[body.parent_type],
          scheduled_at: body.scheduled_at ?? null,
          provider_name: body.provider_name ?? null,
          modality: body.modality ?? null,
        });
        await sendSystemMessage('patient-thread', channelRow.getstream_channel_id, msg);
      }
    } catch (gsErr) {
      console.error('[pcw2.8] GetStream system message (create) failed (non-fatal):', (gsErr as Error).message);
    }

    audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: caseRow.hospital_id,
      action: 'pac.appointment.create',
      targetType: 'pac_appointment',
      targetId: inserted.id,
      summary: `Scheduled ${body.parent_type} appointment${
        body.scheduled_at ? ` for ${body.scheduled_at}` : ''
      }${body.provider_name ? ` with ${body.provider_name}` : ''}`,
      payloadAfter: {
        parent_type: body.parent_type,
        parent_id: body.parent_id,
        scheduled_at: body.scheduled_at,
        modality: body.modality,
        provider_name: body.provider_name,
        provider_specialty: body.provider_specialty,
      },
      request,
    }).catch((e) => console.error('[audit] pac.appointment.create failed:', e));

    return NextResponse.json({ success: true, data: inserted });
  } catch (err) {
    console.error('POST /pac-workspace/[caseId]/appointments error:', err);
    return NextResponse.json({ success: false, error: 'Create failed' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { caseId: string } }
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

    const exists = await queryOne<{ id: string }>(
      `SELECT id FROM surgical_cases
        WHERE id = $1 AND archived_at IS NULL
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [caseId, user.profileId]
    );
    if (!exists) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    const rows = await sqlQuery<PacAppointmentRow>(
      `SELECT id::text AS id, case_id::text AS case_id, parent_type,
              parent_id::text AS parent_id,
              scheduled_at::text AS scheduled_at, modality,
              provider_id::text AS provider_id, provider_name, provider_specialty,
              location, status, deadline_at::text AS deadline_at,
              expected_duration_min, notes, cancelled_reason,
              created_at::text AS created_at, updated_at::text AS updated_at
         FROM pac_appointments
        WHERE case_id = $1
          AND status NOT IN ('cancelled', 'rescheduled')
        ORDER BY scheduled_at ASC NULLS LAST, created_at DESC`,
      [caseId]
    );

    return NextResponse.json(
      { success: true, data: { appointments: rows } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('GET /pac-workspace/[caseId]/appointments error:', err);
    return NextResponse.json({ success: false, error: 'Failed to load' }, { status: 500 });
  }
}
