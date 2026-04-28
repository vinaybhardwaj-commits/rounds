// =============================================================================
// /api/admin/pac-lookups/clearance-specialties — super_admin CRUD on pac_clearance_specialties.
// PRD D7 — admin-editable; SOP §6.3 comorbidity triggers editable here.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[a-z0-9_]{2,60}$/;

interface Row {
  code: string;
  label: string;
  default_assignee_role: string;
  sop_trigger_comorbidities: string[] | null;
  active: boolean;
  hospital_id: string | null;
}

async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  if (user.role !== 'super_admin') {
    return { error: NextResponse.json({ success: false, error: 'Forbidden: super_admin required' }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;
  const rows = await query<Row>(
    `SELECT code, label, default_assignee_role, sop_trigger_comorbidities, active,
            hospital_id::text AS hospital_id
       FROM pac_clearance_specialties
       ORDER BY hospital_id NULLS FIRST, label`,
  );
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;
  try {
    const body = (await request.json()) as Partial<Row>;
    if (!body.code || !CODE_RE.test(body.code)) {
      return NextResponse.json({ success: false, error: 'code must be snake_case 2-60 chars' }, { status: 400 });
    }
    if (!body.label || body.label.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'label required' }, { status: 400 });
    }
    const inserted = await queryOne<Row>(
      `INSERT INTO pac_clearance_specialties (code, label, default_assignee_role, sop_trigger_comorbidities, hospital_id)
       VALUES ($1, $2, COALESCE($3, 'specialist'), $4::text[], $5::uuid)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, label, default_assignee_role, sop_trigger_comorbidities, active,
                 hospital_id::text AS hospital_id`,
      [
        body.code.trim(),
        body.label.trim(),
        body.default_assignee_role ?? null,
        body.sop_trigger_comorbidities ?? null,
        body.hospital_id ?? null,
      ],
    );
    if (!inserted) {
      return NextResponse.json({ success: false, error: 'Code already exists' }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: inserted });
  } catch (e) {
    console.error('POST /api/admin/pac-lookups/clearance-specialties:', e);
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;
  try {
    const body = (await request.json()) as Partial<Row> & { code: string };
    if (!body.code) {
      return NextResponse.json({ success: false, error: 'code required' }, { status: 400 });
    }
    const updated = await queryOne<Row>(
      `UPDATE pac_clearance_specialties SET
         label                     = COALESCE($2, label),
         default_assignee_role     = COALESCE($3, default_assignee_role),
         sop_trigger_comorbidities = COALESCE($4::text[], sop_trigger_comorbidities),
         active                    = COALESCE($5, active)
       WHERE code = $1
       RETURNING code, label, default_assignee_role, sop_trigger_comorbidities, active,
                 hospital_id::text AS hospital_id`,
      [
        body.code,
        body.label ?? null,
        body.default_assignee_role ?? null,
        body.sop_trigger_comorbidities ?? null,
        body.active ?? null,
      ],
    );
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Row not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    console.error('PATCH /api/admin/pac-lookups/clearance-specialties:', e);
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
