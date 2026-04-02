// ============================================
// /api/patients/[id]/discharge
//
// POST — Start discharge (create milestone chain)
// PATCH — Update a specific milestone step
// GET — Get current discharge milestone status
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  createDischargeMilestone,
  updateMilestoneStep,
  getActiveMilestone,
  postMilestoneMessage,
  getMilestoneProgress,
} from '@/lib/discharge-milestones';
import type { DischargeMilestoneStep } from '@/types';
import { DISCHARGE_MILESTONE_ORDER } from '@/types';

// ── GET: Current milestone status ──

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const milestone = await getActiveMilestone(params.id);
    if (!milestone) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No active discharge milestone',
      });
    }

    const progress = getMilestoneProgress(milestone);

    return NextResponse.json({
      success: true,
      data: {
        milestone,
        progress,
      },
    });
  } catch (error) {
    console.error('GET /api/patients/[id]/discharge error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get discharge status' },
      { status: 500 }
    );
  }
}

// ── POST: Start discharge (create milestone chain) ──

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: patientThreadId } = params;

    // Look up patient info
    const patient = await queryOne<{
      patient_name: string;
      getstream_channel_id: string | null;
      current_stage: string;
    }>(
      `SELECT patient_name, getstream_channel_id, current_stage FROM patient_threads WHERE id = $1`,
      [patientThreadId]
    );

    if (!patient) {
      return NextResponse.json(
        { success: false, error: 'Patient thread not found' },
        { status: 404 }
      );
    }

    // Create the milestone chain
    const milestone = await createDischargeMilestone(patientThreadId, user.profileId);

    // Post system messages
    await postMilestoneMessage(
      'discharge_ordered',
      user.email,
      patient.patient_name,
      patient.getstream_channel_id,
      patientThreadId,
      milestone,
    );

    const progress = getMilestoneProgress(milestone);

    return NextResponse.json({
      success: true,
      data: {
        milestone,
        progress,
      },
      message: 'Discharge milestone chain started',
    });
  } catch (error) {
    console.error('POST /api/patients/[id]/discharge error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start discharge' },
      { status: 500 }
    );
  }
}

// ── PATCH: Update a milestone step ──

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const step = body.step as DischargeMilestoneStep;

    if (!step || !DISCHARGE_MILESTONE_ORDER.includes(step)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid step: ${step}. Valid: ${DISCHARGE_MILESTONE_ORDER.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const { id: patientThreadId } = params;

    // Get active milestone
    const milestone = await getActiveMilestone(patientThreadId);
    if (!milestone) {
      return NextResponse.json(
        { success: false, error: 'No active discharge milestone. Start discharge first.' },
        { status: 404 }
      );
    }

    // Check step hasn't already been completed
    const colName = step === 'discharge_ordered' ? 'discharge_ordered_at' :
      step === 'pharmacy_clearance' ? 'pharmacy_clearance_at' :
      step === 'lab_clearance' ? 'lab_clearance_at' :
      step === 'discharge_summary' ? 'discharge_summary_at' :
      step === 'billing_closure' ? 'billing_closure_at' :
      step === 'final_bill_submitted' ? 'final_bill_submitted_at' :
      step === 'final_approval' ? 'final_approval_at' :
      step === 'patient_settled' ? 'patient_settled_at' :
      'patient_departed_at';

    if ((milestone as Record<string, unknown>)[colName]) {
      return NextResponse.json(
        { success: false, error: `Step "${step}" has already been completed` },
        { status: 409 }
      );
    }

    // Update the step
    const updated = await updateMilestoneStep(milestone.id, step, user.profileId);

    // Look up patient info for system messages
    const patient = await queryOne<{
      patient_name: string;
      getstream_channel_id: string | null;
    }>(
      `SELECT patient_name, getstream_channel_id FROM patient_threads WHERE id = $1`,
      [patientThreadId]
    );

    // Post system messages
    if (patient) {
      await postMilestoneMessage(
        step,
        user.email,
        patient.patient_name,
        patient.getstream_channel_id,
        patientThreadId,
        updated,
      );
    }

    const progress = getMilestoneProgress(updated);

    return NextResponse.json({
      success: true,
      data: {
        milestone: updated,
        progress,
      },
      message: `Milestone step "${step}" completed`,
    });
  } catch (error) {
    console.error('PATCH /api/patients/[id]/discharge error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update discharge milestone' },
      { status: 500 }
    );
  }
}
