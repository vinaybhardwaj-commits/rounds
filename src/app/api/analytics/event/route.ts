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
      } catch {
        // Skip individual event failures
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/analytics/event error:', error);
    // Never fail loudly — analytics should never break the app
    return NextResponse.json({ success: true });
  }
}
