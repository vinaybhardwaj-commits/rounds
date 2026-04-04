// ============================================
// GET /api/admin/leadsquared
// Serves LSQ sync logs + API call logs to the
// admin panel. Protected by admin role.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSyncLogs, getApiCallLogs } from '@/lib/lsq-api-log';
import { query, queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin' && user.role !== 'department_head') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'sync_runs'; // 'sync_runs' | 'api_calls' | 'summary'
    const limit = parseInt(searchParams.get('limit') || '30', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const syncRunId = searchParams.get('sync_run_id') || undefined;
    const onlyErrors = searchParams.get('only_errors') === 'true';

    if (view === 'sync_runs') {
      const data = await getSyncLogs({ limit, offset });
      return NextResponse.json({ success: true, ...data });
    }

    if (view === 'api_calls') {
      const data = await getApiCallLogs({ limit, offset, syncRunId, onlyErrors });
      return NextResponse.json({ success: true, ...data });
    }

    if (view === 'summary') {
      // Dashboard summary: last sync, total patients from LSQ, error rate
      const [lastSync, lsqPatientCount, todayCalls, todayErrors] = await Promise.all([
        queryOne<{
          id: string; sync_type: string; trigger_stage: string;
          leads_created: number; leads_updated: number; leads_skipped: number;
          errors: string; completed_at: string; duration_ms: number;
        }>(
          `SELECT * FROM lsq_sync_log ORDER BY started_at DESC LIMIT 1`
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM patient_threads WHERE lsq_lead_id IS NOT NULL`
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM lsq_api_log WHERE created_at > NOW() - INTERVAL '24 hours'`
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM lsq_api_log
           WHERE created_at > NOW() - INTERVAL '24 hours'
           AND (response_status >= 400 OR error_message IS NOT NULL)`
        ),
      ]);

      // Get LSQ patients by stage
      const stageBreakdown = await query<{ current_stage: string; count: string }>(
        `SELECT current_stage, COUNT(*) as count
         FROM patient_threads WHERE lsq_lead_id IS NOT NULL
         GROUP BY current_stage ORDER BY count DESC`
      );

      return NextResponse.json({
        success: true,
        summary: {
          lastSync: lastSync || null,
          totalLsqPatients: parseInt(lsqPatientCount?.count || '0', 10),
          todayApiCalls: parseInt(todayCalls?.count || '0', 10),
          todayApiErrors: parseInt(todayErrors?.count || '0', 10),
          patientsByStage: stageBreakdown,
        },
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid view parameter' }, { status: 400 });
  } catch (error) {
    console.error('[Admin LSQ] Error:', error);
    return NextResponse.json(
      { success: false, error: `Failed to fetch LSQ data: ${error}` },
      { status: 500 }
    );
  }
}
