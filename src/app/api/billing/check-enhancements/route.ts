// ============================================
// /api/billing/check-enhancements
//
// POST — Check all active patients for enhancement needs.
//        Fires alerts for those exceeding threshold.
//        Can be called manually or by a scheduled job.
// GET  — Check without firing alerts (dry run).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  checkAllEnhancements,
  checkPatientEnhancement,
  fireEnhancementAlert,
} from '@/lib/enhancement-alerts';

// ── GET: Dry run — check all patients, return results without alerting ──

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const results = await checkAllEnhancements();

    return NextResponse.json({
      success: true,
      data: {
        patientsNeedingEnhancement: results.length,
        patients: results.map((r) => ({
          patientName: r.patientName,
          patientThreadId: r.patientThreadId,
          runningBill: r.runningBill,
          approvedAmount: r.approvedAmount,
          gap: r.gap,
          threshold: r.threshold,
          roomNumber: r.roomNumber,
        })),
      },
      message: `${results.length} patient(s) need enhancement`,
    });
  } catch (error) {
    console.error('GET /api/billing/check-enhancements error:', error);
    return NextResponse.json(
      { success: false, error: 'Enhancement check failed' },
      { status: 500 }
    );
  }
}

// ── POST: Check and fire alerts ──

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { patientThreadId } = body as { patientThreadId?: string };

    // Get actor name
    const profile = await queryOne<{ full_name: string }>(
      `SELECT full_name FROM profiles WHERE id = $1`,
      [user.profileId]
    );
    const actorName = profile?.full_name || user.email;

    if (patientThreadId) {
      // Check single patient
      const check = await checkPatientEnhancement(patientThreadId);
      if (!check) {
        return NextResponse.json({
          success: true,
          data: { needsEnhancement: false },
          message: 'No active claim or running bill for this patient',
        });
      }

      if (check.needsEnhancement) {
        await fireEnhancementAlert(check, user.profileId, actorName);
      }

      return NextResponse.json({
        success: true,
        data: check,
        message: check.needsEnhancement
          ? `Enhancement alert fired for ${check.patientName}`
          : `No enhancement needed (gap: ₹${check.gap.toLocaleString('en-IN')}, threshold: ₹${check.threshold.toLocaleString('en-IN')})`,
      });
    }

    // Check all patients
    const results = await checkAllEnhancements();
    let alertsFired = 0;

    for (const check of results) {
      try {
        await fireEnhancementAlert(check, user.profileId, actorName);
        alertsFired++;
      } catch (err) {
        console.error(`[Enhancement] Alert failed for ${check.patientName}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        patientsChecked: results.length,
        alertsFired,
        patients: results.map((r) => ({
          patientName: r.patientName,
          gap: r.gap,
          roomNumber: r.roomNumber,
        })),
      },
      message: `${alertsFired} enhancement alert(s) fired out of ${results.length} patient(s)`,
    });
  } catch (error) {
    console.error('POST /api/billing/check-enhancements error:', error);
    return NextResponse.json(
      { success: false, error: 'Enhancement check failed' },
      { status: 500 }
    );
  }
}
