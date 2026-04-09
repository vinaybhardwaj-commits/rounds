// ============================================
// POST /api/patients/dedup-check
//
// Lightweight, side-effect-free lookup used by the Add Patients modal
// for live blur-check on the phone field. Returns the same shape as
// checkForDuplicate() but with only the fields the UI needs.
//
// Does NOT create, modify, or flag anything. Pure read.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { checkForDuplicate } from '@/lib/dedup';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, phone, whatsapp, city } = body as {
      name?: string;
      phone?: string | null;
      whatsapp?: string | null;
      city?: string | null;
    };

    // Need at least a name OR a phone to run a meaningful check
    if (!name && !phone && !whatsapp) {
      return NextResponse.json({
        success: true,
        data: { action: 'create', layer: null, phoneNormalized: null },
      });
    }

    const result = await checkForDuplicate({
      name: name || '',
      phone: phone || null,
      whatsapp: whatsapp || null,
      city: city || null,
    });

    // Strip heavy fields from fuzzyMatches — UI only needs name + id + similarity + created_at
    const lightFuzzy = result.fuzzyMatches?.map((m) => ({
      id: m.id,
      patient_name: m.patient_name,
      phone: m.phone,
      city: m.city,
      current_stage: m.current_stage,
      source_type: m.source_type,
      created_at: m.created_at,
      similarity: m.similarity,
    }));

    return NextResponse.json({
      success: true,
      data: {
        action: result.action,
        layer: result.layer,
        phoneNormalized: result.phoneNormalized,
        matchedThread: result.matchedThread
          ? {
              id: result.matchedThread.id,
              patient_name: result.matchedThread.patient_name,
              phone: result.matchedThread.phone,
              city: result.matchedThread.city,
              current_stage: result.matchedThread.current_stage,
              source_type: result.matchedThread.source_type,
              created_at: result.matchedThread.created_at,
            }
          : undefined,
        fuzzyMatches: lightFuzzy,
      },
    });
  } catch (error) {
    console.error('POST /api/patients/dedup-check error:', error);
    return NextResponse.json(
      { success: false, error: 'Dedup check failed' },
      { status: 500 }
    );
  }
}
