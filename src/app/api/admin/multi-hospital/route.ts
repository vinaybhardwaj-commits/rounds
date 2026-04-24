// ============================================
// GET /api/admin/multi-hospital
// POST /api/admin/multi-hospital
//
// Combined endpoint for multi-hospital admin: user_hospital_access grants
// + doctor_hospital_affiliations + role_scope toggles. super_admin only.
//
// GET response:
//   { hospitals: [...], profiles: [...], grants: [...], affiliations: [...] }
//
// POST body — discriminated union:
//   { action: 'grant_access', profile_id, hospital_id }
//   { action: 'revoke_access', grant_id }
//   { action: 'add_affiliation', profile_id, hospital_id, is_primary }
//   { action: 'set_primary_affiliation', affiliation_id }   // toggles partial unique idx_dha_one_primary_per_doctor
//   { action: 'remove_affiliation', affiliation_id }
//   { action: 'set_role_scope', profile_id, role_scope: 'central'|'hospital_bound'|'multi_hospital' }
//
// All mutations are recorded with granted_by / created_by where the schema
// supports it. Sprint 3.5 (24 April 2026).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_SCOPES = new Set(['central', 'hospital_bound', 'multi_hospital']);

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  role_scope: string | null;
  primary_hospital_id: string | null;
  primary_hospital_slug: string | null;
}

interface HospitalRow {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
}

interface GrantRow {
  id: string;
  profile_id: string;
  hospital_id: string;
  granted_at: string;
  granted_by: string | null;
  profile_name: string | null;
  hospital_slug: string;
  granter_name: string | null;
}

interface AffiliationRow {
  id: string;
  profile_id: string;
  hospital_id: string;
  is_primary: boolean;
  created_at: string;
  profile_name: string | null;
  hospital_slug: string;
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

