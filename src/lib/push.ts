// ============================================
// Push Notification Helpers
// Step 7.1: PWA Push Notifications
// ============================================

import webpush from 'web-push';
import { sql } from '@/lib/db';

// Configure VAPID — keys must be set in env; empty strings are treated as unconfigured
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim() || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT?.trim() || 'mailto:tech@even.in';
const VAPID_CONFIGURED = VAPID_PUBLIC_KEY.length > 0 && VAPID_PRIVATE_KEY.length > 0;

if (VAPID_CONFIGURED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else if (process.env.NODE_ENV === 'production') {
  console.error('[Push] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in production');
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  channelId?: string;
  tag?: string;
  urgent?: boolean;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Send push notification to a specific user (all their subscriptions)
 */
export async function sendPushToUser(
  profileId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!VAPID_CONFIGURED) {
    console.warn('[Push] VAPID keys not configured, skipping push');
    return { sent: 0, failed: 0 };
  }

  const subscriptions = await sql`
    SELECT id, subscription_json FROM push_subscriptions
    WHERE profile_id = ${profileId}
  `;

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  for (const row of subscriptions) {
    try {
      const sub = row.subscription_json as webpush.PushSubscription;
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired — mark for cleanup
        staleIds.push(row.id as string);
      }
      failed++;
    }
  }

  // Clean up stale subscriptions
  if (staleIds.length > 0) {
    await sql`DELETE FROM push_subscriptions WHERE id = ANY(${staleIds})`;
  }

  return { sent, failed };
}

/**
 * Send push notification to multiple users
 */
export async function sendPushToUsers(
  profileIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let totalSent = 0;
  let totalFailed = 0;

  for (const pid of profileIds) {
    const result = await sendPushToUser(pid, payload);
    totalSent += result.sent;
    totalFailed += result.failed;
  }

  return { sent: totalSent, failed: totalFailed };
}

/**
 * Send push to all active users (broadcast)
 */
export async function sendPushBroadcast(
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const profiles = await sql`
    SELECT DISTINCT profile_id FROM push_subscriptions
  `;
  const ids = profiles.map((r) => r.profile_id as string);
  return sendPushToUsers(ids, payload);
}
