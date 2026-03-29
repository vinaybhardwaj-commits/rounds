// ============================================
// POST /api/ai/predict — predict patient outcomes
// Step 8.3: Predictive Intelligence
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { predictPatientOutcomes } from '@/lib/ai';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { patient_thread_id } = body;

    if (!patient_thread_id) {
      return NextResponse.json(
        { success: false, error: 'patient_thread_id required' },
        { status: 400 }
      );
    }

    const result = await predictPatientOutcomes(patient_thread_id);
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Patient not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('POST /api/ai/predict error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to predict outcomes' },
      { status: 500 }
    );
  }
}
