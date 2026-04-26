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
import { withApiTelemetry } from '@/lib/api-telemetry';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

async function GET_inner() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    // 26 Apr 2026 follow-up FU7: surface ot_room_count so the OT calendar can
    // honour per-hospital configuration without hardcoding 3.
    const rows = await query<{ id: string; slug: string; name: string; ot_room_count: number }>(
      `SELECT id, slug, name, COALESCE(ot_room_count, 3) AS ot_room_count
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

// AP.3 — telemetry-wrapped exports (auto-applied)
export const GET = withApiTelemetry('/api/hospitals/accessible', GET_inner);
