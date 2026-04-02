// ============================================
// GET    /api/ot/postings/[id] — Get posting detail
// PATCH  /api/ot/postings/[id] — Update posting
// DELETE /api/ot/postings/[id] — Cancel posting
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getSurgeryPosting,
  updateSurgeryPosting,
  cancelSurgeryPosting,
  postponeSurgeryPosting,
} from '@/lib/ot/surgery-postings';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    // Validate UUID format to avoid DB errors on malformed input
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid posting ID format' }, { status: 400 });
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
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid posting ID format' }, { status: 400 });
    }
    const body = await request.json();

    // Handle cancel/postpone as special actions
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

    // Generic update
    const result = await updateSurgeryPosting(id, body);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Posting not found or no changes' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('PATCH /api/ot/postings/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update posting' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Cancelled via API';

    const result = await cancelSurgeryPosting(id, reason);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Posting not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('DELETE /api/ot/postings/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel posting' }, { status: 500 });
  }
}
