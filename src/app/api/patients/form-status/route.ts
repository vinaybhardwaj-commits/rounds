// ============================================
// GET /api/patients/form-status — Batch fetch form submission
// status for all visible patients (used for chiclets)
//
// Returns: { [patient_thread_id]: { [form_type]: status } }
// where status = 'submitted' | 'reviewed' | 'draft' | 'flagged'
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const ids = searchParams.get('ids'); // comma-separated patient_thread_ids

    if (!ids) {
      return NextResponse.json({ success: true, data: {} });
    }

    const idList = ids.split(',').filter(Boolean).slice(0, 200); // cap at 200

    if (idList.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    // Build parameterized query
    const placeholders = idList.map((_, i) => `$${i + 1}`).join(',');

    // Get the LATEST (most recent) form submission per (patient_thread_id, form_type)
    const rows = await query<{
      patient_thread_id: string;
      form_type: string;
      status: string;
    }>(
      `SELECT DISTINCT ON (fs.patient_thread_id, fs.form_type)
              fs.patient_thread_id, fs.form_type, fs.status
       FROM form_submissions fs
       WHERE fs.patient_thread_id IN (${placeholders})
       ORDER BY fs.patient_thread_id, fs.form_type, fs.created_at DESC`,
      idList
    );

    // Group by patient_thread_id → { form_type: status }
    const result: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      if (!result[row.patient_thread_id]) {
        result[row.patient_thread_id] = {};
      }
      result[row.patient_thread_id][row.form_type] = row.status;
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/patients/form-status error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch form statuses' },
      { status: 500 }
    );
  }
}
