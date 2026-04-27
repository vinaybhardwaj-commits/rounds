// =============================================================================
// GET /api/undo/recent — list current user's recent undoable actions
//
// GLASS.9 — backs the UndoBanner component. Returns audit_log rows where
// the user is the actor, action ∈ UNDOABLE_ACTIONS (6), ts > now()-24h, and
// no <action>.undo row already exists for the same target.
//
// Response shape:
//   { success: true, data: [{ id, action, summary, ts, expires_at, target_type, target_id }] }
//
// Tenancy isn't enforced here because we filter by actor_id (the user's own
// rows). Hospital_id passes through for the banner to render context.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listRecentUndoable } from '@/lib/undo-inverses';

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await listRecentUndoable(user.profileId, 5);

    const data = rows.map(r => {
      const ts = new Date(r.ts);
      const expiresAt = new Date(ts.getTime() + 24 * 60 * 60 * 1000);
      return {
        id: r.id,
        action: r.action,
        summary: r.summary,
        ts: r.ts,
        expires_at: expiresAt.toISOString(),
        target_type: r.target_type,
        target_id: r.target_id,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/undo/recent error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list undoable actions', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
