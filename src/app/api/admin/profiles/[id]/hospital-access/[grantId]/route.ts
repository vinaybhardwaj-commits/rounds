// =============================================================================
// /api/admin/profiles/[id]/hospital-access/[grantId] (MH.7d)
//
// DELETE — revoke a single grant. Auth: super_admin only. Audited.
// 404 not 403 on miss (existence-leak prevention pattern).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; grantId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
  }
  const { id: profileId, grantId } = await params;

  // Look up grant first for tenancy + audit.
  const row = await queryOne<{
    id: string;
    profile_id: string;
    hospital_id: string;
    profile_name: string | null;
    hospital_slug: string | null;
  }>(
    `SELECT
       uha.id::text,
       uha.profile_id::text,
       uha.hospital_id::text,
       p.full_name AS profile_name,
       h.slug      AS hospital_slug
     FROM user_hospital_access uha
     LEFT JOIN profiles p ON p.id = uha.profile_id
     LEFT JOIN hospitals h ON h.id = uha.hospital_id
     WHERE uha.id = $1::uuid`,
    [grantId]
  );

  // Existence-leak prevention: 404 on miss OR scoped-out OR mismatched profile.
  if (!row || row.profile_id !== profileId) {
    return NextResponse.json({ success: false, error: 'Grant not found' }, { status: 404 });
  }

  await query(
    `DELETE FROM user_hospital_access WHERE id = $1::uuid`,
    [grantId]
  );

  audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: row.hospital_id,
    action: 'user_hospital_access.revoke',
    targetType: 'user_hospital_access',
    targetId: grantId,
    summary: `Revoked ${(row.hospital_slug || '').toUpperCase()} access from ${row.profile_name ?? 'user'}`,
    payloadBefore: { profile_id: row.profile_id, hospital_id: row.hospital_id },
    request,
  }).catch((e) => console.error('[audit] user_hospital_access.revoke failed:', e));

  return NextResponse.json({ success: true });
}
