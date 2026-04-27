// ============================================
// POST /api/ot/readiness/add
// Add a dynamic item (specialist_clearance or equipment)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { addDynamicItem } from '@/lib/ot/surgery-postings';
import { neon } from '@neondatabase/serverless';

export const POST = withTenancy('/api/ot/readiness/add', async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();

    if (!body.surgery_posting_id) {
      return NextResponse.json({ success: false, error: 'surgery_posting_id is required' }, { status: 400 });
    }

    // Verify posting belongs to accessible hospitals
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

    const validTypes = ['specialist_clearance', 'equipment'];
    if (!body.item_type || !validTypes.includes(body.item_type)) {
      return NextResponse.json(
        { success: false, error: `item_type must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const profileRows = await sql(`SELECT full_name FROM profiles WHERE id = $1`, [ctx.user.profileId]);
    const performedByName = profileRows[0]?.full_name || ctx.user.email;

    const result = await addDynamicItem(
      body.surgery_posting_id,
      body.item_type,
      {
        specialty: body.specialty,
        reason: body.reason,
        equipment: body.equipment,
      },
      ctx.user.profileId,
      performedByName
    );

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('POST /api/ot/readiness/add error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add dynamic item';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
});
