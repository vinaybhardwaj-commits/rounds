// ============================================
// POST /api/ai/gap-analysis
// Analyze a form submission for gaps and risks.
// Step 8.1: AI Gap Analysis
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { analyzeFormGaps } from '@/lib/ai';
import { sql } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { form_submission_id } = body;

    if (!form_submission_id) {
      return NextResponse.json(
        { success: false, error: 'form_submission_id required' },
        { status: 400 }
      );
    }

    // Fetch the form submission
    const submissions = await sql`
      SELECT fs.*, pt.patient_name, pt.current_stage, pt.admission_date
      FROM form_submissions fs
      LEFT JOIN patient_threads pt ON fs.patient_thread_id = pt.id
      WHERE fs.id = ${form_submission_id}
    `;

    if (submissions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Form submission not found' },
        { status: 404 }
      );
    }

    const submission = submissions[0];
    const formData = submission.form_data as Record<string, unknown>;
    const formType = submission.form_type as string;

    const patientContext = submission.patient_name
      ? {
          patient_name: submission.patient_name as string,
          stage: submission.current_stage as string,
          admission_date: submission.admission_date as string | undefined,
        }
      : undefined;

    const report = await analyzeFormGaps(formType, formData, patientContext);

    // Update the form submission with the gap report
    await sql`
      UPDATE form_submissions
      SET ai_gap_report = ${JSON.stringify(report)}::jsonb, updated_at = NOW()
      WHERE id = ${form_submission_id}
    `;

    return NextResponse.json({
      success: true,
      data: report,
      message: `Gap analysis complete. Score: ${report.score}/100`,
    });
  } catch (error) {
    console.error('POST /api/ai/gap-analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to analyze form' },
      { status: 500 }
    );
  }
}
