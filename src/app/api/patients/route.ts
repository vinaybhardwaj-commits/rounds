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
import { postPatientActivity } from '@/lib/patient-activity';
import {
  checkForDuplicate,
  linkToExistingThread,
  flagAsFuzzyDuplicate,
  logDedupAction,
} from '@/lib/dedup';
import { queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import type { PatientStage } from '@/types';
import { PATIENT_STAGE_LABELS } from '@/types';

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

    // R.3 + R.4: Default source_type for API-created threads. If the caller
    // explicitly passed source_type (e.g. LSQ sync passing 'lsq'), honor it.
    // Otherwise assume 'manual'. LSQ rows carry lsq_lead_id in the same payload.
    const source_type = body.source_type || (body.lsq_lead_id ? 'lsq' : 'manual');
    const source_detail = body.source_detail ?? null;

    // ----------------------------------------------------------------------
    // R.3 + R.4 — Dedup check BEFORE creating the thread
    // Layer 1: exact phone/whatsapp match → link to existing, return early
    // Layer 2: fuzzy name match → create + flag + log as possible duplicate
    // Layer 3: no match → create normally
    // ----------------------------------------------------------------------
    // Skip dedup when the caller is the LSQ sync pipeline — LSQ has its own
    // upsert-by-lsq_lead_id logic and Phase 3 will wire dedup in there.
    const skipDedup = body.skip_dedup === true || source_type === 'lsq';

    if (!skipDedup && (body.phone || body.whatsapp_number || body.whatsapp)) {
      const dedupResult = await checkForDuplicate({
        name: patient_name,
        phone: body.phone ?? null,
        whatsapp: body.whatsapp_number ?? body.whatsapp ?? null,
        city: body.city ?? null,
      });

      if (dedupResult.action === 'link' && dedupResult.matchedThread) {
        // Layer 1 hit — merge incoming data into existing thread
        const existingId = dedupResult.matchedThread.id;

        await linkToExistingThread(existingId, {
          name: patient_name,
          phone: body.phone ?? null,
          whatsapp: body.whatsapp_number ?? body.whatsapp ?? null,
          email: body.email ?? null,
          age: body.age ?? null,
          gender: body.gender ?? null,
          city: body.city ?? null,
          chief_complaint: body.chief_complaint ?? null,
          insurance_status: body.insurance_status ?? null,
          target_department: body.target_department ?? null,
          source_detail,
        });

        // Audit log
        const profileLookup = await queryOne<{ full_name: string }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [user.profileId]
        );
        await logDedupAction({
          action: 'link',
          source_thread_id: null,
          target_thread_id: existingId,
          match_layer: 1,
          reason: 'Phone exact match at manual intake',
          metadata: {
            phone_normalized: dedupResult.phoneNormalized,
            incoming_name: patient_name,
            existing_name: dedupResult.matchedThread.patient_name,
          },
          actor_id: user.profileId,
          actor_name: profileLookup?.full_name || user.email,
          endpoint: '/api/patients',
        });

        // Post activity on the EXISTING thread's channel so the CC team sees
        // the returning-patient signal in their thread.
        const existing = await queryOne<{ getstream_channel_id: string | null }>(
          `SELECT getstream_channel_id FROM patient_threads WHERE id = $1`,
          [existingId]
        );
        if (existing?.getstream_channel_id) {
          try {
            await sendSystemMessage(
              'patient-thread',
              existing.getstream_channel_id,
              `🔁 Returning patient — this patient was re-added via intake form by ${profileLookup?.full_name || user.email}. Returning count incremented.`
            );
          } catch {
            // Non-fatal
          }
        }

        return NextResponse.json(
          {
            success: true,
            action: 'linked',
            data: {
              id: existingId,
              getstream_channel_id: existing?.getstream_channel_id || null,
              linked_to_existing: true,
              matched_patient_name: dedupResult.matchedThread.patient_name,
            },
            message: `Linked to existing patient "${dedupResult.matchedThread.patient_name}" (phone match)`,
          },
          { status: 200 }
        );
      }
      // If action === 'flag', we create the new thread below and flag it
      // after creation. Stash the fuzzy matches so we can use them.
      if (dedupResult.action === 'flag' && dedupResult.fuzzyMatches) {
        body._dedup_fuzzy_matches = dedupResult.fuzzyMatches;
      }
    }

    // 1. Create DB record (Layer 2 and Layer 3 both land here)
    const result = await createPatientThread({
      ...body,
      source_type,
      source_detail,
      created_by: user.profileId,
    });

    const patientThreadId = result.id;
    const departmentId = body.department_id || null;
    const stage = body.current_stage || 'opd';

    // Layer 2 follow-up: flag newly-created thread as possible duplicate
    // + insert dedup_candidates rows for /admin/dedup review
    if (body._dedup_fuzzy_matches && body._dedup_fuzzy_matches.length > 0) {
      try {
        await flagAsFuzzyDuplicate(patientThreadId, body._dedup_fuzzy_matches);
        await logDedupAction({
          action: 'flag',
          source_thread_id: patientThreadId,
          target_thread_id: body._dedup_fuzzy_matches[0]?.id ?? null,
          match_layer: 2,
          similarity: body._dedup_fuzzy_matches[0]?.similarity ?? null,
          reason: `Fuzzy name match — ${body._dedup_fuzzy_matches.length} candidate(s)`,
          metadata: {
            incoming_name: patient_name,
            candidate_count: body._dedup_fuzzy_matches.length,
            top_candidates: body._dedup_fuzzy_matches.slice(0, 3).map(
              (m: { id: string; patient_name: string; similarity: number }) => ({
                id: m.id,
                name: m.patient_name,
                similarity: m.similarity,
              })
            ),
          },
          actor_id: user.profileId,
          actor_name: user.email,
          endpoint: '/api/patients',
        });
      } catch (err) {
        console.error('[dedup] flagAsFuzzyDuplicate failed (non-fatal):', err);
      }
    } else if (!skipDedup) {
      // Layer 3: clean create — log it too
      await logDedupAction({
        action: 'create',
        source_thread_id: patientThreadId,
        match_layer: null,
        reason: 'No duplicate found at manual intake',
        metadata: { source_type },
        actor_id: user.profileId,
        actor_name: user.email,
        endpoint: '/api/patients',
      });
    }

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

    await audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: body.hospital_id || null,
      action: 'patient.create',
      targetType: 'patient_thread',
      targetId: patientThreadId,
      summary: `Created patient ${patient_name}`,
      payloadAfter: { patient_name },
      request,
    });

    // Post dual activity (patient thread + department)
    const stageLabel = PATIENT_STAGE_LABELS[stage as PatientStage] || stage;
    await audit({
      actorId: user.profileId,
      actorRole: user.role,
      hospitalId: body.hospital_id || null,
      action: 'patient.create',
      targetType: 'patient_thread',
      targetId: patientThreadId,
      summary: `Created patient ${patient_name}`,
      payloadAfter: { patient_name, uhid: body.uhid || null },
      request,
    });
    await postPatientActivity({
      type: 'patient_created',
      patientThreadId: patientThreadId,
      patientName: patient_name,
      patientChannelId: getstreamChannelId,
      actor: { profileId: user.profileId, name: user.email },
      data: { stageLabel },
    });

    // Determine response action label for UI
    const responseAction = body._dedup_fuzzy_matches && body._dedup_fuzzy_matches.length > 0
      ? 'flagged'
      : 'created';

    return NextResponse.json(
      {
        success: true,
        action: responseAction,
        data: {
          id: patientThreadId,
          getstream_channel_id: getstreamChannelId,
          members_added: memberIds.size,
          is_possible_duplicate: responseAction === 'flagged',
          fuzzy_match_count: body._dedup_fuzzy_matches?.length || 0,
        },
        message:
          responseAction === 'flagged'
            ? `Patient thread created — flagged as possible duplicate (${body._dedup_fuzzy_matches.length} similar name${body._dedup_fuzzy_matches.length > 1 ? 's' : ''})`
            : `Patient thread created${getstreamChannelId ? ` with channel and ${memberIds.size} members` : ' (channel creation failed)'}`,
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
