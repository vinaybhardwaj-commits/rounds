// ============================================
// PATCH /api/ot/readiness/[item_id]
// Confirm, flag, block, mark N/A, or reset
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { updateReadinessItem } from '@/lib/ot/surgery-postings';
import { neon } from '@neondatabase/serverless';

interface RouteParams {
  params: Promise<{ item_id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { item_id } = await params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(item_id)) {
      return NextResponse.json({ success: false, error: 'Invalid item ID format' }, { status: 400 });
    }
    const body = await request.json();

    const validActions = ['confirm', 'flag', 'block', 'mark_na', 'reset'];
    if (!body.action || !validActions.includes(body.action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    // Get user's display name
    const sql = neon(process.env.POSTGRES_URL!);
    const profileRows = await sql(`SELECT full_name FROM profiles WHERE id = $1`, [user.profileId]);
    const performedByName = profileRows[0]?.full_name || user.email;

    const result = await updateReadinessItem(
      item_id,
      body.action,
      user.profileId,
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
}
