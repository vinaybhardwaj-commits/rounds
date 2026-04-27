// ============================================
// GET    /api/ot/postings/[id] — Get posting detail
// PATCH  /api/ot/postings/[id] — Update posting
// DELETE /api/ot/postings/[id] — Cancel posting
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import {
  getSurgeryPosting,
  updateSurgeryPosting,
  cancelSurgeryPosting,
  postponeSurgeryPosting,
} from '@/lib/ot/surgery-postings';

interface RouteParams {
  id: string;
}

export const GET = withTenancy<RouteParams>('/api/ot/postings/[id]', async (_request, ctx) => {
  try {
    const { id } = ctx.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid posting ID format' }, { status: 400 });
    }

    // Verify tenancy — posting must belong to user's accessible hospitals
    const tenancyCheck = await query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM surgery_postings sp
        JOIN patient_threads pt ON pt.id = sp.patient_thread_id
        WHERE sp.id = $1::uuid AND pt.hospital_id = ANY($2::uuid[])
      ) AS ok`,
      [id, ctx.accessibleHospitalIds]
    );
    if (!tenancyCheck?.[0]?.ok) {
      return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
    }

    const result = await getSurgeryPosting(id);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/ot/postings/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get posting' }, { status: 500 });
  }
});

export const PATCH = withTenancy<RouteParams>('/api/ot/postings/[id]', async (request, ctx) => {
  try {
    const { id } = ctx.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid posting ID format' }, { status: 400 });
    }

    // Verify tenancy before mutation
    const tenancyCheck = await query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM surgery_postings sp
        JOIN patient_threads pt ON pt.id = sp.patient_thread_id
        WHERE sp.id = $1::uuid AND pt.hospital_id = ANY($2::uuid[])
      ) AS ok`,
      [id, ctx.accessibleHospitalIds]
    );
    if (!tenancyCheck?.[0]?.ok) {
      return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
    }

    const body = await request.json();

    if (body.action === 'cancel') {
      if (!body.reason) {
        return NextResponse.json({ success: false, error: 'Cancellation reason required' }, { status: 400 });
      }
      const result = await cancelSurgeryPosting(id, body.reason);
      if (!result) {
        return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'postpone') {
      if (!body.new_date || !body.reason) {
        return NextResponse.json({ success: false, error: 'New date and reason required for postponement' }, { status: 400 });
      }
      const result = await postponeSurgeryPosting(id, body.new_date, body.reason);
      if (!result) {
        return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: result });
    }

    const result = await updateSurgeryPosting(id, body);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Posting not found or no changes' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('PATCH /api/ot/postings/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update posting' }, { status: 500 });
  }
});

export const DELETE = withTenancy<RouteParams>('/api/ot/postings/[id]', async (request, ctx) => {
  try {
    const { id } = ctx.params;

    // Verify tenancy before mutation
    const tenancyCheck = await query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM surgery_postings sp
        JOIN patient_threads pt ON pt.id = sp.patient_thread_id
        WHERE sp.id = $1::uuid AND pt.hospital_id = ANY($2::uuid[])
      ) AS ok`,
      [id, ctx.accessibleHospitalIds]
    );
    if (!tenancyCheck?.[0]?.ok) {
      return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const reason = (typeof body.reason === 'string' && body.reason.trim()) ? body.reason.trim() : 'Cancelled via API';

    const result = await cancelSurgeryPosting(id, reason);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('DELETE /api/ot/postings/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel posting' }, { status: 500 });
  }
});
