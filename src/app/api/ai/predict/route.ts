// ============================================
// POST /api/ai/predict — predict patient outcomes
// Step 8.3: Predictive Intelligence
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { predictPatientOutcomes } from '@/lib/ai';


// Resilience pass (26 Apr 2026): allow up to 120s — comfortably above the 60s SDK
// timeout in src/lib/llm.ts so the function never gets killed mid-inference. Vercel
// Pro caps at 300s.
export const maxDuration = 120;
export const dynamic = 'force-dynamic';
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
