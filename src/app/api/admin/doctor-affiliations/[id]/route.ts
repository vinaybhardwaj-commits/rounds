// =============================================================================
// /api/admin/doctor-affiliations/[id] (MH.7a)
//
// DELETE — remove a single affiliation row. Used by /admin/doctor-affiliations
// admin UI per-row "Remove" action. Tenancy: hospital_admin can only delete
// affiliations for their own hospital_id; super_admin all. Audited.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { getAdminHospitalScope, isAdminRole } from '@/lib/admin-hospital-scope';
import { audit } from '@/lib/audit';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isAdminRole(user.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden: admin role required' }, { status: 403 });
  }

  const affiliationId = params.id;
  if (!affiliationId) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

  // Look up the row first to enforce tenancy + populate audit summary.
  const row = await queryOne<{
    id: string;
    reference_doctor_id: string;
    hospital_id: string;
    doctor_name: string | null;
    hospital_slug: string | null;
  }>(
    `SELECT
       rdha.id,
       rdha.reference_doctor_id,
       rdha.hospital_id,
       rd.full_name AS doctor_name,
       h.slug       AS hospital_slug
     FROM reference_doctor_hospital_affiliations rdha
     LEFT JOIN reference_doctors rd ON rd.id = rdha.reference_doctor_id
     LEFT JOIN hospitals         h  ON h.id  = rdha.hospital_id
     WHERE rdha.id = $1::uuid`,
    [affiliationId]
  );

  // Return 404 (not 403) on miss to avoid existence-leakage per cross-cutting
  // pattern from MH.2.
  if (!row) {
    return NextResponse.json({ success: false, error: 'Affiliation not found' }, { status: 404 });
  }

  const me = await queryOne<{ primary_hospital_id: string | null }>(
    `SELECT primary_hospital_id::text AS primary_hospital_id FROM profiles WHERE id = $1::uuid`,
    [user.profileId]
  );
  const scope = await getAdminHospitalScope(user.role, me?.primary_hospital_id ?? '');
  if (!scope.hospitalIds.includes(row.hospital_id)) {
    // 404 not 403 (existence leak prevention)
    return NextResponse.json({ success: false, error: 'Affiliation not found' }, { status: 404 });
  }

  await query(
    `DELETE FROM reference_doctor_hospital_affiliations WHERE id = $1::uuid`,
    [affiliationId]
  );

  audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: row.hospital_id,
    action: 'doctor_affiliation.remove',
    targetType: 'reference_doctor_hospital_affiliation',
    targetId: affiliationId,
    summary: `Removed affiliation: ${row.doctor_name ?? 'doctor'} ↔ ${(row.hospital_slug || '').toUpperCase()}`,
    payloadBefore: {
      reference_doctor_id: row.reference_doctor_id,
      hospital_id: row.hospital_id,
    },
    request,
  }).catch((e) => console.error('[audit] doctor_affiliation.remove failed:', e));

  return NextResponse.json({ success: true });
}
