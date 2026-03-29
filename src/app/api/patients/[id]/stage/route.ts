// ============================================
// PATCH /api/patients/[id]/stage
// Transition a patient thread to a new stage.
// Updates DB, GetStream channel custom data,
// and auto-adds stage-specific staff to channel.
// Step 5.1: Patient Thread + Channel Auto-Creation
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getPatientThread,
  updatePatientThread,
  findProfilesByRole,
} from '@/lib/db-v5';
import {
  updatePatientChannel,
  addUsersToChannel,
  sendSystemMessage,
} from '@/lib/getstream';
import type { PatientStage } from '@/types';
import { PATIENT_STAGE_LABELS } from '@/types';

// Valid stage transitions (forward progression + some backward corrections)
const VALID_TRANSITIONS: Record<string, string[]> = {
  opd: ['pre_admission'],
  pre_admission: ['admitted', 'opd'],       // can go back to OPD if not admitted
  admitted: ['pre_op', 'discharge'],          // can skip to discharge if no surgery
  pre_op: ['surgery', 'admitted'],            // can go back if surgery postponed
  surgery: ['post_op'],
  post_op: ['discharge', 'surgery'],          // back to surgery if re-operation
  discharge: ['post_discharge', 'admitted'],  // re-admit if needed
  post_discharge: [],                         // terminal stage
};

// Stage → roles to auto-add to the channel
function getStageRoles(stage: string): string[] {
  switch (stage) {
    case 'opd':
      return ['marketing_executive'];
    case 'pre_admission':
      return ['billing_executive', 'insurance_coordinator'];
    case 'admitted':
      return ['nurse', 'pharmacist'];
    case 'pre_op':
      return ['anesthesiologist', 'ot_coordinator', 'nurse'];
    case 'surgery':
      return ['anesthesiologist', 'ot_coordinator'];
    case 'post_op':
      return ['nurse', 'physiotherapist'];
    case 'discharge':
      return ['billing_executive', 'pharmacist'];
    case 'post_discharge':
      return [];
    default:
      return [];
  }
}

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
    const newStage = body.stage as PatientStage;

    if (!newStage) {
      return NextResponse.json(
        { success: false, error: 'stage is required' },
        { status: 400 }
      );
    }

    // Validate stage is a known value
    if (!PATIENT_STAGE_LABELS[newStage]) {
      return NextResponse.json(
        { success: false, error: `Invalid stage: ${newStage}. Valid: ${Object.keys(PATIENT_STAGE_LABELS).join(', ')}` },
        { status: 400 }
      );
    }

    // Get current patient thread
    const patient = await getPatientThread(id);
    if (!patient) {
      return NextResponse.json(
        { success: false, error: 'Patient thread not found' },
        { status: 404 }
      );
    }

    const currentStage = patient.current_stage as string;

    // Validate transition
    const validNextStages = VALID_TRANSITIONS[currentStage] || [];
    if (!validNextStages.includes(newStage)) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot transition from ${currentStage} to ${newStage}. Valid transitions: ${validNextStages.join(', ') || 'none (terminal stage)'}`,
        },
        { status: 422 }
      );
    }

    // 1. Update DB
    const updateData: Record<string, unknown> = { current_stage: newStage };

    // Auto-set admission_date when transitioning to 'admitted'
    if (newStage === 'admitted' && !patient.admission_date) {
      updateData.admission_date = new Date().toISOString();
    }

    // Auto-set discharge_date when transitioning to 'discharge'
    if (newStage === 'discharge' && !patient.discharge_date) {
      updateData.discharge_date = new Date().toISOString();
    }

    await updatePatientThread(id, updateData as Parameters<typeof updatePatientThread>[1]);

    // 2. Update GetStream channel (if exists)
    const channelId = patient.getstream_channel_id as string | null;
    let newMembersAdded = 0;

    if (channelId) {
      // Update channel custom data
      try {
        await updatePatientChannel(channelId, {
          current_stage: newStage,
        });
      } catch (err) {
        console.error('Failed to update channel custom data:', err);
      }

      // Auto-add stage-specific roles
      const stageRoles = getStageRoles(newStage);
      if (stageRoles.length > 0) {
        try {
          const departmentId = patient.department_id as string | null;
          const stageStaff = await findProfilesByRole(stageRoles, departmentId);
          const newIds = stageStaff.map((p) => p.id);

          if (newIds.length > 0) {
            await addUsersToChannel('patient-thread', channelId, newIds);
            newMembersAdded = newIds.length;
          }
        } catch (err) {
          console.error('Failed to add stage members to channel:', err);
        }
      }

      // Post stage transition system message
      try {
        const fromLabel = PATIENT_STAGE_LABELS[currentStage as PatientStage] || currentStage;
        const toLabel = PATIENT_STAGE_LABELS[newStage] || newStage;
        await sendSystemMessage(
          'patient-thread',
          channelId,
          `📍 Stage transition: ${fromLabel} → ${toLabel}${newMembersAdded > 0 ? `. ${newMembersAdded} staff added to channel.` : ''}`
        );
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        patient_thread_id: id,
        previous_stage: currentStage,
        new_stage: newStage,
        new_members_added: newMembersAdded,
        channel_updated: !!channelId,
      },
      message: `Stage transitioned from ${currentStage} to ${newStage}`,
    });
  } catch (error) {
    console.error('PATCH /api/patients/[id]/stage error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to transition stage' },
      { status: 500 }
    );
  }
}
