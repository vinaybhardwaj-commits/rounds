// ============================================
// POST /api/ot/postings — Create a surgery posting
// GET  /api/ot/postings — List postings (filtered)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { createSurgeryPosting, listSurgeryPostings } from '@/lib/ot/surgery-postings';

export const POST = withTenancy('/api/ot/postings', async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();

    // Validate required fields
    const required = ['patient_name', 'procedure_name', 'procedure_side', 'primary_surgeon_name', 'anaesthesiologist_name', 'scheduled_date', 'ot_room'];
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json({ success: false, error: `Missing required field: ${field}` }, { status: 400 });
      }
    }

    // If patient_thread_id provided, verify tenancy
    if (body.patient_thread_id) {
      const tenancyCheck = await query<{ ok: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM patient_threads
          WHERE id = $1::uuid AND hospital_id = ANY($2::uuid[])
        ) AS ok`,
        [body.patient_thread_id, ctx.accessibleHospitalIds]
      );
      if (!tenancyCheck?.[0]?.ok) {
        return NextResponse.json({ success: false, error: 'Patient thread not found' }, { status: 404 });
      }
    }

    const result = await createSurgeryPosting({
      ...body,
      posted_by: ctx.user.profileId,
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('POST /api/ot/postings error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create posting';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
});

export const GET = withTenancy('/api/ot/postings', async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const filters = {
      date: searchParams.get('date') || undefined,
      ot_room: searchParams.get('ot_room') ? parseInt(searchParams.get('ot_room')!) : undefined,
      status: searchParams.get('status') || undefined,
      surgeon: searchParams.get('surgeon') || undefined,
      patient_thread_id: searchParams.get('patient_thread_id') || undefined,
    };

    // Filter postings to only those in accessible hospitals
    const postings = await query(
      `SELECT sp.* FROM surgery_postings sp
       JOIN patient_threads pt ON pt.id = sp.patient_thread_id
       WHERE pt.hospital_id = ANY($1::uuid[])
       ${filters.date ? 'AND sp.scheduled_date = $2::date' : ''}
       ${filters.ot_room ? `AND sp.ot_room = ${filters.ot_room}` : ''}
       ${filters.status ? `AND sp.status = '${filters.status}'` : ''}
       ORDER BY sp.scheduled_date DESC, sp.id`,
      [ctx.accessibleHospitalIds]
    );

    return NextResponse.json({ success: true, data: postings });
  } catch (error) {
    console.error('GET /api/ot/postings error:', error);
    return NextResponse.json({ success: false, error: 'Failed to list postings' }, { status: 500 });
  }
});
