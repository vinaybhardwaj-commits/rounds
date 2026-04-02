// ============================================
// POST /api/ot/readiness/add
// Add a dynamic item (specialist_clearance or equipment)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { addDynamicItem } from '@/lib/ot/surgery-postings';
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

    const validTypes = ['specialist_clearance', 'equipment'];
    if (!body.item_type || !validTypes.includes(body.item_type)) {
      return NextResponse.json(
        { success: false, error: `item_type must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Get user's display name
    const sql = neon(process.env.POSTGRES_URL!);
    const profileRows = await sql(`SELECT full_name FROM profiles WHERE id = $1`, [user.profileId]);
    const performedByName = profileRows[0]?.full_name || user.email;

    const result = await addDynamicItem(
      body.surgery_posting_id,
      body.item_type,
      {
        specialty: body.specialty,
        reason: body.reason,
        equipment: body.equipment,
      },
      user.profileId,
      performedByName
    );

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('POST /api/ot/readiness/add error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add dynamic item';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
