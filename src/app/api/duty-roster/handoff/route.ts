// ============================================
// POST /api/duty-roster/handoff
// Send a shift handoff notification to a department channel.
// Admin-only. Takes a roster entry ID and posts to the
// department channel via GetStream.
// Step 5.2: Duty Roster Integration
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sendShiftHandoffMessage } from '@/lib/getstream';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!['super_admin', 'department_head'].includes(user.role)) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { roster_entry_id } = body;

    if (!roster_entry_id) {
      return NextResponse.json(
        { success: false, error: 'roster_entry_id is required' },
        { status: 400 }
      );
    }

    // Fetch the roster entry with user name and department slug
    const entries = await query<{
      id: string;
      user_name: string;
      department_slug: string;
      role: string;
      shift_type: string;
      shift_start_time: string | null;
      shift_end_time: string | null;
    }>(
      `SELECT dr.id, p.full_name as user_name, d.slug as department_slug,
              dr.role, dr.shift_type, dr.shift_start_time, dr.shift_end_time
       FROM duty_roster dr
       JOIN profiles p ON dr.user_id = p.id
       JOIN departments d ON dr.department_id = d.id
       WHERE dr.id = $1`,
      [roster_entry_id]
    );

    if (!entries || entries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Roster entry not found' },
        { status: 404 }
      );
    }

    const entry = entries[0];

    await sendShiftHandoffMessage(
      entry.department_slug,
      entry.user_name,
      entry.role,
      entry.shift_type,
      entry.shift_start_time,
      entry.shift_end_time
    );

    return NextResponse.json({
      success: true,
      message: `Handoff notification sent to ${entry.department_slug} channel`,
    });
  } catch (error) {
    console.error('POST /api/duty-roster/handoff error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send handoff notification' },
      { status: 500 }
    );
  }
}