    const [hospitals, profiles, grants, affiliations] = await Promise.all([
      query<HospitalRow>(
        `SELECT id, slug, name, is_active FROM hospitals ORDER BY is_active DESC, slug ASC`,
        []
      ),
      query<ProfileRow>(
        `
        SELECT p.id, p.full_name, p.email, p.role, p.role_scope, p.primary_hospital_id,
               h.slug AS primary_hospital_slug
        FROM profiles p
        LEFT JOIN hospitals h ON h.id = p.primary_hospital_id
        WHERE p.status = 'active'
        ORDER BY p.full_name NULLS LAST, p.email
        `,
        []
      ),
      query<GrantRow>(
        `
        SELECT uha.id, uha.profile_id, uha.hospital_id, uha.granted_at, uha.granted_by,
               p.full_name AS profile_name,
               h.slug AS hospital_slug,
               g.full_name AS granter_name
        FROM user_hospital_access uha
        JOIN profiles p ON p.id = uha.profile_id
        JOIN hospitals h ON h.id = uha.hospital_id
        LEFT JOIN profiles g ON g.id = uha.granted_by
        ORDER BY uha.granted_at DESC
        `,
        []
      ),
      query<AffiliationRow>(
        `
        SELECT dha.id, dha.profile_id, dha.hospital_id, dha.is_primary, dha.created_at,
               p.full_name AS profile_name,
               h.slug AS hospital_slug
        FROM doctor_hospital_affiliations dha
        JOIN profiles p ON p.id = dha.profile_id
        JOIN hospitals h ON h.id = dha.hospital_id
        ORDER BY p.full_name NULLS LAST, h.slug
        `,
        []
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: { hospitals, profiles, grants, affiliations },
      counts: {
        hospitals: hospitals.length,
        profiles: profiles.length,
        grants: grants.length,
        affiliations: affiliations.length,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/multi-hospital error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load', detail: (error as Error).message },
      { status: 500 }
    );
  }
}

interface PostBody {
  action?: string;
  profile_id?: string;
  hospital_id?: string;
  grant_id?: string;
  affiliation_id?: string;
  is_primary?: boolean;
  role_scope?: string;
}

export async function POST(request: NextRequest) {
  try {
    const r = await requireSuperAdmin();
    if ('error' in r) return NextResponse.json({ success: false, error: r.error }, { status: r.status });
    const user = r.user;

    const body = (await request.json()) as PostBody;
    const action = body.action;

    if (action === 'grant_access') {
      if (!body.profile_id || !UUID_RE.test(body.profile_id)) {
        return NextResponse.json({ success: false, error: 'profile_id (UUID) required' }, { status: 400 });
      }
      if (!body.hospital_id || !UUID_RE.test(body.hospital_id)) {
        return NextResponse.json({ success: false, error: 'hospital_id (UUID) required' }, { status: 400 });
      }
      // Idempotent: dedup on (profile_id, hospital_id)
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM user_hospital_access WHERE profile_id = $1 AND hospital_id = $2`,
        [body.profile_id, body.hospital_id]
      );
      if (existing) {
        return NextResponse.json({ success: true, data: { id: existing.id, already: true } });
      }
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO user_hospital_access (profile_id, hospital_id, granted_at, granted_by)
         VALUES ($1, $2, NOW(), $3) RETURNING id`,
        [body.profile_id, body.hospital_id, user.profileId]
      );
      return NextResponse.json({ success: true, data: { id: inserted?.id, already: false } });
    }

    if (action === 'revoke_access') {
      if (!body.grant_id || !UUID_RE.test(body.grant_id)) {
        return NextResponse.json({ success: false, error: 'grant_id (UUID) required' }, { status: 400 });
      }
      await query(`DELETE FROM user_hospital_access WHERE id = $1`, [body.grant_id]);
      return NextResponse.json({ success: true, data: { id: body.grant_id, deleted: true } });
    }

    if (action === 'add_affiliation') {
      if (!body.profile_id || !UUID_RE.test(body.profile_id)) {
        return NextResponse.json({ success: false, error: 'profile_id (UUID) required' }, { status: 400 });
      }
      if (!body.hospital_id || !UUID_RE.test(body.hospital_id)) {
        return NextResponse.json({ success: false, error: 'hospital_id (UUID) required' }, { status: 400 });
      }
      const isPrimary = body.is_primary === true;
      // Partial unique idx_dha_one_primary_per_doctor enforces one is_primary=true per doctor.
      // If we're inserting a new primary, demote any existing primary for this doctor first.
      if (isPrimary) {
        await query(
          `UPDATE doctor_hospital_affiliations SET is_primary = false WHERE profile_id = $1 AND is_primary = true`,
          [body.profile_id]
        );
      }
      const existing = await queryOne<{ id: string; is_primary: boolean }>(
        `SELECT id, is_primary FROM doctor_hospital_affiliations WHERE profile_id = $1 AND hospital_id = $2`,
        [body.profile_id, body.hospital_id]
      );
      if (existing) {
        if (existing.is_primary !== isPrimary) {
          await query(
            `UPDATE doctor_hospital_affiliations SET is_primary = $1 WHERE id = $2`,
            [isPrimary, existing.id]
          );
        }
        return NextResponse.json({ success: true, data: { id: existing.id, already: true, is_primary: isPrimary } });
      }
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO doctor_hospital_affiliations (profile_id, hospital_id, is_primary)
         VALUES ($1, $2, $3) RETURNING id`,
        [body.profile_id, body.hospital_id, isPrimary]
      );
      return NextResponse.json({ success: true, data: { id: inserted?.id, is_primary: isPrimary } });
    }

    if (action === 'set_primary_affiliation') {
      if (!body.affiliation_id || !UUID_RE.test(body.affiliation_id)) {
        return NextResponse.json({ success: false, error: 'affiliation_id (UUID) required' }, { status: 400 });
      }
      const target = await queryOne<{ id: string; profile_id: string }>(
        `SELECT id, profile_id FROM doctor_hospital_affiliations WHERE id = $1`,
        [body.affiliation_id]
      );
      if (!target) return NextResponse.json({ success: false, error: 'Affiliation not found' }, { status: 404 });
      // Demote others, promote target.
      await query(
        `UPDATE doctor_hospital_affiliations SET is_primary = false WHERE profile_id = $1 AND id <> $2`,
        [target.profile_id, target.id]
      );
      await query(
        `UPDATE doctor_hospital_affiliations SET is_primary = true WHERE id = $1`,
        [target.id]
      );
      return NextResponse.json({ success: true, data: { id: target.id, is_primary: true } });
    }

    if (action === 'remove_affiliation') {
      if (!body.affiliation_id || !UUID_RE.test(body.affiliation_id)) {
        return NextResponse.json({ success: false, error: 'affiliation_id (UUID) required' }, { status: 400 });
      }
      await query(`DELETE FROM doctor_hospital_affiliations WHERE id = $1`, [body.affiliation_id]);
      return NextResponse.json({ success: true, data: { id: body.affiliation_id, deleted: true } });
    }

    if (action === 'set_role_scope') {
      if (!body.profile_id || !UUID_RE.test(body.profile_id)) {
        return NextResponse.json({ success: false, error: 'profile_id (UUID) required' }, { status: 400 });
      }
      if (!body.role_scope || !VALID_SCOPES.has(body.role_scope)) {
        return NextResponse.json(
          { success: false, error: `role_scope must be one of: ${[...VALID_SCOPES].join(', ')}` },
          { status: 400 }
        );
      }
      await query(
        `UPDATE profiles SET role_scope = $1, updated_at = NOW() WHERE id = $2`,
        [body.role_scope, body.profile_id]
      );
      return NextResponse.json({ success: true, data: { profile_id: body.profile_id, role_scope: body.role_scope } });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    console.error('POST /api/admin/multi-hospital error:', error);
    return NextResponse.json(
      { success: false, error: 'Action failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
