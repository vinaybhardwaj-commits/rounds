// ============================================
// POST /api/ot/escalation/check
// Cron: check for overdue items and escalate
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';

export const POST = withTenancy('/api/ot/escalation/check', async (_request: NextRequest, ctx) => {
  try {
    // Cron endpoint — super_admin gated, scoped to accessible hospitals
    if (ctx.user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
    }

    // Check for overdue readiness items in accessible hospitals
    const overdueItems = await query(
      `SELECT ri.* FROM ot_readiness_items ri
       JOIN patient_threads pt ON pt.id = ri.patient_thread_id
       WHERE pt.hospital_id = ANY($1::uuid[])
       AND ri.status IN ('pending', 'flagged')
       AND ri.due_date < NOW()
       ORDER BY ri.due_date ASC`,
      [ctx.accessibleHospitalIds]
    );

    // TODO: Implement escalation logic per MH.2 design
    // (notify relevant personnel, update case status, etc.)

    return NextResponse.json({ success: true, data: { escalated_count: overdueItems.length, items: overdueItems } });
  } catch (error) {
    console.error('POST /api/ot/escalation/check error:', error);
    return NextResponse.json({ success: false, error: 'Escalation check failed' }, { status: 500 });
  }
});
