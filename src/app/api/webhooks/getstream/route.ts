// ============================================
// POST /api/webhooks/getstream
// Receives events from GetStream Chat.
// Signature-verified using GETSTREAM_API_SECRET.
// Bypasses auth middleware (no JWT cookie).
//
// Events handled:
// - message.new → cascade trigger (Phase 2)
// - custom commands → form triggers (Phase 2)
// Currently: logs events, returns 200
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';

/**
 * Verify GetStream webhook signature.
 * GetStream signs webhooks with the API secret using HMAC-SHA256.
 */
function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// --- Event Type Definitions ---

interface GetStreamWebhookEvent {
  type: string;
  message?: {
    id: string;
    text: string;
    user: { id: string; name?: string };
    channel_type?: string;
    channel_id?: string;
    // Custom extraData fields
    [key: string]: unknown;
  };
  channel?: {
    type: string;
    id: string;
    [key: string]: unknown;
  };
  user?: {
    id: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// --- Webhook Handler ---

export async function POST(request: NextRequest) {
  const secret = process.env.GETSTREAM_API_SECRET;
  if (!secret) {
    console.error('GETSTREAM_API_SECRET not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify signature
  const signature = request.headers.get('x-signature');
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.warn('GetStream webhook: invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse event
  let event: GetStreamWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Route by event type
  try {
    switch (event.type) {
      case 'message.new':
        await handleMessageNew(event);
        break;

      case 'message.read':
        // Future: update read receipts in our analytics
        break;

      case 'user.watching.start':
      case 'user.watching.stop':
        // Future: online presence tracking
        break;

      case 'health.check':
        // GetStream health check — just acknowledge
        break;

      default:
        // Log unhandled event types during development
        console.log(`GetStream webhook: unhandled event type "${event.type}"`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`GetStream webhook error (${event.type}):`, error);
    // Return 200 anyway — we don't want GetStream to retry on our app errors
    // Failed events should be logged and handled asynchronously
    return NextResponse.json({ success: true, warning: 'Handler error logged' });
  }
}

// --- Event Handlers ---

async function handleMessageNew(event: GetStreamWebhookEvent): Promise<void> {
  const message = event.message;
  if (!message) return;

  // Skip system/bot messages to prevent infinite loops
  if (message.user?.id === 'rounds-system') return;

  const messageType = (message as Record<string, unknown>).message_type as string || 'chat';
  const channelType = message.channel_type || event.channel?.type;
  const channelId = message.channel_id || event.channel?.id;

  // Only cascade non-chat messages (escalations, requests, decisions)
  if (messageType === 'chat' || messageType === 'general') return;

  // Log escalations to the escalation_log table for tracking
  if (messageType === 'escalation') {
    try {
      const sql = neon(process.env.POSTGRES_URL!);

      // Find patient_thread_id if this is a patient thread channel
      let patientThreadId: string | null = null;
      if (channelType === 'patient-thread' && channelId) {
        const rows = await sql(
          `SELECT id FROM patient_threads WHERE getstream_channel_id = $1 LIMIT 1`,
          [channelId]
        );
        if (rows.length > 0) patientThreadId = rows[0].id;
      }

      await sql(
        `INSERT INTO escalation_log (source_type, source_id, reason, patient_thread_id, getstream_channel_id, getstream_message_id, level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          'chat_message',
          message.id,
          message.text?.substring(0, 500) || 'Escalation via chat',
          patientThreadId,
          channelId ? `${channelType}:${channelId}` : null,
          message.id,
          1,
        ]
      );
    } catch (err) {
      console.error('[webhook] Failed to log escalation:', err);
    }
  }
}
