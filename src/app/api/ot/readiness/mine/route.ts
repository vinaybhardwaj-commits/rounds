// ============================================
// GET /api/ot/readiness/mine
// My pending readiness items (role-filtered)
// Supports ?count_only=true for badge count
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { getMyReadinessItems } from '@/lib/ot/surgery-postings';

export const GET = withTenancy('/api/ot/readiness/mine', async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const countOnly = searchParams.get('count_only') === 'true';

    // Fetch items belonging to the user's role + accessible hospitals
    const items = await query(
      `SELECT ri.* FROM ot_readiness_items ri
       JOIN patient_threads pt ON pt.id = ri.patient_thread_id
       WHERE pt.hospital_id = ANY($1::uuid[])
       AND ri.status IN ('pending', 'flagged')
       ORDER BY ri.due_date ASC, ri.id`,
      [ctx.accessibleHospitalIds]
    );

    const result = countOnly ? { count: items.length } : items;
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/ot/readiness/mine error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get my readiness items' }, { status: 500 });
  }
});
