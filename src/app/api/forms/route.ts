// ============================================
// GET  /api/forms — list form submissions
// POST /api/forms — submit a form
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createFormSubmission, listFormSubmissions } from '@/lib/db-v5';
import type { FormType, FormStatus } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const form_type = searchParams.get('form_type') as FormType | null;
    const patient_thread_id = searchParams.get('patient_thread_id');
    const status = searchParams.get('status') as FormStatus | null;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const forms = await listFormSubmissions({
      form_type: form_type || undefined,
      patient_thread_id: patient_thread_id || undefined,
      status: status || undefined,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, data: forms });
  } catch (error) {
    console.error('GET /api/forms error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list form submissions' },
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
    const { form_type, form_data } = body;

    if (!form_type) {
      return NextResponse.json(
        { success: false, error: 'form_type is required' },
        { status: 400 }
      );
    }
    if (!form_data || typeof form_data !== 'object') {
      return NextResponse.json(
        { success: false, error: 'form_data object is required' },
        { status: 400 }
      );
    }

    const result = await createFormSubmission({
      form_type,
      form_data,
      submitted_by: user.profileId,
      patient_thread_id: body.patient_thread_id || undefined,
      getstream_message_id: body.getstream_message_id || undefined,
      getstream_channel_id: body.getstream_channel_id || undefined,
      department_id: body.department_id || undefined,
      completion_score: body.completion_score || undefined,
      status: body.status || 'submitted',
    });

    return NextResponse.json(
      { success: true, data: result, message: 'Form submitted' },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/forms error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit form' },
      { status: 500 }
    );
  }
}
