// ============================================
// POST /api/ot/readiness/bulk-confirm
// Confirm multiple items at once
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { bulkConfirmItems } from '@/lib/ot/surgery-postings';
import { neon } from '@neondatabase/serverless';

export const POST = withTenancy('/api/ot/readiness/bulk-confirm', async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();

    if (!body.surgery_posting_id) {
      return NextResponse.json({ success: false, error: 'surgery_posting_id is required' }, { status: 400 });
    }
    if (!body.item_ids || !Array.isArray(body.item_ids) || body.item_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'item_ids array is required' }, { status: 400 });
    }

    // Verify posting + items belong to accessible hospitals
    const tenancyCheck = await query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM surgery_postings sp
        JOIN patient_threads pt ON pt.id = sp.patient_thread_id
        WHERE sp.id = $1::uuid AND pt.hospital_id = ANY($2::uuid[])
      ) AS ok`,
      [body.surgery_posting_id, ctx.accessibleHospitalIds]
    );
    if (!tenancyCheck?.[0]?.ok) {
      return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const profileRows = await sql(`SELECT full_name FROM profiles WHERE id = $1`, [ctx.user.profileId]);
    const performedByName = profileRows[0]?.full_name || ctx.user.email;

    const confirmed = await bulkConfirmItems(
      body.surgery_posting_id,
      body.item_ids,
      ctx.user.profileId,
      performedByName,
      body.notes
    );

    return NextResponse.json({
      success: true,
      data: {
        confirmed_count: confirmed.length,
        items: confirmed,
      },
    });
  } catch (error) {
    console.error('POST /api/ot/readiness/bulk-confirm error:', error);
    return NextResponse.json({ success: false, error: 'Failed to bulk confirm' }, { status: 500 });
  }
});
