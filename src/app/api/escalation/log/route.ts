// ============================================
// GET /api/escalation/log — List escalation entries
// PATCH /api/escalation/log — Resolve an escalation
// Step 5.3: Escalation Engine
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listEscalations, resolveEscalation } from '@/lib/db-v5';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const resolvedParam = searchParams.get('resolved');
    const sourceType = searchParams.get('source_type');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const resolved = resolvedParam === null ? undefined : resolvedParam === 'true';

    const entries = await listEscalations({
      resolved,
      source_type: sourceType || undefined,
      limit,
    });

    return NextResponse.json({ success: true, data: entries || [] });
  } catch (error) {
    console.error('GET /api/escalation/log error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch escalations' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { escalation_id, resolution_notes } = body;

    if (!escalation_id) {
      return NextResponse.json(
        { success: false, error: 'escalation_id is required' },
        { status: 400 }
      );
    }

    const result = await resolveEscalation(
      escalation_id,
      user.profileId,
      resolution_notes || null
    );

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Escalation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Escalation resolved',
    });
  } catch (error) {
    console.error('PATCH /api/escalation/log error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to resolve escalation' },
      { status: 500 }
    );
  }
}
