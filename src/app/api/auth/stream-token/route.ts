// ============================================
// GET /api/auth/stream-token
// Returns a fresh GetStream token for the
// currently authenticated user. Called by the
// client when the stream token expires or on
// app reopen.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { generateStreamToken } from '@/lib/getstream';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const streamToken = generateStreamToken(user.profileId);

    return NextResponse.json({
      success: true,
      data: {
        stream_token: streamToken,
        user_id: user.profileId,
        api_key: process.env.NEXT_PUBLIC_GETSTREAM_API_KEY,
      },
    });
  } catch (error) {
    console.error('GET /api/auth/stream-token error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate stream token' },
      { status: 500 }
    );
  }
}
