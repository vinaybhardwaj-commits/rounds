// ============================================
// /api/patients/[id]/enhance
//
// POST — Doctor submits case summary for enhancement
// PATCH — Update running bill amount
// GET — Check enhancement status for this patient
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  checkPatientEnhancement,
  submitCaseSummary,
  updateRunningBill,
  fireEnhancementAlert,
} from '@/lib/enhancement-alerts';
import { getClaimByPatient } from '@/lib/insurance-claims';

// ── GET: Enhancement status for this patient ──

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const check = await checkPatientEnhancement(params.id);

    return NextResponse.json({
      success: true,
      data: check,
      message: check
        ? (check.needsEnhancement ? 'Enhancement needed' : 'No enhancement needed')
        : 'No active claim or billing data',
    });
  } catch (error) {
    console.error('GET /api/patients/[id]/enhance error:', error);
    return NextResponse.json(
      { success: false, error: 'Enhancement check failed' },
      { status: 500 }
    );
  }
}

// ── POST: Doctor submits case summary ──

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      currentDiagnosis,
      ongoingTreatment,
      reasonForExtension,
      revisedEstimate,
    } = body as {
      currentDiagnosis: string;
      ongoingTreatment: string;
      reasonForExtension: string;
      revisedEstimate: number;
    };

    if (!currentDiagnosis || !reasonForExtension || !revisedEstimate) {
      return NextResponse.json(
        { success: false, error: 'currentDiagnosis, reasonForExtension, and revisedEstimate are required' },
        { status: 400 }
      );
    }

    // Get the claim
    const claim = await getClaimByPatient(params.id);
    if (!claim) {
      return NextResponse.json(
        { success: false, error: 'No insurance claim found for this patient' },
        { status: 404 }
      );
    }

    // Get doctor name
    const profile = await queryOne<{ full_name: string }>(
      `SELECT full_name FROM profiles WHERE id = $1`,
      [user.profileId]
    );
    const doctorName = profile?.full_name || user.email;

    await submitCaseSummary(
      params.id,
      claim.id,
      { currentDiagnosis, ongoingTreatment, reasonForExtension, revisedEstimate },
      user.profileId,
      doctorName,
    );

    return NextResponse.json({
      success: true,
      message: 'Case summary submitted. Billing team notified to proceed with enhancement.',
    });
  } catch (error) {
    console.error('POST /api/patients/[id]/enhance error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit case summary' },
      { status: 500 }
    );
  }
}

// ── PATCH: Update running bill amount ──

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { runningBill } = body as { runningBill: number };

    if (!runningBill || runningBill < 0) {
      return NextResponse.json(
        { success: false, error: 'runningBill is required and must be non-negative' },
        { status: 400 }
      );
    }

    const result = await updateRunningBill(params.id, runningBill);

    if (!result.updated) {
      return NextResponse.json(
        { success: false, error: 'No active admission found for this patient' },
        { status: 404 }
      );
    }

    // If enhancement needed, auto-fire the alert
    if (result.needsEnhancement) {
      const check = await checkPatientEnhancement(params.id);
      if (check?.needsEnhancement) {
        const profile = await queryOne<{ full_name: string }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [user.profileId]
        );
        await fireEnhancementAlert(check, user.profileId, profile?.full_name || user.email);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        runningBill,
        needsEnhancement: result.needsEnhancement,
      },
      message: result.needsEnhancement
        ? `Running bill updated to ₹${runningBill.toLocaleString('en-IN')} — enhancement alert fired`
        : `Running bill updated to ₹${runningBill.toLocaleString('en-IN')}`,
    });
  } catch (error) {
    console.error('PATCH /api/patients/[id]/enhance error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update running bill' },
      { status: 500 }
    );
  }
}
