// ============================================
// GET /api/integrations/leadsquared/sync
//
// Polling endpoint — called by Vercel cron
// every 15 minutes to sync OPD WIN and IPD WIN
// leads from LeadSquared into Rounds.
//
// Also supports manual trigger via POST with
// optional parameters.
//
// Security: Protected by CRON_SECRET.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { syncLeadsByStage, getLastSyncTime } from '@/lib/lsq-sync';

const CRON_SECRET = process.env.CRON_SECRET || '';

function validateAuth(request: NextRequest): boolean {
  // Vercel cron sends Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${CRON_SECRET}`) return true;

  // Also allow query param for manual triggers
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') === CRON_SECRET) return true;

  // Skip auth check if no secret configured (dev mode)
  if (!CRON_SECRET) return true;

  return false;
}

/**
 * GET — Cron-triggered sync.
 * Syncs both OPD WIN and IPD WIN leads.
 */
export async function GET(request: NextRequest) {
  if (!validateAuth(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const startTime = Date.now();

  try {
    console.log('[LSQ Sync Cron] Starting scheduled sync...');

    // Get last sync times to only process recent changes
    const lastOpdSync = await getLastSyncTime('OPD WIN');
    const lastIpdSync = await getLastSyncTime('IPD WIN');

    // Sync OPD WIN leads
    const opdResult = await syncLeadsByStage('OPD WIN', 'poll', {
      enrichFromActivities: true,
      modifiedAfter: lastOpdSync || undefined,
    });

    // Sync IPD WIN leads
    const ipdResult = await syncLeadsByStage('IPD WIN', 'poll', {
      enrichFromActivities: true,
      modifiedAfter: lastIpdSync || undefined,
    });

    const totalDuration = Date.now() - startTime;

    const summary = {
      success: true,
      data: {
        opdWin: {
          found: opdResult.leadsFound,
          created: opdResult.leadsCreated,
          updated: opdResult.leadsUpdated,
          skipped: opdResult.leadsSkipped,
          errors: opdResult.errors.length,
        },
        ipdWin: {
          found: ipdResult.leadsFound,
          created: ipdResult.leadsCreated,
          updated: ipdResult.leadsUpdated,
          skipped: ipdResult.leadsSkipped,
          errors: ipdResult.errors.length,
        },
        totalDurationMs: totalDuration,
      },
    };

    console.log('[LSQ Sync Cron] Complete:', JSON.stringify(summary.data));

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[LSQ Sync Cron] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: `Sync failed: ${error}` },
      { status: 500 }
    );
  }
}

/**
 * POST — Manual sync trigger.
 * Supports optional parameters:
 *   { stage?: string, enrichFromActivities?: boolean }
 */
export async function POST(request: NextRequest) {
  if (!validateAuth(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const stage = body.stage || null;
    const enrich = body.enrichFromActivities !== false;

    const stages = stage ? [stage] : ['OPD WIN', 'IPD WIN'];
    const results = [];

    for (const s of stages) {
      console.log(`[LSQ Sync Manual] Syncing ${s}...`);
      const result = await syncLeadsByStage(s, 'manual', {
        enrichFromActivities: enrich,
      });
      results.push({ stage: s, ...result });
    }

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('[LSQ Sync Manual] Error:', error);
    return NextResponse.json(
      { success: false, error: `Manual sync failed: ${error}` },
      { status: 500 }
    );
  }
}
