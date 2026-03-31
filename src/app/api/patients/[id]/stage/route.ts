// ============================================
// PATCH /api/patients/[id]/stage
// Transition a patient thread to a new stage.
// Updates DB, GetStream channel custom data,
// logs to patient_changelog, and auto-adds
// stage-specific staff to channel.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getPatientThread,
  updatePatientThread,
  findProfilesByRole,
  archivePatientThread,
} from '@/lib/db-v5';
import { query } from '@/lib/db';
import {
  updatePatientChannel,
  addUsersToChannel,
  sendSystemMessage,
} from '@/lib/getstream';
import type { PatientStage } from '@/types';
import { PATIENT_STAGE_LABELS } from '@/types';

// Valid stage transitions (forward progression + some backward corrections)
const VALID_TRANSITIONS: Record<string, string[]> = {
  opd: ['pre_admission', 'admitted'],                          // can go direct to admitted
  pre_admission: ['admitted', 'opd'],                          // can go back to OPD
  admitted: ['pre_op', 'medical_management', 'discharge'],     // pre-op, medical mgmt, or discharge
  medical_management: ['discharge', 'admitted'],               // discharge or back to admitted
  pre_op: ['surgery', 'admitted'],                             // surgery or back if postponed
  surgery: ['post_op'],
  post_op: ['discharge', 'surgery'],                           // discharge or re-operation
  discharge: ['post_discharge', 'post_op_care', 'long_term_followup', 'admitted'], // multiple post-discharge paths + re-admit
  post_discharge: [],                                          // terminal
  post_op_care: ['discharge'],                                 // back to discharge
  long_term_followup: ['discharge'],                           // back to discharge
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
    case 'medical_management':
      return ['nurse', 'pharmacist', 'clinical_care'];
    case 'pre_op':
      return ['anesthesiologist', 'ot_coordinator', 'nurse'];
    case 'surgery':
      return ['anesthesiologist', 'ot_coordinator'];
    case 'post_op':
      return ['nurse', 'physiotherapist'];
    case 'discharge':
      return ['billing_executive', 'pharmacist'];
    case 'post_op_care':
      return ['nurse', 'physiotherapist'];
    case 'long_term_followup':
      return ['clinical_care'];
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

    // 2. Log to changelog
    const fromLabel = PATIENT_STAGE_LABELS[currentStage as PatientStage] || currentStage;
    const toLabel = PATIENT_STAGE_LABELS[newStage] || newStage;

    try {
      await query(
        `INSERT INTO patient_changelog (patient_thread_id, change_type, field_name, old_value, new_value, old_display, new_display, changed_by, changed_by_name)
         VALUES ($1, 'stage_change', 'current_stage', $2, $3, $4, $5, $6, $7)`,
        [id, currentStage, newStage, fromLabel, toLabel, user.profileId, user.email]
      );
    } catch (err) {
      console.error('Failed to log stage change to changelog:', err);
    }

    // 3. Update GetStream channel (if exists)
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
        await sendSystemMessage(
          'patient-thread',
          channelId,
          `📍 Stage transition: ${fromLabel} → ${toLabel}${newMembersAdded > 0 ? `. ${newMembersAdded} staff added to channel.` : ''}`
        );
      } catch {
        // Non-fatal
      }
    }

    // Auto-archive when reaching post_discharge
    let autoArchived = false;
    if (newStage === 'post_discharge') {
      try {
        await archivePatientThread(id, 'post_discharge', user.profileId);
        if (channelId) {
          await updatePatientChannel(channelId, {
            frozen: true,
            archived: true,
            archive_type: 'post_discharge',
          });
        }
        autoArchived = true;
      } catch (err) {
        console.error('Failed to auto-archive post-discharge patient:', err);
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
        auto_archived: autoArchived,
      },
      message: `Stage transitioned from ${currentStage} to ${newStage}${autoArchived ? ' (auto-archived)' : ''}`,
    });
  } catch (error) {
    console.error('PATCH /api/patients/[id]/stage error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to transition stage' },
      { status: 500 }
    );
  }
}
