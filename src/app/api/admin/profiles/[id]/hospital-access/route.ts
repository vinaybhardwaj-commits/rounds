// =============================================================================
// /api/admin/profiles/[id]/hospital-access (MH.7d)
//
// Inline grant-list manager for multi_hospital users. Reads + writes the
// user_hospital_access table (the M2M used by user_accessible_hospital_ids()
// SQL function for multi_hospital scope users).
//
// GET   — list current grants for this user (returns HospitalChip-renderable
//         rows: hospital_id, slug, short_name, name + grant id + granted_at).
// POST  — grant access to a new hospital. Body: { hospital_id }. Idempotent
//         via UNIQUE(profile_id, hospital_id) — duplicate insert returns 409.
//
// Auth: super_admin only. (department_head + hospital_admin can't grant
// cross-hospital access — that's a deliberate scope decision; only the system
// owner can expand someone's access.)
//
// Audited: user_hospital_access.grant + .revoke audit actions.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

interface GrantRow {
  id: string;
  hospital_id: string;
  hospital_slug: string;
  hospital_short_name: string | null;
  hospital_name: string;
  granted_at: string;
  granted_by: string | null;
  granted_by_name: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
  }
  const { id: profileId } = await params;

  // Verify the profile exists (404 vs returning empty list).
  const profile = await queryOne<{ id: string }>(
    `SELECT id::text FROM profiles WHERE id = $1::uuid`,
    [profileId]
  );
  if (!profile) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
  }

  const rows = await query<GrantRow>(
    `SELECT
       uha.id::text,
       uha.hospital_id::text,
       h.slug          AS hospital_slug,
       h.short_name    AS hospital_short_name,
       h.name          AS hospital_name,
       uha.granted_at::text,
       uha.granted_by::text,
       p.full_name     AS granted_by_name
     FROM user_hospital_access uha
     JOIN hospitals h ON h.id = uha.hospital_id
     LEFT JOIN profiles p ON p.id = uha.granted_by
     WHERE uha.profile_id = $1::uuid
     ORDER BY h.slug`,
    [profileId]
  );

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
  }
  const { id: profileId } = await params;

  let body: { hospital_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const { hospital_id } = body;
  if (!hospital_id) {
    return NextResponse.json({ success: false, error: 'hospital_id is required' }, { status: 400 });
  }

  // Verify both ends exist.
  const profile = await queryOne<{ full_name: string | null }>(
    `SELECT full_name FROM profiles WHERE id = $1::uuid`,
    [profileId]
  );
  if (!profile) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
  }
  const hospital = await queryOne<{ slug: string; is_active: boolean }>(
    `SELECT slug, is_active FROM hospitals WHERE id = $1::uuid`,
    [hospital_id]
  );
  if (!hospital) {
    return NextResponse.json({ success: false, error: 'hospital_id not found' }, { status: 404 });
  }
  if (!hospital.is_active) {
    return NextResponse.json(
      { success: false, error: `Hospital ${hospital.slug.toUpperCase()} is not active. Activate it first or pick a different one.` },
      { status: 400 }
    );
  }

  // INSERT — UNIQUE catches duplicate.
  let inserted: { id: string } | null = null;
  try {
    inserted = await queryOne<{ id: string }>(
      `INSERT INTO user_hospital_access (profile_id, hospital_id, granted_at, granted_by)
       VALUES ($1::uuid, $2::uuid, NOW(), $3::uuid)
       RETURNING id::text`,
      [profileId, hospital_id, user.profileId]
    );
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.toLowerCase().includes('unique') || msg.includes('user_hospital_access_profile_id_hospital_id_key')) {
      return NextResponse.json(
        { success: false, error: 'This user already has access to that hospital' },
        { status: 409 }
      );
    }
    throw e;
  }

  if (!inserted) {
    return NextResponse.json({ success: false, error: 'Insert failed' }, { status: 500 });
  }

  audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: hospital_id,
    action: 'user_hospital_access.grant',
    targetType: 'user_hospital_access',
    targetId: inserted.id,
    summary: `Granted ${hospital.slug.toUpperCase()} access to ${profile.full_name ?? 'user'}`,
    payloadAfter: { profile_id: profileId, hospital_id },
    request,
  }).catch((e) => console.error('[audit] user_hospital_access.grant failed:', e));

  return NextResponse.json({ success: true, data: { id: inserted.id } }, { status: 201 });
}
