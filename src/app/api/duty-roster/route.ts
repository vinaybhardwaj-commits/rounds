// ============================================
// GET  /api/duty-roster — list roster entries
// POST /api/duty-roster — add roster entry (admin)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listDutyRoster, createDutyRosterEntry } from '@/lib/db-v5';

const ADMIN_ROLES = ['super_admin', 'department_head'];

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const department_id = searchParams.get('department_id');
    const role = searchParams.get('role');
    const active_only = searchParams.get('active_only') !== 'false';

    const roster = await listDutyRoster({
      department_id: department_id || undefined,
      role: role || undefined,
      active_only,
    });

    return NextResponse.json({ success: true, data: roster });
  } catch (error) {
    console.error('GET /api/duty-roster error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list duty roster' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Only admins and department heads can manage the duty roster' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { user_id, department_id, role, shift_type, day_of_week, effective_from } = body;

    if (!user_id || !department_id || !role || !shift_type || !day_of_week || !effective_from) {
      return NextResponse.json(
        { success: false, error: 'Required: user_id, department_id, role, shift_type, day_of_week, effective_from' },
        { status: 400 }
      );
    }

    const result = await createDutyRosterEntry({
      ...body,
      created_by: user.profileId,
    });

    return NextResponse.json(
      { success: true, data: result, message: 'Duty roster entry created' },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/duty-roster error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create duty roster entry' },
      { status: 500 }
    );
  }
}
