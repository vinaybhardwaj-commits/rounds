// ============================================
// DELETE /api/duty-roster/[id] — remove entry
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { deleteDutyRosterEntry } from '@/lib/db-v5';

const ADMIN_ROLES = ['super_admin', 'department_head'];

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;
    const deleted = await deleteDutyRosterEntry(id);

    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Duty roster entry not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Duty roster entry deleted' });
  } catch (error) {
    console.error('DELETE /api/duty-roster/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete duty roster entry' },
      { status: 500 }
    );
  }
}
