// ============================================
// GET  /api/patients — list patient threads
// POST /api/patients — create patient thread
//   + auto-create GetStream channel
//   + auto-add relevant staff
// Step 5.1: Patient Thread + Channel Auto-Creation
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  createPatientThread,
  listPatientThreads,
  getPatientStageCounts,
  updatePatientThread,
  findProfilesByRole,
  getDepartmentHead,
} from '@/lib/db-v5';
import {
  createPatientChannel,
  sendSystemMessage,
} from '@/lib/getstream';
import type { PatientStage } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage') as PatientStage | null;
    const department_id = searchParams.get('department_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Fetch patients and stage counts in parallel
    const [patients, stageCounts] = await Promise.all([
      listPatientThreads({
        stage: stage || undefined,
        department_id: department_id || undefined,
        limit,
        offset,
      }),
      getPatientStageCounts(),
    ]);

    return NextResponse.json({ success: true, data: patients, stageCounts });
  } catch (error) {
    console.error('GET /api/patients error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list patient threads' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { patient_name } = body;

    if (!patient_name) {
      return NextResponse.json(
        { success: false, error: 'patient_name is required' },
        { status: 400 }
      );
    }

    // 1. Create DB record
    const result = await createPatientThread({
      ...body,
      created_by: user.profileId,
    });

    const patientThreadId = result.id;
    const departmentId = body.department_id || null;
    const stage = body.current_stage || 'opd';

    // 2. Determine initial channel members
    //    Always include: creator, primary consultant (if set)
    //    Auto-add by role: IP coordinators (for all stages)
    //    If department set: department head
    const memberIds = new Set<string>();
    memberIds.add(user.profileId);

    if (body.primary_consultant_id) {
      memberIds.add(body.primary_consultant_id);
    }

    // Always add IP coordinators — they need visibility on all patient threads
    try {
      const ipCoords = await findProfilesByRole(['ip_coordinator']);
      ipCoords.forEach((p) => memberIds.add(p.id));
    } catch {
      // Don't fail patient creation if IP coordinator lookup fails
    }

    // Add department head if department is set
    if (departmentId) {
      try {
        const headId = await getDepartmentHead(departmentId);
        if (headId) memberIds.add(headId);
      } catch {
        // Non-fatal
      }
    }

    // Add stage-specific roles
    const stageRoles = getStageRoles(stage);
    if (stageRoles.length > 0) {
      try {
        const stageStaff = await findProfilesByRole(stageRoles, departmentId);
        stageStaff.forEach((p) => memberIds.add(p.id));
      } catch {
        // Non-fatal
      }
    }

    // Remove creator from the set (already included by GetStream channel creator)
    // Actually keep it — ensures they're in the members list

    // 3. Create GetStream channel
    let getstreamChannelId: string | null = null;
    try {
      getstreamChannelId = await createPatientChannel({
        patientThreadId,
        patientName: patient_name,
        uhid: body.uhid || null,
        currentStage: stage,
        departmentId,
        createdById: user.profileId,
        memberIds: [...memberIds].filter((id) => id !== user.profileId), // creator is already the channel owner
      });

      // 4. Update DB with the channel ID
      await updatePatientThread(patientThreadId, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getstream_channel_id: getstreamChannelId as any,
      });

      // 5. Post a welcome system message
      await sendSystemMessage(
        'patient-thread',
        getstreamChannelId,
        `📋 Patient thread created for ${patient_name}${body.uhid ? ` (UHID: ${body.uhid})` : ''}. Stage: ${stage.replace(/_/g, ' ').toUpperCase()}.`
      );
    } catch (err) {
      // Channel creation failure is non-fatal — the DB record is created
      console.error('Failed to create GetStream channel for patient thread:', err);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id: patientThreadId,
          getstream_channel_id: getstreamChannelId,
          members_added: memberIds.size,
        },
        message: `Patient thread created${getstreamChannelId ? ` with channel and ${memberIds.size} members` : ' (channel creation failed)'}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/patients error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create patient thread' },
      { status: 500 }
    );
  }
}

// ============================================
// STAGE → ROLE MAPPING
// Determines which additional roles to auto-add
// to the patient channel based on current stage.
// ============================================

function getStageRoles(stage: string): string[] {
  switch (stage) {
    case 'opd':
      return ['marketing_executive']; // lead follow-up
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
