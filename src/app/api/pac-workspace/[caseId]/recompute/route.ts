// =============================================================================
// POST /api/pac-workspace/[caseId]/recompute   (PCW2.3)
//
// Manual recompute trigger — coordinator + super_admin per PRD §5.4.
// Other recompute paths are post-submit hooks (forms route + ot-booking
// route) that call runAndPersist directly without going through this
// endpoint.
//
// Latency budget: <500ms. Returns a summary the UI can show in a toast.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { runAndPersist } from '@/lib/pac-workspace/engine-persistence';
import { audit } from '@/lib/audit';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Mirrors PAC_WRITE_ROLES from existing PAC v1 routes; super_admin passes
// via hasRole() per src/lib/roles.ts universal-pass policy.
const RECOMPUTE_ROLES = ['ip_coordinator', 'pac_coordinator', 'anesthesiologist'] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, RECOMPUTE_ROLES)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden — coordinator / anaesthesiologist / super_admin only' },
        { status: 403 }
      );
    }

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    // Tenancy check — case must be visible to the user.
    const exists = await queryOne<{ id: string; hospital_id: string }>(
      `SELECT id, hospital_id
         FROM surgical_cases
        WHERE id = $1
          AND archived_at IS NULL
          AND hospital_id = ANY(user_accessible_hospital_ids($2::UUID))`,
      [caseId, user.profileId]
    );
    if (!exists) {
      return NextResponse.json(
        { success: false, error: 'Case not found or access denied' },
        { status: 404 }
      );
    }

    const result = await runAndPersist(caseId, { trigger: 'manual_recompute' });

    // Audit so the recompute history is reviewable. Best-effort (regular mode).
    audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: exists.hospital_id,
      action: 'pac.suggestion.recompute',
      targetType: 'surgical_case',
      targetId: caseId,
      summary: `Manual recompute fired ${result.fired} rules; +${result.inserted} new, ${result.superseded} superseded, ${result.autoDismissed} auto-dismissed`,
      payloadAfter: {
        fired: result.fired,
        inserted: result.inserted,
        superseded: result.superseded,
        autoDismissed: result.autoDismissed,
        asaInferred: result.asaInferred,
        durationMs: result.durationMs,
      },
      request,
    }).catch((e) =>
      console.error('[audit] pac.suggestion.recompute failed (non-fatal):', e)
    );

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/pac-workspace/[caseId]/recompute error:', err);
    return NextResponse.json(
      { success: false, error: 'Recompute failed' },
      { status: 500 }
    );
  }
}
