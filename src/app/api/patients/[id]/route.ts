// ============================================
// GET   /api/patients/[id] — get patient thread
// PATCH /api/patients/[id] — update patient thread
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPatientThread, updatePatientThread, listFormSubmissions } from '@/lib/db-v5';

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
    const forms = await listFormSubmissions({ patient_thread_id: id, limit: 100 });

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

    const { id } = params;
    const body = await request.json();

    const updated = await updatePatientThread(id, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No fields to update or patient not found' }, { status: 400 });
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
