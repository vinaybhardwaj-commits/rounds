// ============================================
// GET   /api/patients/[id] — get patient thread
// PATCH /api/patients/[id] — update patient thread
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPatientThread, updatePatientThread, listFormSubmissions } from '@/lib/db-v5';
import { audit } from '@/lib/audit';

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
    const patient = await getPatientThread(id);
    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient thread not found' }, { status: 404 });
    }

    // Also fetch form history for this patient
    const forms = await listFormSubmissions({ patient_thread_id: id, limit: 100, user_profile_id: user.profileId });

    return NextResponse.json({
      success: true,
      data: { ...patient, forms },
    });
  } catch (error) {
    console.error('GET /api/patients/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get patient thread' },
      { status: 500 }
    );
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

    // Capture before state
    const before = await getPatientThread(id);
    
    const updated = await updatePatientThread(id, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No fields to update or patient not found' }, { status: 400 });
    }

    // Audit the update
    const changedFields = Object.keys(body).filter(key => key !== 'id');
    if (changedFields.length > 0) {
      const payloadBefore: Record<string, unknown> = {};
      const payloadAfter: Record<string, unknown> = {};
      changedFields.forEach(field => {
        if (before && field in before) payloadBefore[field] = (before as Record<string, unknown>)[field];
        if (field in body) payloadAfter[field] = (body as Record<string, unknown>)[field];
      });
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: before?.hospital_id || null,
        action: 'patient.update_field',
        targetType: 'patient_thread',
        targetId: id,
        summary: `Updated patient record`,
        payloadBefore,
        payloadAfter,
        request,
      });
    }

    return NextResponse.json({ success: true, data: updated, message: 'Patient thread updated' });
  } catch (error) {
    console.error('PATCH /api/patients/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update patient thread' },
      { status: 500 }
    );
  }
}
