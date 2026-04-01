// ============================================
// GET  /api/patients/archive — list archived patients
// POST /api/patients/archive — archive a patient
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  archivePatientThread,
  restorePatientThread,
  listArchivedPatientThreads,
  getPatientThread,
} from '@/lib/db-v5';
import { updatePatientChannel, sendSystemMessage } from '@/lib/getstream';
import { postPatientActivity } from '@/lib/patient-activity';

const VALID_REMOVAL_REASONS = [
  'duplicate_entry',
  'wrong_patient_created',
  'transfer_to_other_facility',
  'lama',
  'death',
  'test_demo_patient',
  'other',
] as const;

const REASON_LABELS: Record<string, string> = {
  duplicate_entry: 'Duplicate Entry',
  wrong_patient_created: 'Wrong Patient Created',
  transfer_to_other_facility: 'Transfer to Another Facility',
  lama: 'Left Against Medical Advice (LAMA)',
  death: 'Death',
  test_demo_patient: 'Test/Demo Patient',
  other: 'Other',
};

// GET — list archived patients (optionally by type)
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const archiveType = searchParams.get('type') as 'post_discharge' | 'removed' | null;

    const patients = await listArchivedPatientThreads(archiveType || undefined);
    return NextResponse.json({ success: true, data: patients || [] });
  } catch (error) {
    console.error('GET /api/patients/archive error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch archived patients' }, { status: 500 });
  }
}

// POST — archive (soft-delete) a patient
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { patient_thread_id, archive_type, reason, reason_detail } = body;

    if (!patient_thread_id) {
      return NextResponse.json({ success: false, error: 'patient_thread_id is required' }, { status: 400 });
    }

    if (!archive_type || !['post_discharge', 'removed'].includes(archive_type)) {
      return NextResponse.json(
        { success: false, error: 'archive_type must be "post_discharge" or "removed"' },
        { status: 400 }
      );
    }

    // For removals, require a reason
    if (archive_type === 'removed') {
      if (!reason || !VALID_REMOVAL_REASONS.includes(reason as typeof VALID_REMOVAL_REASONS[number])) {
        return NextResponse.json(
          { success: false, error: `reason is required for removals. Valid: ${VALID_REMOVAL_REASONS.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Check patient exists and isn't already archived
    const patient = await getPatientThread(patient_thread_id);
    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    if ((patient as Record<string, unknown>).archived_at) {
      return NextResponse.json({ success: false, error: 'Patient is already archived' }, { status: 400 });
    }

    // Archive in DB
    const updated = await archivePatientThread(
      patient_thread_id,
      archive_type,
      user.profileId,
      reason || null,
      reason_detail || null
    );

    // Freeze the GetStream channel so no new messages can be sent
    const channelId = (patient as Record<string, unknown>).getstream_channel_id as string;
    if (channelId) {
      try {
        await updatePatientChannel(channelId, {
          frozen: true,
          archived: true,
          archive_type,
        });
      } catch (gsErr) {
        console.error('Failed to freeze GetStream channel:', gsErr);
        // Non-fatal — DB archive succeeded
      }
    }

    // Post dual activity (patient thread + department)
    const reasonLabel = reason ? REASON_LABELS[reason] || reason : null;
    await postPatientActivity({
      type: 'patient_archived',
      patientThreadId: patient_thread_id,
      patientName: (patient as Record<string, unknown>).patient_name as string,
      patientChannelId: channelId || null,
      actor: { profileId: user.profileId, name: user.email },
      data: { archiveType: archive_type, reasonLabel, reasonDetail: reason_detail || null },
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: `Patient archived as ${archive_type}`,
    });
  } catch (error) {
    console.error('POST /api/patients/archive error:', error);
    return NextResponse.json({ success: false, error: 'Failed to archive patient' }, { status: 500 });
  }
}

// PATCH — restore a patient from archive
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { patient_thread_id } = body;

    if (!patient_thread_id) {
      return NextResponse.json({ success: false, error: 'patient_thread_id is required' }, { status: 400 });
    }

    const patient = await getPatientThread(patient_thread_id);
    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    if (!(patient as Record<string, unknown>).archived_at) {
      return NextResponse.json({ success: false, error: 'Patient is not archived' }, { status: 400 });
    }

    // Restore in DB
    const updated = await restorePatientThread(patient_thread_id);

    // Unfreeze the GetStream channel
    const channelId = (patient as Record<string, unknown>).getstream_channel_id as string;
    if (channelId) {
      try {
        await updatePatientChannel(channelId, {
          frozen: false,
          archived: false,
          archive_type: null,
        });
      } catch (gsErr) {
        console.error('Failed to unfreeze GetStream channel:', gsErr);
      }
    }

    // Post dual activity (patient thread + department)
    await postPatientActivity({
      type: 'patient_restored',
      patientThreadId: patient_thread_id,
      patientName: (patient as Record<string, unknown>).patient_name as string,
      patientChannelId: channelId || null,
      actor: { profileId: user.profileId, name: user.email },
      data: {},
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Patient restored from archive',
    });
  } catch (error) {
    console.error('PATCH /api/patients/archive error:', error);
    return NextResponse.json({ success: false, error: 'Failed to restore patient' }, { status: 500 });
  }
}
