// =============================================================================
// GET /api/settings/flags — return all feature flags as a flat boolean map
// 1 May 2026 (sub-sprint D.1)
//
// Used by the FeatureFlagsProvider on the client to hydrate flag state at
// app boot. Auth-required (any signed-in role) — flag values aren't
// secret but we don't expose them to anonymous traffic. Mutations happen
// through PATCH /api/admin/settings which is super_admin-gated.
//
// Cache-control: no-store. Flags can flip mid-session (admin toggle
// sub-sprint D.2) and the React Context refetches on page navigation.
// =============================================================================
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getAllFeatureFlags } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const flags = await getAllFeatureFlags();
    return NextResponse.json(
      { success: true, data: flags },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('GET /api/settings/flags error:', err);
    return NextResponse.json({ success: false, error: 'Failed to load flags' }, { status: 500 });
  }
}
