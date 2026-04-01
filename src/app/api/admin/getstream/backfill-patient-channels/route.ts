// ============================================
// POST /api/admin/getstream/backfill-patient-channels
// Creates GetStream channels for all patient_threads
// that don't have one yet (e.g., LSQ imports before
// the channel auto-creation was added).
// Protected: super_admin only. Idempotent.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { createPatientChannel, sendSystemMessage } from '@/lib/getstream';

export async function POST() {
  try {
    // Auth check — super_admin only
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403 }
      );
    }

    // Find all patient threads without a GetStream channel
    const orphans = await query<{
      id: string;
      patient_name: string;
      uhid: string | null;
      current_stage: string;
      department_id: string | null;
      lsq_lead_id: string | null;
    }>(
      `SELECT id, patient_name, uhid, current_stage, department_id, lsq_lead_id
       FROM patient_threads
       WHERE getstream_channel_id IS NULL
         AND archived_at IS NULL
       ORDER BY created_at ASC`
    );

    let created = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const pt of orphans) {
      try {
        const channelId = await createPatientChannel({
          patientThreadId: pt.id,
          patientName: pt.patient_name,
          uhid: pt.uhid,
          currentStage: pt.current_stage,
          departmentId: pt.department_id,
          createdById: 'rounds-system',
          memberIds: [user.profileId], // add the admin who triggered backfill
        });

        // Store channel ID on the patient thread
        await query(
          `UPDATE patient_threads SET getstream_channel_id = $1 WHERE id = $2`,
          [channelId, pt.id]
        );

        // Post a welcome message
        const source = pt.lsq_lead_id ? 'LeadSquared import' : 'manual entry';
        await sendSystemMessage(
          'patient-thread',
          channelId,
          `📋 Chat channel created for ${pt.patient_name}${pt.uhid ? ` (UHID: ${pt.uhid})` : ''}. Source: ${source}. Stage: ${pt.current_stage.replace(/_/g, ' ').toUpperCase()}.`
        );

        created++;
      } catch (err) {
        failed++;
        errors.push(`${pt.patient_name} (${pt.id}): ${err}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total_orphans: orphans.length,
        channels_created: created,
        channels_failed: failed,
        errors: errors.slice(0, 20), // cap error list
      },
      message: `Backfill complete: ${created} channels created, ${failed} failed out of ${orphans.length} patients`,
    });
  } catch (error) {
    console.error('POST /api/admin/getstream/backfill-patient-channels error:', error);
    return NextResponse.json(
      { success: false, error: 'Backfill failed' },
      { status: 500 }
    );
  }
}
