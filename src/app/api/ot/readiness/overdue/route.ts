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
      // v1.1 (28 Apr 2026) — fixed broken JOIN + column (same fix as /mine).
      `SELECT ri.* FROM ot_readiness_items ri
       JOIN surgery_postings sp ON sp.id = ri.surgery_posting_id
       LEFT JOIN patient_threads pt ON pt.id = sp.patient_thread_id
       WHERE (pt.hospital_id = ANY($1::uuid[]) OR pt.id IS NULL)
       AND ri.status IN ('pending', 'flagged')
       AND (ri.due_by IS NULL OR ri.due_by < NOW())
       ORDER BY ri.due_by ASC NULLS LAST, ri.id`,
      [ctx.accessibleHospitalIds]
    );

    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /api/ot/readiness/overdue error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get overdue items' }, { status: 500 });
  }
});
