// ============================================
// GET /api/wa-analysis/[id]
// Get a single analysis with all details.
// Protected: any authenticated user.
// Phase: WA.2
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const sql = neon(process.env.POSTGRES_URL!);

    // Get analysis row
    const analysisRows = await sql(
      `SELECT a.*, p.full_name as uploaded_by_name
       FROM wa_analyses a
       LEFT JOIN profiles p ON a.uploaded_by = p.id
       WHERE a.id = $1`,
      [id],
    );

    if (analysisRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Analysis not found' },
        { status: 404 },
      );
    }

    // Get extracted points (WA.3 will populate these)
    const points = await sql(
      `SELECT * FROM wa_extracted_points WHERE analysis_id = $1 ORDER BY department_slug, data_date`,
      [id],
    );

    // Get global flags (WA.3 will populate these)
    const flags = await sql(
      `SELECT * FROM wa_global_flags WHERE analysis_id = $1 ORDER BY severity, data_date`,
      [id],
    );

    // Get rubric proposals (WA.4 will populate these)
    const proposals = await sql(
      `SELECT * FROM wa_rubric_proposals WHERE analysis_id = $1 ORDER BY status, created_at`,
      [id],
    );

    return NextResponse.json({
      success: true,
      data: {
        analysis: analysisRows[0],
        extracted_points: points,
        global_flags: flags,
        rubric_proposals: proposals,
      },
    });
  } catch (error) {
    console.error('GET /api/wa-analysis/[id] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get analysis';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
