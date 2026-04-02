// ============================================
// /api/patients/[id]/claim
//
// GET — Get current insurance claim + timeline
// POST — Create/get claim for this patient
// PATCH — Log a claim event (status change, note, etc.)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  getOrCreateClaim,
  getClaimByPatient,
  getClaimTimeline,
  logClaimEvent,
  postClaimMessage,
  getClaimSummary,
} from '@/lib/insurance-claims';
import type { ClaimEventType } from '@/types';
import { CLAIM_EVENT_LABELS } from '@/types';

// All valid event types
const VALID_EVENT_TYPES = Object.keys(CLAIM_EVENT_LABELS) as ClaimEventType[];

// ── GET: Current claim + timeline + summary ──

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const claim = await getClaimByPatient(params.id);
    if (!claim) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No insurance claim for this patient',
      });
    }

    const timeline = await getClaimTimeline(claim.id);
    const summary = getClaimSummary(claim);

    // Fetch running bill from admission_tracker for headroom calc
    const tracker = await queryOne<{
      running_bill_amount: number | null;
      enhancement_alert_threshold: number | null;
    }>(
      `SELECT running_bill_amount, enhancement_alert_threshold
       FROM admission_tracker
       WHERE patient_thread_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [params.id]
    );

    const runningBill = tracker?.running_bill_amount ? Number(tracker.running_bill_amount) : null;
    const approved = claim.cumulative_approved_amount ? Number(claim.cumulative_approved_amount) : null;
    const headroom = (approved != null && runningBill != null) ? approved - runningBill : null;
    const threshold = tracker?.enhancement_alert_threshold ? Number(tracker.enhancement_alert_threshold) : 50000;
    const enhancementSoonWarning = headroom != null && headroom < threshold && headroom > 0;

    return NextResponse.json({
      success: true,
      data: {
        claim,
        timeline,
        summary: {
          ...summary,
          headroom,
          enhancementSoonWarning,
          runningBill,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/patients/[id]/claim error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get claim' },
      { status: 500 }
    );
  }
}

// ── POST: Create/get claim for patient ──

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: patientThreadId } = params;

    // Look up patient info
    const patient = await queryOne<{
      patient_name: string;
      getstream_channel_id: string | null;
    }>(
      `SELECT patient_name, getstream_channel_id FROM patient_threads WHERE id = $1`,
      [patientThreadId]
    );

    if (!patient) {
      return NextResponse.json(
        { success: false, error: 'Patient thread not found' },
        { status: 404 }
      );
    }

    const claim = await getOrCreateClaim(patientThreadId, user.profileId);
    const timeline = await getClaimTimeline(claim.id);
    const summary = getClaimSummary(claim);

    return NextResponse.json({
      success: true,
      data: {
        claim,
        timeline,
        summary,
      },
      message: timeline.length === 0 ? 'Insurance claim created' : 'Existing claim loaded',
    });
  } catch (error) {
    console.error('POST /api/patients/[id]/claim error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create claim' },
      { status: 500 }
    );
  }
}

// ── PATCH: Log a claim event ──

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
    const {
      eventType,
      description,
      amount,
      portalReference,
      documentUrls,
    } = body as {
      eventType: ClaimEventType;
      description: string;
      amount?: number;
      portalReference?: string;
      documentUrls?: string[];
    };

    // Validate event type
    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid eventType: ${eventType}. Valid: ${VALID_EVENT_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!description) {
      return NextResponse.json(
        { success: false, error: 'description is required' },
        { status: 400 }
      );
    }

    const { id: patientThreadId } = params;

    // Get or create claim
    const existingClaim = await getClaimByPatient(patientThreadId);
    if (!existingClaim) {
      return NextResponse.json(
        { success: false, error: 'No insurance claim found. Create one first via POST.' },
        { status: 404 }
      );
    }

    // Look up user's display name
    const profile = await queryOne<{ full_name: string }>(
      `SELECT full_name FROM profiles WHERE id = $1`,
      [user.profileId]
    );
    const actorName = profile?.full_name || user.email;

    // Log the event
    const { claim, event } = await logClaimEvent(
      existingClaim.id,
      patientThreadId,
      eventType,
      description,
      user.profileId,
      actorName,
      { amount, portalReference, documentUrls },
    );

    // Look up patient info for system messages
    const patient = await queryOne<{
      patient_name: string;
      getstream_channel_id: string | null;
    }>(
      `SELECT patient_name, getstream_channel_id FROM patient_threads WHERE id = $1`,
      [patientThreadId]
    );

    // Post system messages (non-fatal)
    if (patient) {
      try {
        await postClaimMessage(
          eventType,
          actorName,
          patient.patient_name,
          patient.getstream_channel_id,
          claim,
          description,
          amount,
          portalReference,
        );
      } catch (err) {
        console.error('[Claim] System message failed:', err);
      }
    }

    const summary = getClaimSummary(claim);

    return NextResponse.json({
      success: true,
      data: {
        claim,
        event,
        summary,
      },
      message: `Claim event logged: ${CLAIM_EVENT_LABELS[eventType] || eventType}`,
    });
  } catch (error) {
    console.error('PATCH /api/patients/[id]/claim error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to log claim event' },
      { status: 500 }
    );
  }
}
