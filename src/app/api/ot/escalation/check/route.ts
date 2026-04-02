// ============================================
// POST /api/ot/escalation/check
// Cron: check for overdue items and escalate
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { checkOTEscalations } from '@/lib/ot/surgery-postings';

export async function POST() {
  try {
    // Allow super_admin or cron token
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
    }

    const result = await checkOTEscalations();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('POST /api/ot/escalation/check error:', error);
    return NextResponse.json({ success: false, error: 'Escalation check failed' }, { status: 500 });
  }
}
