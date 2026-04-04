// ============================================
// GET /api/push/vapid-key — returns VAPID public key
// Step 7.1: PWA Push Notifications
// ============================================

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      return NextResponse.json(
        { success: false, error: 'VAPID key not configured' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { publicKey },
    });
  } catch (error) {
    console.error('GET /api/push/vapid-key error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve VAPID key' },
      { status: 500 }
    );
  }
}
