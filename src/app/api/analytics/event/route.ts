// ============================================
// POST /api/analytics/event — Session event ingestion
// Receives batched analytics events from the
// client-side session tracker. Auth required
// (events are tied to the logged-in user).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      // Silently accept but don't store — user not logged in
      return NextResponse.json({ success: true });
    }

    const body = await request.json();
    const { sessionId, events } = body;

    if (!sessionId || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ success: true }); // Don't fail loudly
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // Batch insert all events
    let hasSessionStart = false;
    let sessionEndDuration = 0;

    for (const event of events.slice(0, 50)) { // Cap at 50 per request
      try {
        await sql(
          `INSERT INTO session_events (profile_id, event_type, page, feature, detail, session_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            user.profileId,
            (event.event_type || 'unknown').substring(0, 50),
            (event.page || '').substring(0, 255) || null,
            (event.feature || '').substring(0, 100) || null,
            event.detail ? JSON.stringify(event.detail).substring(0, 2000) : null,
            sessionId.substring(0, 36),
          ]
        );

        if (event.event_type === 'session_start') hasSessionStart = true;
        if (event.event_type === 'session_end' && event.detail?.duration_seconds) {
          sessionEndDuration = Number(event.detail.duration_seconds) || 0;
        }
      } catch {
        // Skip individual event failures
      }
    }

    // ── Lifecycle field updates ──
    // Update profiles on session_start/session_end (non-fatal)
    try {
      if (hasSessionStart) {
        await sql(
          `UPDATE profiles SET
            last_active_at = NOW(),
            login_count = COALESCE(login_count, 0) + 1,
            first_login_at = COALESCE(first_login_at, NOW())
          WHERE id = $1`,
          [user.profileId]
        );
      }
      if (sessionEndDuration > 0) {
        await sql(
          `UPDATE profiles SET
            total_session_seconds = COALESCE(total_session_seconds, 0) + $1
          WHERE id = $2`,
          [sessionEndDuration, user.profileId]
        );
      }
    } catch {
      // Non-fatal — lifecycle updates should never break event ingestion
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/analytics/event error:', error);
    // Never fail loudly — analytics should never break the app
    return NextResponse.json({ success: true });
  }
}
