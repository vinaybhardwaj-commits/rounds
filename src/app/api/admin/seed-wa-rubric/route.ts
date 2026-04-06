// ============================================
// POST /api/admin/seed-wa-rubric
// Seeds the wa_rubric table with EHRC departments.
// Protected: super_admin only. Idempotent.
// TEMPORARY: Delete after seed confirmed.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { seedRubric } from '@/lib/wa-engine/seed-rubric';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin role required' }, { status: 403 });
    }

    // seedRubric logs to console; capture completion
    await seedRubric();

    return NextResponse.json({
      success: true,
      message: 'WA rubric seeded: 17 departments + 1 global issues entry',
    });
  } catch (error) {
    console.error('POST /api/admin/seed-wa-rubric error:', error);
    const message = error instanceof Error ? error.message : 'Seed failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
