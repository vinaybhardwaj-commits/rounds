// ============================================
// PATCH /api/patients/[id]/pac-status
// Update PAC status with changelog logging.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPatientThread, updatePatientThread } from '@/lib/db-v5';
import { query } from '@/lib/db';
import { PAC_STATUS_LABELS, PAC_RELEVANT_STAGES } from '@/types';
import type { PacStatus, PatientStage } from '@/types';

const VALID_PAC_STATUSES = Object.keys(PAC_STATUS_LABELS);

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
    const body = await request.json();
    const { pac_status } = body;

    // Validate
    if (pac_status && !VALID_PAC_STATUSES.includes(pac_status)) {
      return NextResponse.json(
        { success: false, error: `Invalid PAC status. Valid: ${VALID_PAC_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // Get current patient
    const patient = await getPatientThread(id);
    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    // Check stage eligibility
    const currentStage = patient.current_stage as PatientStage;
    if (!PAC_RELEVANT_STAGES.includes(currentStage)) {
      return NextResponse.json(
        { success: false, error: `PAC status is only available for patients at Pre-Op stage and above` },
        { status: 422 }
      );
    }

    const oldStatus = (patient.pac_status as string) || null;
    const newStatus = pac_status || null;

    if (oldStatus === newStatus) {
      return NextResponse.json({ success: true, data: { changes: 0 }, message: 'No change' });
    }

    // Update patient thread
    await updatePatientThread(id, { pac_status: newStatus });

    // Log to changelog
    const oldDisplay = oldStatus ? PAC_STATUS_LABELS[oldStatus as PacStatus] || oldStatus : 'None';
    const newDisplay = newStatus ? PAC_STATUS_LABELS[newStatus as PacStatus] || newStatus : 'None';

    try {
      await query(
        `INSERT INTO patient_changelog (patient_thread_id, change_type, field_name, old_value, new_value, old_display, new_display, changed_by, changed_by_name)
         VALUES ($1, 'pac_status_change', 'pac_status', $2, $3, $4, $5, $6, $7)`,
        [id, oldStatus, newStatus, oldDisplay, newDisplay, user.profileId, user.email]
      );
    } catch (err) {
      console.error('Failed to log PAC status change:', err);
    }

    return NextResponse.json({
      success: true,
      data: { pac_status: newStatus },
      message: `PAC status updated to ${newDisplay}`,
    });
  } catch (error) {
    console.error('PATCH /api/patients/[id]/pac-status error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update PAC status' }, { status: 500 });
  }
}
