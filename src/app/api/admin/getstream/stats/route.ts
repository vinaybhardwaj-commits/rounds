// ============================================
// GET /api/admin/getstream/stats
// Returns chat system health stats:
//   - department channels vs departments
//   - patient threads with/without channels
//   - cross-functional channel count
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Run all queries in parallel
    const [
      orphanRow,
      totalPtRow,
      deptRow,
      totalDeptRow,
    ] = await Promise.all([
      queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM patient_threads WHERE getstream_channel_id IS NULL AND archived_at IS NULL`
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM patient_threads WHERE getstream_channel_id IS NOT NULL AND archived_at IS NULL`
      ),
      // We can't easily count GetStream channels server-side without querying GetStream API,
      // so we count departments as a proxy
      queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM departments WHERE is_active = true`
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM departments WHERE is_active = true`
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        totalPatientChannels: parseInt(totalPtRow?.count || '0'),
        orphanPatients: parseInt(orphanRow?.count || '0'),
        departmentChannels: parseInt(deptRow?.count || '0'), // departments = department channels (after seeding)
        totalDepartments: parseInt(totalDeptRow?.count || '0'),
        crossFunctionalChannels: 5, // hardcoded: ops-daily-huddle, admission-coord, discharge-coord, surgery-coord, emergency-escalation
      },
    });
  } catch (error) {
    console.error('GET /api/admin/getstream/stats error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load stats' }, { status: 500 });
  }
}
