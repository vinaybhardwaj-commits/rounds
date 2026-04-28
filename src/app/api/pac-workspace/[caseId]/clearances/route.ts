// =============================================================================
// POST /api/pac-workspace/[caseId]/clearances
//
// Batch-creates pac_clearances rows + matching tasks rows (specialist queue).
// PRD §6.1 + §7. Specialty resolved via lookup table (SOP §6.3).
//
// Body: {
//   clearances: [{ specialty: string, assigned_to?: string, notes?: string, due_at?: string }]
// }
//
// Role gate (D2): super_admin + ip_coordinator + pac_coordinator + anesthesiologist.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { hasRole } from '@/lib/roles';
import type { PacClearanceRow } from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';

const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface ClearanceInput {
  specialty?: string;
  assigned_to?: string | null;
  notes?: string;
  due_at?: string;
}
interface Body {
  clearances?: ClearanceInput[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(user.role, PAC_WRITE_ROLES)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const body = (await request.json()) as Body;
    const requested = (body.clearances ?? []).filter(
      (c) => typeof c.specialty === 'string' && c.specialty!.trim().length > 0,
    );
    if (requested.length === 0) {
      return NextResponse.json({ success: false, error: 'clearances[] required' }, { status: 400 });
    }
    if (requested.length > 20) {
      return NextResponse.json({ success: false, error: 'Max 20 clearances per batch' }, { status: 400 });
    }

    const ctx = await queryOne<{ hospital_id: string; patient_thread_id: string | null; patient_name: string | null }>(
      `SELECT sc.hospital_id::text AS hospital_id,
              sc.patient_thread_id::text AS patient_thread_id,
              pt.patient_name
         FROM surgical_cases sc
         LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
        WHERE sc.id = $1::uuid
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::uuid))`,
      [caseId, user.profileId],
    );
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
    }

    // Validate specialties via lookup.
    const codes = Array.from(new Set(requested.map((c) => c.specialty!.trim())));
    const catalog = await query<{ code: string; label: string; default_assignee_role: string }>(
      `SELECT code, label, default_assignee_role
         FROM pac_clearance_specialties
        WHERE active = TRUE
          AND code = ANY($1::text[])
          AND (hospital_id IS NULL OR hospital_id = $2::uuid)`,
      [codes, ctx.hospital_id],
    );
    const labelByCode = new Map(catalog.map((r) => [r.code, r]));
    const unknown = codes.filter((c) => !labelByCode.has(c));
    if (unknown.length > 0) {
      return NextResponse.json(
        { success: false, error: `Unknown specialties: ${unknown.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate assigned_to UUIDs (when present).
    for (const c of requested) {
      if (c.assigned_to && !UUID_RE.test(c.assigned_to)) {
        return NextResponse.json(
          { success: false, error: `Invalid assigned_to UUID for specialty=${c.specialty}` },
          { status: 400 },
        );
      }
    }

    const created: PacClearanceRow[] = [];
    for (const c of requested) {
      const code = c.specialty!.trim();
      const meta = labelByCode.get(code)!;
      const assignedTo = c.assigned_to || null;

      const clearanceRow = await queryOne<PacClearanceRow>(
        `WITH ins AS (
           INSERT INTO pac_clearances (case_id, specialty, status, assigned_to, requested_by, notes)
           VALUES ($1::uuid, $2, 'requested', $3::uuid, $4::uuid, $5)
           RETURNING *
         )
         SELECT
           ins.id::text AS id, ins.case_id::text AS case_id, ins.specialty,
           pcs.label AS specialty_label,
           ins.status, ins.conditions_text, ins.task_id::text AS task_id,
           ins.assigned_to::text AS assigned_to,
           NULL::text AS assigned_to_name,
           ins.requested_by::text AS requested_by,
           ins.requested_at::text AS requested_at,
           ins.responded_at::text AS responded_at,
           ins.notes
         FROM ins
         LEFT JOIN pac_clearance_specialties pcs ON pcs.code = ins.specialty`,
        [caseId, code, assignedTo, user.profileId, c.notes ?? null],
      );
      if (!clearanceRow) continue;

      const sourceRef = `pac_clearance:${clearanceRow.id}`;
      const dueAt = c.due_at ?? null;

      const task = await queryOne<{ id: string }>(
        `INSERT INTO tasks
           (hospital_id, case_id, patient_thread_id, title, description,
            assignee_profile_id, owner_role, due_at, status, source, source_ref,
            priority, metadata, created_by, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
                 $6::uuid, $7, $8::timestamptz, 'pending', 'auto', $9,
                 'normal', $10::jsonb, $11::uuid, NOW(), NOW())
         ON CONFLICT (case_id, source_ref) WHERE source = 'auto' AND case_id IS NOT NULL
         DO NOTHING
         RETURNING id::text AS id`,
        [
          ctx.hospital_id,
          caseId,
          ctx.patient_thread_id,
          `Clearance: ${meta.label}`,
          ctx.patient_name ? `Specialist clearance for ${ctx.patient_name}` : 'PAC specialist clearance',
          assignedTo,
          meta.default_assignee_role,
          dueAt,
          sourceRef,
          JSON.stringify({ pac_clearance_id: clearanceRow.id, specialty: code, source: 'pac_workspace' }),
          user.profileId,
        ],
      );

      if (task) {
        const linked = await queryOne<PacClearanceRow>(
          `WITH upd AS (
             UPDATE pac_clearances SET task_id = $2::uuid WHERE id = $1::uuid RETURNING *
           )
           SELECT
             upd.id::text AS id, upd.case_id::text AS case_id, upd.specialty,
             pcs.label AS specialty_label,
             upd.status, upd.conditions_text, upd.task_id::text AS task_id,
             upd.assigned_to::text AS assigned_to,
             NULL::text AS assigned_to_name,
             upd.requested_by::text AS requested_by,
             upd.requested_at::text AS requested_at,
             upd.responded_at::text AS responded_at, upd.notes
           FROM upd
           LEFT JOIN pac_clearance_specialties pcs ON pcs.code = upd.specialty`,
          [clearanceRow.id, task.id],
        );
        if (linked) {
          // Hydrate assigned_to_name in a final read.
          if (linked.assigned_to) {
            const named = await queryOne<{ full_name: string | null }>(
              `SELECT full_name FROM profiles WHERE id = $1::uuid`,
              [linked.assigned_to],
            );
            linked.assigned_to_name = named?.full_name ?? null;
          }
          created.push(linked);
          continue;
        }
      }
      created.push(clearanceRow);
    }

    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: ctx.hospital_id,
        action: 'pac_workspace.clearances_added',
        targetType: 'surgical_case',
        targetId: caseId,
        summary: `Added ${created.length} PAC clearance(s)`,
        payloadAfter: { specialties: created.map((c) => c.specialty) },
        request,
        mode: 'fire_and_forget',
      });
    } catch (auditErr) {
      console.error('[audit:fire_and_forget] pac_workspace.clearances_added:', auditErr instanceof Error ? auditErr.message : auditErr);
    }

    return NextResponse.json({ success: true, data: { created_count: created.length, clearances: created } });
  } catch (error) {
    console.error('POST /api/pac-workspace/[caseId]/clearances error:', error);
    return NextResponse.json({ success: false, error: 'Failed to add clearances' }, { status: 500 });
  }
}
