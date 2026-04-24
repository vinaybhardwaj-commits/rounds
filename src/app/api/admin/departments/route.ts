// ============================================
// GET /api/admin/departments
// POST /api/admin/departments
// PATCH /api/admin/departments
// DELETE /api/admin/departments
//
// Admin CRUD for the departments table. Sprint 4-prep — needed so V can
// stand up EHBR (or EHIN) departments via UI instead of raw SQL.
//
// GET: list with hospital_slug + member counts.
// POST: create new dept (hospital_id, name, slug, head_profile_id?).
// PATCH: rename / change head / toggle is_active.
// DELETE: hard delete only if no cases / channels reference it (else 409).
//
// Access: super_admin only.
//
// Sprint 4 prep (24 April 2026).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{1,40}$/;

interface DepartmentRow {
  id: string;
  hospital_id: string;
  hospital_slug: string;
  name: string;
  slug: string;
  head_profile_id: string | null;
  head_name: string | null;
  is_active: boolean;
  member_count: number;
  created_at: string;
}

async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Unauthorized', status: 401 as const };
  if (user.role !== 'super_admin') return { error: 'super_admin required', status: 403 as const };
  return { user };
}

export async function GET() {
  try {
    const r = await requireSuperAdmin();
    if ('error' in r) return NextResponse.json({ success: false, error: r.error }, { status: r.status });

    const rows = await query<DepartmentRow>(
      `
      SELECT
        d.id, d.hospital_id, h.slug AS hospital_slug,
        d.name, d.slug, d.head_profile_id, p.full_name AS head_name,
        d.is_active,
        (SELECT COUNT(*)::int FROM profiles pp WHERE pp.department_id = d.id) AS member_count,
        d.created_at
      FROM departments d
      JOIN hospitals h ON h.id = d.hospital_id
      LEFT JOIN profiles p ON p.id = d.head_profile_id
      ORDER BY h.slug, d.name
      `,
      []
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('GET /api/admin/departments error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load', detail: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const r = await requireSuperAdmin();
    if ('error' in r) return NextResponse.json({ success: false, error: r.error }, { status: r.status });

    const body = (await request.json()) as {
      hospital_id?: string;
      name?: string;
      slug?: string;
      head_profile_id?: string | null;
    };

    if (!body.hospital_id || !UUID_RE.test(body.hospital_id)) {
      return NextResponse.json({ success: false, error: 'hospital_id (UUID) required' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return NextResponse.json({ success: false, error: 'name required, max 100 chars' }, { status: 400 });
    }
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug || !SLUG_RE.test(slug)) {
      return NextResponse.json(
        { success: false, error: 'slug required (lowercase letters/digits/hyphens, starts with letter, 2-41 chars)' },
        { status: 400 }
      );
    }

    // Slug is global — verify no collision across hospitals (channel ids embed slug).
    const collide = await queryOne<{ id: string }>(
      `SELECT id FROM departments WHERE slug = $1`,
      [slug]
    );
    if (collide) {
      return NextResponse.json(
        { success: false, error: `Slug "${slug}" is already in use. Channel IDs derive from slug+hospital, so it must be globally unique.` },
        { status: 409 }
      );
    }

    const inserted = await queryOne<{ id: string }>(
      `
      INSERT INTO departments (hospital_id, name, slug, head_profile_id, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id
      `,
      [body.hospital_id, name, slug, body.head_profile_id ?? null]
    );

    return NextResponse.json({ success: true, data: { id: inserted?.id ?? null } });
  } catch (error) {
    console.error('POST /api/admin/departments error:', error);
    return NextResponse.json(
      { success: false, error: 'Create failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const r = await requireSuperAdmin();
    if ('error' in r) return NextResponse.json({ success: false, error: r.error }, { status: r.status });

    const body = (await request.json()) as {
      id?: string;
      name?: string;
      head_profile_id?: string | null;
      is_active?: boolean;
    };

    if (!body.id || !UUID_RE.test(body.id)) {
      return NextResponse.json({ success: false, error: 'id (UUID) required' }, { status: 400 });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) {
      const n = body.name.trim();
      if (!n || n.length > 100) return NextResponse.json({ success: false, error: 'name max 100 chars' }, { status: 400 });
      sets.push(`name = $${i++}`);
      vals.push(n);
    }
    if ('head_profile_id' in body) {
      sets.push(`head_profile_id = $${i++}`);
      vals.push(body.head_profile_id);
    }
    if (typeof body.is_active === 'boolean') {
      sets.push(`is_active = $${i++}`);
      vals.push(body.is_active);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    vals.push(body.id);
    await query(
      `UPDATE departments SET ${sets.join(', ')} WHERE id = $${i}`,
      vals
    );

    return NextResponse.json({ success: true, data: { id: body.id, updated_fields: sets.length } });
  } catch (error) {
    console.error('PATCH /api/admin/departments error:', error);
    return NextResponse.json(
      { success: false, error: 'Update failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const r = await requireSuperAdmin();
    if ('error' in r) return NextResponse.json({ success: false, error: r.error }, { status: r.status });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || '';
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: 'id (UUID) query param required' }, { status: 400 });
    }

    // Block delete if any profiles still reference this department.
    const refs = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM profiles WHERE department_id = $1`,
      [id]
    );
    if ((refs?.n ?? 0) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot delete: ${refs?.n} profile(s) still reference this department. Reassign them first.`,
          referenced_by: refs?.n,
        },
        { status: 409 }
      );
    }

    await query(`DELETE FROM departments WHERE id = $1`, [id]);
    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/admin/departments error:', error);
    return NextResponse.json(
      { success: false, error: 'Delete failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
