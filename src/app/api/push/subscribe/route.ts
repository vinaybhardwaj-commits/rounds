// ============================================
// POST /api/push/subscribe — store push subscription
// Step 7.1: PWA Push Notifications
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { subscription } = await request.json();
    if (!subscription?.endpoint) {
      return NextResponse.json(
        { success: false, error: 'Invalid subscription' },
        { status: 400 }
      );
    }

    // Upsert push subscription for this user+endpoint
    await sql`
      INSERT INTO push_subscriptions (profile_id, endpoint, subscription_json, created_at)
      VALUES (${user.profileId}, ${subscription.endpoint}, ${JSON.stringify(subscription)}::jsonb, NOW())
      ON CONFLICT (profile_id, endpoint)
      DO UPDATE SET subscription_json = ${JSON.stringify(subscription)}::jsonb, updated_at = NOW()
    `;

    return NextResponse.json({ success: true, message: 'Push subscription saved' });
  } catch (error) {
    console.error('POST /api/push/subscribe error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save subscription' },
      { status: 500 }
    );
  }
}
