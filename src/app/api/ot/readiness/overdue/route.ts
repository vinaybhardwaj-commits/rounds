// ============================================
// GET /api/ot/readiness/overdue
// List all overdue readiness items
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { getOverdueOTItems } from '@/lib/ot/surgery-postings';

export const GET = withTenancy('/api/ot/readiness/overdue', async (_request: NextRequest, ctx) => {
  try {
    // Get overdue items from accessible hospitals only
    const items = await query(
      `SELECT ri.* FROM ot_readiness_items ri
       JOIN patient_threads pt ON pt.id = ri.patient_thread_id
       WHERE pt.hospital_id = ANY($1::uuid[])
       AND ri.status IN ('pending', 'flagged')
       AND (ri.due_date IS NULL OR ri.due_date < NOW())
       ORDER BY ri.due_date ASC, ri.id`,
      [ctx.accessibleHospitalIds]
    );

    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /api/ot/readiness/overdue error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get overdue items' }, { status: 500 });
  }
});
