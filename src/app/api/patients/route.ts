// ============================================
// GET  /api/patients — list patient threads
// POST /api/patients — create patient thread
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createPatientThread, listPatientThreads } from '@/lib/db-v5';
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

    const patients = await listPatientThreads({
      stage: stage || undefined,
      department_id: department_id || undefined,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, data: patients });
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

    const result = await createPatientThread({
      ...body,
      created_by: user.profileId,
    });

    return NextResponse.json(
      { success: true, data: result, message: 'Patient thread created' },
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
