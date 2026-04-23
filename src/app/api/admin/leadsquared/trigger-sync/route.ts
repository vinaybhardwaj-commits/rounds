// ============================================
// POST /api/admin/leadsquared/trigger-sync
//
// Admin-authenticated manual sync trigger.
// Super_admin only. Replaces the broken direct
// call to /api/integrations/leadsquared/sync
// from the admin UI (which required CRON_SECRET
// and could never be called from the browser).
//
// Calls syncLeadsByStage() directly — same code
// path the cron uses internally — so no shared
// secret is needed.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { syncLeadsByStage } from '@/lib/lsq-sync';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden — super_admin only' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const stage = typeof body.stage === 'string' ? body.stage : null;
    const enrich = body.enrichFromActivities !== false;

    const stages = stage ? [stage] : ['OPD WIN', 'IPD WIN'];
    const results: Array<{
      stage: string;
      leadsFound: number;
      leadsCreated: number;
      leadsUpdated: number;
      leadsSkipped: number;
      errors: string[];
      durationMs: number;
    }> = [];

    for (const s of stages) {
      console.log(`[LSQ Admin Sync] Triggered by ${user.email} for stage=${s}`);
      const r = await syncLeadsByStage(s, 'manual', {
        enrichFromActivities: enrich,
      });
      results.push({
        stage: s,
        leadsFound: r.leadsFound,
        leadsCreated: r.leadsCreated,
        leadsUpdated: r.leadsUpdated,
        leadsSkipped: r.leadsSkipped,
        errors: r.errors,
        durationMs: r.durationMs,
      });
    }

    // Return results under BOTH `data` and `results` keys so callers can use either.
    return NextResponse.json({
      success: true,
      results,
      data: results,
    });
  } catch (error) {
    console.error('[LSQ Admin Sync] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: `Manual sync failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}
