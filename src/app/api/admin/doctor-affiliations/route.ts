// =============================================================================
// /api/admin/doctor-affiliations (MH.7a)
//
// GET   — list reference_doctor × hospital affiliations, scope-filtered
//         by getAdminHospitalScope (super_admin all; hospital_admin only
//         their hospital's affiliations). Optional q (doctor name search).
// POST  — add an affiliation (admin UI "+ Add affiliation" action).
//         Body: { reference_doctor_id, hospital_id, is_primary?: boolean }.
//         UNIQUE(doctor_id, hospital_id) → 409 on duplicate.
//
// Auth: requires admin role (super_admin / department_head / hospital_admin)
// per isAdminRole. Per-row tenancy via getAdminHospitalScope — hospital_admin
// can only add affiliations to their own primary_hospital_id.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { getAdminHospitalScope, isAdminRole } from '@/lib/admin-hospital-scope';
import { audit } from '@/lib/audit';

interface AffiliationRow {
  id: string;
  reference_doctor_id: string;
  doctor_full_name: string | null;
  doctor_specialty: string | null;
  hospital_id: string;
  hospital_slug: string;
  hospital_short_name: string | null;
  hospital_name: string;
  is_primary: boolean;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isAdminRole(user.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden: admin role required' }, { status: 403 });
  }

  const me = await queryOne<{ primary_hospital_id: string | null }>(
    `SELECT primary_hospital_id::text AS primary_hospital_id FROM profiles WHERE id = $1::uuid`,
    [user.profileId]
  );
  const scope = await getAdminHospitalScope(user.role, me?.primary_hospital_id ?? '');
  if (scope.hospitalIds.length === 0) {
    return NextResponse.json({ success: true, data: [], scope: scope.role });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500);

  const params: unknown[] = [scope.hospitalIds];
  let where = `rdha.hospital_id = ANY($1::uuid[])`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND rd.full_name ILIKE $${params.length}`;
  }
  params.push(limit);

  const rows = await query<AffiliationRow>(
    `SELECT
       rdha.id,
       rdha.reference_doctor_id,
       rd.full_name      AS doctor_full_name,
       rd.specialty      AS doctor_specialty,
       rdha.hospital_id,
       h.slug            AS hospital_slug,
       h.short_name      AS hospital_short_name,
       h.name            AS hospital_name,
       rdha.is_primary,
       rdha.created_at::text AS created_at,
       rdha.created_by,
       p.full_name       AS created_by_name
     FROM reference_doctor_hospital_affiliations rdha
     JOIN reference_doctors rd ON rd.id = rdha.reference_doctor_id
     JOIN hospitals         h  ON h.id  = rdha.hospital_id
     LEFT JOIN profiles     p  ON p.id  = rdha.created_by
     WHERE ${where}
     ORDER BY rd.full_name, h.slug
     LIMIT $${params.length}`,
    params
  );

  return NextResponse.json({ success: true, data: rows, scope: scope.role });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isAdminRole(user.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden: admin role required' }, { status: 403 });
  }

  let body: { reference_doctor_id?: string; hospital_id?: string; is_primary?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { reference_doctor_id, hospital_id, is_primary } = body;
  if (!reference_doctor_id || !hospital_id) {
    return NextResponse.json(
      { success: false, error: 'reference_doctor_id and hospital_id are required' },
      { status: 400 }
    );
  }

  // Tenancy: hospital_admin can only add affiliations to their own hospital.
  const me = await queryOne<{ primary_hospital_id: string | null }>(
    `SELECT primary_hospital_id::text AS primary_hospital_id FROM profiles WHERE id = $1::uuid`,
    [user.profileId]
  );
  const scope = await getAdminHospitalScope(user.role, me?.primary_hospital_id ?? '');
  if (!scope.hospitalIds.includes(hospital_id)) {
    return NextResponse.json(
      { success: false, error: 'hospital_id is outside your admin scope', field: 'hospital_id' },
      { status: 403 }
    );
  }

  // Verify both ends exist before INSERT.
  const doctor = await queryOne<{ full_name: string | null }>(
    `SELECT full_name FROM reference_doctors WHERE id = $1::uuid`,
    [reference_doctor_id]
  );
  if (!doctor) {
    return NextResponse.json({ success: false, error: 'reference_doctor_id not found' }, { status: 404 });
  }
  const hospital = await queryOne<{ slug: string }>(
    `SELECT slug FROM hospitals WHERE id = $1::uuid`,
    [hospital_id]
  );
  if (!hospital) {
    return NextResponse.json({ success: false, error: 'hospital_id not found' }, { status: 404 });
  }

  // INSERT — UNIQUE constraint catches duplicate.
  let inserted: { id: string } | null = null;
  try {
    inserted = await queryOne<{ id: string }>(
      `INSERT INTO reference_doctor_hospital_affiliations
         (reference_doctor_id, hospital_id, is_primary, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
       RETURNING id`,
      [reference_doctor_id, hospital_id, is_primary === true, user.profileId]
    );
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('ux_rdha_doctor_hospital') || msg.toLowerCase().includes('unique')) {
      return NextResponse.json(
        { success: false, error: 'Affiliation already exists for this doctor + hospital' },
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
    action: 'doctor_affiliation.add',
    targetType: 'reference_doctor_hospital_affiliation',
    targetId: inserted.id,
    summary: `Added affiliation: ${doctor.full_name ?? 'doctor'} ↔ ${hospital.slug.toUpperCase()}`,
    payloadAfter: { reference_doctor_id, hospital_id, is_primary: is_primary === true },
    request,
  }).catch((e) => console.error('[audit] doctor_affiliation.add failed:', e));

  return NextResponse.json(
    { success: true, data: { id: inserted.id } },
    { status: 201 }
  );
}
