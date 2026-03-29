// ============================================
// GET /api/admission-tracker — all current inpatients (non-discharged)
// POST /api/admission-tracker — create new admission record
// Step 6.1: Admission Tracker Dashboard
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listActiveAdmissions, createAdmissionTracker } from '@/lib/db-v5';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const admissions = await listActiveAdmissions();

    return NextResponse.json({ success: true, data: admissions });
  } catch (error) {
    console.error('GET /api/admission-tracker error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list active admissions' },
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

    // Admin-level roles can create admissions
    if (!['super_admin', 'department_head', 'ip_coordinator'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions to create admission' },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Required fields validation
    const required = ['patient_name', 'uhid', 'ip_number', 'admission_date'];
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json(
          { success: false, error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    const result = await createAdmissionTracker({
      ...body,
      admitted_by: user.profileId,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: 'Admission record created',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/admission-tracker error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create admission record' },
      { status: 500 }
    );
  }
}
