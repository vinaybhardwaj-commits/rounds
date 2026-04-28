// =============================================================================
// /api/admin/pac-lookups/checklist-templates — super_admin CRUD on pac_checklist_templates.
// PRD D8 — admin-editable mode-specific checklist templates.
//
// Items are stored as a JSONB array; the admin page sends the full items_json
// array on each PATCH (no per-item granular update — keeps the API simple
// since templates are short).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[a-z0-9_]{2,80}$/;
const VALID_MODES = new Set(['in_person_opd', 'bedside', 'telephonic', 'paper_screening']);

interface Row {
  code: string;
  pac_mode: string;
  items_json: unknown;
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
    `SELECT code, pac_mode, items_json, active, hospital_id::text AS hospital_id
       FROM pac_checklist_templates
       ORDER BY hospital_id NULLS FIRST, pac_mode, code`,
  );
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;
  try {
    const body = (await request.json()) as Partial<Row>;
    if (!body.code || !CODE_RE.test(body.code)) {
      return NextResponse.json({ success: false, error: 'code must be snake_case 2-80 chars' }, { status: 400 });
    }
    if (!body.pac_mode || !VALID_MODES.has(body.pac_mode)) {
      return NextResponse.json({ success: false, error: 'pac_mode required (in_person_opd|bedside|telephonic|paper_screening)' }, { status: 400 });
    }
    if (!Array.isArray(body.items_json)) {
      return NextResponse.json({ success: false, error: 'items_json must be an array' }, { status: 400 });
    }
    const inserted = await queryOne<Row>(
      `INSERT INTO pac_checklist_templates (code, pac_mode, items_json, hospital_id)
       VALUES ($1, $2, $3::jsonb, $4::uuid)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, pac_mode, items_json, active, hospital_id::text AS hospital_id`,
      [body.code.trim(), body.pac_mode, JSON.stringify(body.items_json), body.hospital_id ?? null],
    );
    if (!inserted) return NextResponse.json({ success: false, error: 'Code already exists' }, { status: 409 });
    return NextResponse.json({ success: true, data: inserted });
  } catch (e) {
    console.error('POST pac-lookups/checklist-templates:', e);
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;
  try {
    const body = (await request.json()) as Partial<Row> & { code: string };
    if (!body.code) return NextResponse.json({ success: false, error: 'code required' }, { status: 400 });
    if (body.items_json !== undefined && !Array.isArray(body.items_json)) {
      return NextResponse.json({ success: false, error: 'items_json must be an array' }, { status: 400 });
    }
    if (body.pac_mode !== undefined && !VALID_MODES.has(body.pac_mode)) {
      return NextResponse.json({ success: false, error: 'invalid pac_mode' }, { status: 400 });
    }
    const updated = await queryOne<Row>(
      `UPDATE pac_checklist_templates SET
         pac_mode    = COALESCE($2, pac_mode),
         items_json  = COALESCE($3::jsonb, items_json),
         active      = COALESCE($4, active)
       WHERE code = $1
       RETURNING code, pac_mode, items_json, active, hospital_id::text AS hospital_id`,
      [
        body.code,
        body.pac_mode ?? null,
        body.items_json ? JSON.stringify(body.items_json) : null,
        body.active ?? null,
      ],
    );
    if (!updated) return NextResponse.json({ success: false, error: 'Row not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    console.error('PATCH pac-lookups/checklist-templates:', e);
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
