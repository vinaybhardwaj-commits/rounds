// ============================================
// GET /api/duty-roster/resolve?department_id=X&role=Y
// Resolve who is on duty right now for a given
// role in a given department.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentOnDuty } from '@/lib/db-v5';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const department_id = searchParams.get('department_id');
    const role = searchParams.get('role');

    if (!department_id || !role) {
      return NextResponse.json(
        { success: false, error: 'Both department_id and role query params are required' },
        { status: 400 }
      );
    }

    const onDuty = await getCurrentOnDuty(department_id, role);

    if (!onDuty) {
      return NextResponse.json({
        success: true,
        data: null,
        message: `No one currently on duty for role '${role}' in this department`,
      });
    }

    return NextResponse.json({
      success: true,
      data: onDuty,
    });
  } catch (error) {
    console.error('GET /api/duty-roster/resolve error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to resolve on-duty user' },
      { status: 500 }
    );
  }
}
