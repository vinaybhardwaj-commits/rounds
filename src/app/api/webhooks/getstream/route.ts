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

  // Log for development — will be replaced with cascade logic in Milestone 5
  console.log(
    `[webhook] message.new in ${message.channel_type}:${message.channel_id}`,
    `from ${message.user?.name || message.user?.id}`,
    `type: ${(message as Record<string, unknown>).message_type || 'chat'}`
  );

  // TODO (Milestone 5): Check if this message triggers a cascade
  // const messageType = message.message_type as string;
  // if (messageType && messageType !== 'chat') {
  //   await processCascadeTrigger(message);
  // }
}
