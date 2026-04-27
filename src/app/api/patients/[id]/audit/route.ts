// =============================================================================
// GET /api/patients/[id]/audit  — per-patient activity timeline (GLASS.10.5)
//
// Per PRD §5.4.B — every authenticated user can see one patient's audit
// timeline. Tenancy enforced via user_accessible_hospital_ids().
//
// Returns the union of audit_log rows where:
//   - target_type = 'patient_thread' AND target_id = $1
//   - target_type = 'surgical_case'   AND target_id IN (cases of patient $1)
//   - target_type = 'form_submission' AND target_id IN (forms of patient $1)
//
// Sorted ts DESC, limit configurable (default 50, max 200). Joins profiles
// for actor_name. NO payload diff in this view (super_admin uses
// /admin/audit-log for that). Per-patient view is "minimal" per PRD §5.4.B.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { withApiTelemetry } from '@/lib/api-telemetry';

export const dynamic = 'force-dynamic';

interface ActivityRow {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  source: string;
}

async function GET_inner(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const patientId = params.id;
  if (!patientId || !/^[0-9a-f-]{36}$/i.test(patientId)) {
    return NextResponse.json({ success: false, error: 'Invalid patient id' }, { status: 400 });
  }

  const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);
  const limit = Math.max(1, Math.min(200, isNaN(limitRaw) ? 50 : limitRaw));

  // Tenancy gate: confirm the patient is in a hospital the user can access.
  const tenancyRows = await query<{ ok: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM patient_threads
      WHERE id = $1::uuid
        AND hospital_id = ANY(user_accessible_hospital_ids($2::uuid))
    ) AS ok
    `,
    [patientId, user.profileId]
  );
  if (!tenancyRows[0]?.ok) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  // Fetch the union: patient_thread row + cases-of-patient + forms-of-patient.
  // Single round-trip via a UNION subquery; LIMIT applied to the OUTER select
  // so we get the latest N events overall, not the latest N per source type.
  const rows = await query<ActivityRow>(
    `
    SELECT
      a.id::text,
      a.ts::text,
      a.actor_id::text,
      a.actor_role,
      p.full_name AS actor_name,
      a.action,
      a.target_type,
      a.target_id::text,
      a.summary,
      a.source
    FROM audit_log a
    LEFT JOIN profiles p ON p.id = a.actor_id
    WHERE
         (a.target_type = 'patient_thread' AND a.target_id = $1::uuid)
      OR (a.target_type = 'surgical_case'  AND a.target_id IN (
           SELECT id FROM surgical_cases WHERE patient_thread_id = $1::uuid
         ))
      OR (a.target_type = 'form_submission' AND a.target_id IN (
           SELECT id FROM form_submissions WHERE patient_thread_id = $1::uuid
         ))
    ORDER BY a.ts DESC
    LIMIT $2
    `,
    [patientId, limit]
  );

  return NextResponse.json({ success: true, data: rows, patient_id: patientId });
}

export const GET = withApiTelemetry('/api/patients/[id]/audit', GET_inner);
