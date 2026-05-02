// =============================================================================
// PATCH /api/pac-workspace/[caseId]/asa   (PCW2.9)
//
// Override ASA grade per PRD §7.4. Coordinator override: source='coordinator';
// anaesthetist sets at publish: source='anaesthetist' (PCW2.11 publish gate).
// On change, recompute the engine so Layer 1 baseline rules can newly fire
// (or stop firing if grade decreased).
//
// Body:
//   { grade: 1 | 2 | 3 | 4 | 5, reason: string, source?: 'coordinator' }
//
// Auth: PAC write roles + super_admin universal pass. (Anaesthetist-only
// publish path lands in PCW2.11.)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { audit } from '@/lib/audit';
import { recomputeNonFatal } from '@/lib/pac-workspace/engine-persistence';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PAC_WRITE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;

interface PatchBody {
  grade: 1 | 2 | 3 | 4 | 5;
  reason?: string;
  source?: 'coordinator' | 'anaesthetist';
}

export async function PATCH(
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

    const body = (await request.json()) as PatchBody;
    if (!body || ![1, 2, 3, 4, 5].includes(body.grade)) {
      return NextResponse.json(
        { success: false, error: 'grade must be 1–5' },
        { status: 400 }
      );
    }
    // Coordinators must justify their override; anaesthetist publish (PCW2.11)
    // can pass source='anaesthetist' where reason is optional.
    if (body.source !== 'anaesthetist' && (!body.reason || body.reason.trim().length === 0)) {
      return NextResponse.json(
        { success: false, error: 'reason required for ASA override' },
        { status: 400 }
      );
    }

    // Tenancy + load case + current ASA.
    const caseRow = await queryOne<{
      id: string;
      hospital_id: string;
      asa_grade: number | null;
      asa_source: string | null;
    }>(
      `SELECT sc.id, sc.hospital_id::text AS hospital_id,
              pwp.asa_grade, pwp.asa_source
         FROM surgical_cases sc
         LEFT JOIN pac_workspace_progress pwp ON pwp.case_id = sc.id
        WHERE sc.id = $1
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [caseId, user.profileId]
    );
    if (!caseRow) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    const newSource = body.source === 'anaesthetist' ? 'anaesthetist' : 'coordinator';

    // pac_workspace_progress row required (created by v1 mode picker).
    // If missing, refuse — PCW2.9 doesn't auto-create the v1 row.
    const updated = await queryOne<{ case_id: string }>(
      `UPDATE pac_workspace_progress
          SET asa_grade = $2,
              asa_source = $3,
              asa_override_reason = $4,
              updated_at = NOW(),
              updated_by = $5
        WHERE case_id = $1
        RETURNING case_id::text AS case_id`,
      [caseId, body.grade, newSource, body.reason ?? null, user.profileId]
    );
    if (!updated) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No pac_workspace_progress row for this case. Set the PAC mode first via the v1 Mode picker.',
        },
        { status: 409 }
      );
    }

    // Recompute — Layer 1 baseline rules may newly fire / stop firing.
    const recompute = await recomputeNonFatal(caseId, 'asa_change').catch(() => null);

    audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: caseRow.hospital_id,
      action: 'pac.asa.override',
      targetType: 'pac_workspace_progress',
      targetId: caseId,
      summary: `ASA ${caseRow.asa_grade ?? 'null'} (${caseRow.asa_source ?? 'null'}) → ASA ${body.grade} (${newSource}): ${body.reason ?? 'no reason'}`,
      payloadBefore: {
        asa_grade: caseRow.asa_grade,
        asa_source: caseRow.asa_source,
      },
      payloadAfter: {
        asa_grade: body.grade,
        asa_source: newSource,
        asa_override_reason: body.reason,
      },
      request,
    }).catch((e) => console.error('[audit] pac.asa.override failed:', e));

    return NextResponse.json({
      success: true,
      data: {
        asa_grade: body.grade,
        asa_source: newSource,
        recompute,
      },
    });
  } catch (err) {
    console.error('PATCH /pac-workspace/[caseId]/asa error:', err);
    return NextResponse.json({ success: false, error: 'ASA override failed' }, { status: 500 });
  }
}
