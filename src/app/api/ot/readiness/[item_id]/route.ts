// ============================================
// PATCH /api/ot/readiness/[item_id]
// Confirm, flag, block, mark N/A, or reset
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { updateReadinessItem } from '@/lib/ot/surgery-postings';
import { neon } from '@neondatabase/serverless';

interface RouteParams {
  item_id: string;
}

export const PATCH = withTenancy<RouteParams>('/api/ot/readiness/[item_id]', async (request, ctx) => {
  try {
    const { item_id } = ctx.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(item_id)) {
      return NextResponse.json({ success: false, error: 'Invalid item ID format' }, { status: 400 });
    }

    // Verify tenancy before mutation
    const tenancyCheck = await query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM ot_readiness_items ri
        JOIN patient_threads pt ON pt.id = ri.patient_thread_id
        WHERE ri.id = $1::uuid AND pt.hospital_id = ANY($2::uuid[])
      ) AS ok`,
      [item_id, ctx.accessibleHospitalIds]
    );
    if (!tenancyCheck?.[0]?.ok) {
      return NextResponse.json({ success: false, error: 'Readiness item not found' }, { status: 404 });
    }

    const body = await request.json();

    const validActions = ['confirm', 'flag', 'block', 'mark_na', 'reset'];
    if (!body.action || !validActions.includes(body.action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const profileRows = await sql(`SELECT full_name FROM profiles WHERE id = $1`, [ctx.user.profileId]);
    const performedByName = profileRows[0]?.full_name || ctx.user.email;

    const result = await updateReadinessItem(
      item_id,
      body.action,
      ctx.user.profileId,
      performedByName,
      {
        notes: body.notes,
        status_detail: body.status_detail,
        asa_score: body.asa_score,
      }
    );

    if (!result) {
      return NextResponse.json({ success: false, error: 'Readiness item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('PATCH /api/ot/readiness/[item_id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update readiness item' }, { status: 500 });
  }
});
