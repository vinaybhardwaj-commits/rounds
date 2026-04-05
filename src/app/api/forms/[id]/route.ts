// ============================================
// GET  /api/forms/[id] — get form submission
// PATCH /api/forms/[id] — blocked if locked
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getFormSubmission, listReadinessItems, getReadinessAggregate } from '@/lib/db-v5';
import { query as sqlQuery } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const form = await getFormSubmission(id);
    if (!form) {
      return NextResponse.json({ success: false, error: 'Form submission not found' }, { status: 404 });
    }

    // Fetch readiness items if any exist for this form
    const readinessItems = await listReadinessItems(id);
    const readinessAggregate = readinessItems.length > 0
      ? await getReadinessAggregate(id)
      : null;

    // For financial_counseling forms, include version history chain
    let versionHistory: unknown[] | null = null;
    const formRecord = form as Record<string, unknown>;
    if (formRecord.form_type === 'financial_counseling' && formRecord.patient_thread_id) {
      try {
        const versions = await sqlQuery<{
          id: string;
          version_number: number;
          change_reason: string | null;
          pdf_url: string | null;
          locked: boolean;
          created_at: string;
          submitted_by_name: string | null;
          estimated_cost: number | null;
          payment_mode: string | null;
        }>(
          `SELECT
             fs.id,
             COALESCE(fs.version_number, 1) AS version_number,
             fs.change_reason,
             fs.pdf_url,
             COALESCE(fs.locked, false) AS locked,
             fs.created_at,
             p.full_name AS submitted_by_name,
             (fs.form_data->>'estimated_cost')::numeric AS estimated_cost,
             fs.form_data->>'payment_mode' AS payment_mode
           FROM form_submissions fs
           LEFT JOIN profiles p ON p.id = fs.submitted_by
           WHERE fs.form_type = 'financial_counseling'
             AND fs.patient_thread_id = $1
             AND fs.status != 'draft'
           ORDER BY COALESCE(fs.version_number, 1) DESC`,
          [formRecord.patient_thread_id]
        );
        versionHistory = versions;
      } catch (err) {
        console.warn('[FormGet] Failed to fetch FC version history:', err);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...form,
        readiness_items: readinessItems,
        readiness_aggregate: readinessAggregate,
        ...(versionHistory ? { version_history: versionHistory } : {}),
      },
    });
  } catch (error) {
    console.error('GET /api/forms/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get form submission' },
      { status: 500 }
    );
  }
}

// PATCH blocked for locked (PDF-generated) form submissions
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;

    // Check if submission is locked
    const rows = await sqlQuery<{ locked: boolean }>(
      `SELECT COALESCE(locked, false) AS locked FROM form_submissions WHERE id = $1`,
      [id]
    );
    if (!rows[0]) {
      return NextResponse.json({ success: false, error: 'Form submission not found' }, { status: 404 });
    }
    if (rows[0].locked) {
      return NextResponse.json(
        { success: false, error: 'This form submission is locked (PDF generated). Create a new revision instead.' },
        { status: 403 }
      );
    }

    // Allow update for non-locked submissions
    const body = await request.json();
    const { form_data, status } = body;

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [id];
    let idx = 2;

    if (form_data) {
      sets.push(`form_data = $${idx}`);
      vals.push(JSON.stringify(form_data));
      idx++;
    }
    if (status) {
      sets.push(`status = $${idx}`);
      vals.push(status);
      idx++;
    }

    await sqlQuery(
      `UPDATE form_submissions SET ${sets.join(', ')} WHERE id = $1`,
      vals
    );

    return NextResponse.json({ success: true, message: 'Form updated' });
  } catch (error) {
    console.error('PATCH /api/forms/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update form submission' },
      { status: 500 }
    );
  }
}
