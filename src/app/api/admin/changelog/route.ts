// ============================================
// GET /api/admin/changelog
// List all patients (non-archived) for changelog view.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const patients = await query<{
      id: string;
      patient_name: string;
      uhid: string | null;
      ip_number: string | null;
      current_stage: string;
      created_at: string;
      department_name: string | null;
      changelog_count: number;
      last_change_at: string | null;
    }>(
      `SELECT pt.id, pt.patient_name, pt.uhid, pt.ip_number, pt.current_stage,
              pt.created_at, d.name as department_name,
              COUNT(cl.id)::int as changelog_count,
              MAX(cl.created_at) as last_change_at
       FROM patient_threads pt
       LEFT JOIN departments d ON pt.department_id = d.id
       LEFT JOIN patient_changelog cl ON cl.patient_thread_id = pt.id
       WHERE pt.archived_at IS NULL
       GROUP BY pt.id, pt.patient_name, pt.uhid, pt.ip_number, pt.current_stage,
                pt.created_at, d.name
       ORDER BY COALESCE(MAX(cl.created_at), pt.created_at) DESC`,
      []
    );

    return NextResponse.json({ success: true, data: patients });
  } catch (error) {
    console.error('GET /api/admin/changelog error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch patients' }, { status: 500 });
  }
}
