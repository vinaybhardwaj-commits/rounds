// ============================================
// POST /api/integrations/leadsquared/webhook
//
// Receives webhook notifications from LSQ
// when a lead's stage changes.
// LSQ sends: entityType, entityId, eventType
// as query params, body is JSON with lead data.
//
// Security: Validates a shared secret token.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { syncSingleLead } from '@/lib/lsq-sync';

const WEBHOOK_SECRET = process.env.LSQ_WEBHOOK_SECRET || '';

export async function POST(request: NextRequest) {
  try {
    // ---- Security: validate webhook secret ----
    if (!WEBHOOK_SECRET) {
      console.error('[LSQ Webhook] LSQ_WEBHOOK_SECRET is not configured — rejecting request');
      return NextResponse.json(
        { success: false, error: 'Webhook not configured' },
        { status: 503 }
      );
    }

    const authHeader = request.headers.get('x-webhook-secret')
      || request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const querySecret = searchParams.get('secret');

    const providedSecret = authHeader?.replace('Bearer ', '') || querySecret;

    if (providedSecret !== WEBHOOK_SECRET) {
      console.warn('[LSQ Webhook] Invalid secret, rejecting request');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ---- Parse webhook payload ----
    const body = await request.json();

    // LSQ webhook can send different formats:
    // 1. Stage change: { entityType, entityId, eventType, ... }
    // 2. Activity: array of activities
    // 3. Custom: whatever is configured

    // Extract the lead/prospect ID
    let prospectId: string | null = null;

    // Check query params first (LSQ appends these)
    const entityId = searchParams.get('entityId');
    const entityType = searchParams.get('entityType');
    const eventType = searchParams.get('eventType');

    if (entityId && entityType === 'Lead') {
      prospectId = entityId;
    }

    // Also check body for ProspectID
    if (!prospectId) {
      if (Array.isArray(body)) {
        // Array of activities/leads
        prospectId = body[0]?.RelatedProspectId || body[0]?.ProspectID || body[0]?.ProspectId;
      } else {
        prospectId = body?.ProspectID || body?.ProspectId || body?.RelatedProspectId || body?.entityId;
      }
    }

    if (!prospectId) {
      console.warn('[LSQ Webhook] No prospect ID found in payload:', JSON.stringify(body).substring(0, 500));
      return NextResponse.json(
        { success: false, error: 'No prospect ID found in webhook payload' },
        { status: 400 }
      );
    }

    console.log(`[LSQ Webhook] Received event: type=${eventType}, entityType=${entityType}, prospectId=${prospectId}`);

    // ---- Sync the lead ----
    const result = await syncSingleLead(prospectId, 'webhook');

    return NextResponse.json({
      success: true,
      data: {
        prospectId,
        action: result.leadsCreated > 0 ? 'created'
              : result.leadsUpdated > 0 ? 'updated'
              : 'skipped',
        errors: result.errors,
        durationMs: result.durationMs,
      },
    });
  } catch (error) {
    console.error('[LSQ Webhook] Error processing webhook:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Also support GET for webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('challenge');

  // Some webhook systems send a verification challenge
  if (challenge) {
    return NextResponse.json({ challenge });
  }

  return NextResponse.json({
    success: true,
    message: 'LeadSquared webhook endpoint is active',
    timestamp: new Date().toISOString(),
  });
}
