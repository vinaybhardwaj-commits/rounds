// ============================================
// GET /api/admission-tracker — all current
// inpatients (non-discharged)
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listActiveAdmissions } from '@/lib/db-v5';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const admissions = await listActiveAdmissions();

    return NextResponse.json({ success: true, data: admissions });
  } catch (error) {
    console.error('GET /api/admission-tracker error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list active admissions' },
      { status: 500 }
    );
  }
}
