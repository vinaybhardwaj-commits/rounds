// =============================================================================
// GET /api/hospitals/accessible
//
// Returns the hospitals visible to the calling user via
// user_accessible_hospital_ids(). Lightweight payload — id, slug, name.
//
// Used by the EquipmentRequestModal to populate the (rare) hospital picker
// when a request is being filed without a case context AND the user has
// access to multiple hospitals.
// =============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const rows = await query<{ id: string; slug: string; name: string }>(
      `SELECT id, slug, name
         FROM hospitals
        WHERE id = ANY(user_accessible_hospital_ids($1::UUID))
        ORDER BY name`,
      [user.profileId]
    );
    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('GET /api/hospitals/accessible error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list accessible hospitals' },
      { status: 500 }
    );
  }
}
