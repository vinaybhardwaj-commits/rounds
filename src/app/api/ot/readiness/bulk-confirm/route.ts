// ============================================
// POST /api/ot/readiness/bulk-confirm
// Confirm multiple items at once
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { bulkConfirmItems } from '@/lib/ot/surgery-postings';
import { neon } from '@neondatabase/serverless';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    if (!body.surgery_posting_id) {
      return NextResponse.json({ success: false, error: 'surgery_posting_id is required' }, { status: 400 });
    }
    if (!body.item_ids || !Array.isArray(body.item_ids) || body.item_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'item_ids array is required' }, { status: 400 });
    }

    // Get user's display name
    const sql = neon(process.env.POSTGRES_URL!);
    const profileRows = await sql(`SELECT full_name FROM profiles WHERE id = $1`, [user.profileId]);
    const performedByName = profileRows[0]?.full_name || user.email;

    const confirmed = await bulkConfirmItems(
      body.surgery_posting_id,
      body.item_ids,
      user.profileId,
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
}
