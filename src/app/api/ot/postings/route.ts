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

    // Build parameterized WHERE clauses dynamically.
    // Bug fix (1 May 2026): patient_thread_id was previously parsed but never
    // applied to the SQL, so SurgeryPanel received the most-recent posting in
    // the hospital regardless of which patient was being viewed — every
    // patient saw the same phantom "Upcoming Surgery" card. Also fixes a
    // latent bug where filters.date referenced $2 with no second binding.
    // ot_room and status remain string-interpolated (pre-existing pattern;
    // SQL injection cleanup tracked separately as v1.x).
    const params: unknown[] = [ctx.accessibleHospitalIds];
    const where: string[] = ['pt.hospital_id = ANY($1::uuid[])'];

    if (filters.patient_thread_id) {
      params.push(filters.patient_thread_id);
      where.push(`sp.patient_thread_id = $${params.length}::uuid`);
    }
    if (filters.date) {
      params.push(filters.date);
      where.push(`sp.scheduled_date = $${params.length}::date`);
    }
    if (filters.ot_room) {
      where.push(`sp.ot_room = ${filters.ot_room}`);
    }
    if (filters.status) {
      where.push(`sp.status = '${filters.status}'`);
    }

    const postings = await query(
      `SELECT sp.* FROM surgery_postings sp
       JOIN patient_threads pt ON pt.id = sp.patient_thread_id
       WHERE ${where.join(' AND ')}
       ORDER BY sp.scheduled_date DESC, sp.id`,
      params
    );

    return NextResponse.json({ success: true, data: postings });
  } catch (error) {
    console.error('GET /api/ot/postings error:', error);
    return NextResponse.json({ success: false, error: 'Failed to list postings' }, { status: 500 });
  }
});
