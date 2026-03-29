// ============================================
// POST /api/push/send — send push notification
// Admin-only endpoint for manual push sends.
// Step 7.1: PWA Push Notifications
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sendPushToUser, sendPushBroadcast } from '@/lib/push';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'department_head')) {
      return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 });
    }

    const body = await request.json();
    const { profileId, title, body: msgBody, url, broadcast } = body;

    if (!title || !msgBody) {
      return NextResponse.json(
        { success: false, error: 'title and body are required' },
        { status: 400 }
      );
    }

    const payload = { title, body: msgBody, url };

    if (broadcast) {
      const result = await sendPushBroadcast(payload);
      return NextResponse.json({ success: true, data: result, message: 'Broadcast sent' });
    }

    if (!profileId) {
      return NextResponse.json(
        { success: false, error: 'profileId required for targeted push' },
        { status: 400 }
      );
    }

    const result = await sendPushToUser(profileId, payload);
    return NextResponse.json({ success: true, data: result, message: 'Push sent' });
  } catch (error) {
    console.error('POST /api/push/send error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send push' },
      { status: 500 }
    );
  }
}
