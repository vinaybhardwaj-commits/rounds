// =============================================================================
// /api/admin/pac-lookups/order-types — super_admin CRUD on pac_order_types.
//
//   GET    → list all rows (active + inactive, with hospital scoping)
//   POST   → create a new row
//   PATCH  → update label/category/sop_default_for_asa/sop_default_for_mode/active
//
// PRD D6 — admin-editable lookup table; SOP §6.2 ASA defaults editable here.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[a-z0-9_]{2,60}$/;

interface Row {
  code: string;
  label: string;
  category: string | null;
  sop_default_for_asa: number[] | null;
  sop_default_for_mode: string[] | null;
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
    `SELECT code, label, category, sop_default_for_asa, sop_default_for_mode, active,
            hospital_id::text AS hospital_id
       FROM pac_order_types
       ORDER BY hospital_id NULLS FIRST, category NULLS LAST, label`,
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
      `INSERT INTO pac_order_types (code, label, category, sop_default_for_asa, sop_default_for_mode, hospital_id)
       VALUES ($1, $2, $3, $4::int[], $5::text[], $6::uuid)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, label, category, sop_default_for_asa, sop_default_for_mode, active,
                 hospital_id::text AS hospital_id`,
      [
        body.code.trim(),
        body.label.trim(),
        body.category ?? null,
        body.sop_default_for_asa ?? null,
        body.sop_default_for_mode ?? null,
        body.hospital_id ?? null,
      ],
    );
    if (!inserted) {
      return NextResponse.json({ success: false, error: 'Code already exists' }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: inserted });
  } catch (e) {
    console.error('POST /api/admin/pac-lookups/order-types:', e);
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
      `UPDATE pac_order_types SET
         label                 = COALESCE($2, label),
         category              = COALESCE($3, category),
         sop_default_for_asa   = COALESCE($4::int[], sop_default_for_asa),
         sop_default_for_mode  = COALESCE($5::text[], sop_default_for_mode),
         active                = COALESCE($6, active)
       WHERE code = $1
       RETURNING code, label, category, sop_default_for_asa, sop_default_for_mode, active,
                 hospital_id::text AS hospital_id`,
      [
        body.code,
        body.label ?? null,
        body.category ?? null,
        body.sop_default_for_asa ?? null,
        body.sop_default_for_mode ?? null,
        body.active ?? null,
      ],
    );
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Row not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    console.error('PATCH /api/admin/pac-lookups/order-types:', e);
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
