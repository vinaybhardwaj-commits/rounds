// ============================================
// POST /api/ot/postings — Create a surgery posting
// GET  /api/ot/postings — List postings (filtered)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createSurgeryPosting, listSurgeryPostings } from '@/lib/ot/surgery-postings';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate required fields
    const required = ['patient_name', 'procedure_name', 'procedure_side', 'primary_surgeon_name', 'anaesthesiologist_name', 'scheduled_date', 'ot_room'];
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json({ success: false, error: `Missing required field: ${field}` }, { status: 400 });
      }
    }

    const result = await createSurgeryPosting({
      ...body,
      posted_by: user.profileId,
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('POST /api/ot/postings error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create posting';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filters = {
      date: searchParams.get('date') || undefined,
      ot_room: searchParams.get('ot_room') ? parseInt(searchParams.get('ot_room')!) : undefined,
      status: searchParams.get('status') || undefined,
      surgeon: searchParams.get('surgeon') || undefined,
      patient_thread_id: searchParams.get('patient_thread_id') || undefined,
    };

    const postings = await listSurgeryPostings(filters);
    return NextResponse.json({ success: true, data: postings });
  } catch (error) {
    console.error('GET /api/ot/postings error:', error);
    return NextResponse.json({ success: false, error: 'Failed to list postings' }, { status: 500 });
  }
}
