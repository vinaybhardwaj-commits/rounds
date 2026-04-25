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
} from '@/lib/getstream';
import { postPatientActivity } from '@/lib/patient-activity';
import { createDischargeMilestone, postMilestoneMessage } from '@/lib/discharge-milestones';
import type { PatientStage } from '@/types';
import { PATIENT_STAGE_LABELS, VALID_STAGE_TRANSITIONS } from '@/types';

// Alias for local use
const VALID_TRANSITIONS = VALID_STAGE_TRANSITIONS;

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

    // 25 Apr 2026 — auto-create surgical_case when patient enters admitted+/OT
    // stages. Universal coverage so no admitted patient is ever without an OT
    // tracking row (was previously only created via Marketing Handoff submit).
    if (
      ['admitted', 'pre_op', 'surgery'].includes(newStage) &&
      patient.hospital_id &&
      process.env.FEATURE_CASE_MODEL_ENABLED === 'true'
    ) {
      try {
        const existingCase = await query(
          `SELECT id FROM surgical_cases
            WHERE patient_thread_id = $1 AND archived_at IS NULL
            LIMIT 1`,
          [id]
        );
        if (existingCase.length === 0) {
          const inferredState =
            newStage === 'surgery' ? 'in_theatre' : 'pac_scheduled';

          // 26 Apr 2026 follow-up F2 (P2-1): hydrate from patient_threads +
          // latest MH so the OT panel has useful metadata immediately.
          let hydratedProcedure: string | null = null;
          let surgeonId: string | null = null;
          try {
            const mh = await query<{ form_data: Record<string, unknown> }>(
              `SELECT form_data FROM form_submissions
                WHERE patient_thread_id = $1
                  AND form_type = 'consolidated_marketing_handoff'
                  AND status = 'submitted'
                ORDER BY submitted_at DESC NULLS LAST, created_at DESC
                LIMIT 1`,
              [id]
            );
            const fd = mh[0]?.form_data as Record<string, unknown> | undefined;
            if (fd) {
              const proc = (fd.proposed_procedure ?? fd.clinical_summary ?? '') as string;
              if (typeof proc === 'string' && proc.trim()) {
                hydratedProcedure = proc.trim().slice(0, 500);
              }
            }
          } catch (e) {
            console.warn('[stage] MH hydration skipped:', e instanceof Error ? e.message : e);
          }
          const pt = patient as Record<string, unknown>;
          const consultantId = (pt.primary_consultant_id as string | null) ?? null;
          if (consultantId) {
            try {
              const sid = await query<{ id: string }>(
                `SELECT id FROM profiles WHERE id = $1
                 UNION
                 SELECT id FROM reference_doctors WHERE id = $1
                 LIMIT 1`,
                [consultantId]
              );
              if (sid.length > 0) surgeonId = sid[0].id;
            } catch (e) {
              console.warn('[stage] consultant resolution skipped:', e instanceof Error ? e.message : e);
            }
          }

          // 26 Apr 2026 audit fix (P1-1): atomize via CTE so the case +
          // state event commit together.
          const metadataJson = JSON.stringify({
            via: 'PATCH /api/patients/[id]/stage',
            from_stage: currentStage,
            to_stage: newStage,
            hydrated: {
              procedure_from_mh: hydratedProcedure !== null,
              consultant_resolved: surgeonId !== null,
            },
          });
          await query<{ id: string; state: string }>(
            `WITH new_case AS (
               INSERT INTO surgical_cases
                 (hospital_id, patient_thread_id, state, urgency,
                  planned_procedure, surgeon_id, created_by, created_at, updated_at)
               VALUES ($1, $2, $3, 'elective', $6, $7::UUID, $4, NOW(), NOW())
               RETURNING id, state
             ),
             new_event AS (
               INSERT INTO case_state_events
                 (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
               SELECT id, NULL, state, 'auto_create_on_stage_advance', $4, $5::jsonb FROM new_case
               RETURNING case_id
             )
             SELECT id, state FROM new_case`,
            [patient.hospital_id, id, inferredState, user.profileId, metadataJson, hydratedProcedure, surgeonId]
          );
        }
      } catch (caseErr) {
        // Non-fatal — stage advance still succeeds.
        console.error('[stage] auto-case-create failed:', caseErr);
      }
    }

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

    }

    // Post dual activity message (patient thread + department)
    await postPatientActivity({
      type: 'stage_change',
      patientThreadId: id,
      patientName: (patient as Record<string, unknown>).patient_name as string,
      patientChannelId: channelId,
      actor: { profileId: user.profileId, name: user.email },
      data: { fromLabel, toLabel, membersAdded: newMembersAdded > 0 ? newMembersAdded : undefined },
    });

    // Auto-start discharge milestone chain when transitioning to 'discharge'
    if (newStage === 'discharge') {
      try {
        const milestone = await createDischargeMilestone(id, user.profileId);
        await postMilestoneMessage(
          'discharge_ordered',
          user.email,
          (patient as Record<string, unknown>).patient_name as string,
          channelId,
          id,
          milestone,
        );
      } catch (err) {
        console.error('Failed to auto-create discharge milestone:', err);
        // Non-fatal — stage transition still succeeds
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
