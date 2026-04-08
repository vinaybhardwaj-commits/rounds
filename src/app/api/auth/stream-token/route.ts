// ============================================
// GET /api/auth/stream-token
// Returns a fresh GetStream token for the
// currently authenticated user. Called by the
// client when the stream token expires or on
// app reopen.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { generateStreamToken, syncUserToGetStream } from '@/lib/getstream';
import { queryOne } from '@/lib/db';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Re-sync user to GetStream on every token refresh to ensure
    // profile data (name, role, department) is always up-to-date.
    // Fixes: users who had a failed sync during login become invisible in DM search.
    try {
      const profile = await queryOne<{
        full_name: string;
        role: string;
        department_id: string | null;
      }>('SELECT full_name, role, department_id FROM profiles WHERE id = $1', [user.profileId]);

      if (profile) {
        await syncUserToGetStream({
          id: user.profileId,
          name: profile.full_name,
          email: user.email,
          role: profile.role,
          department_id: profile.department_id,
        });
      }
    } catch (syncErr) {
      // Non-fatal — log but still return the token
      console.error('GetStream re-sync on token refresh failed:', syncErr);
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
