// ============================================
// GET /api/admin/sessions/[sessionId]
// Returns full event timeline for a single session
// Protected: admin/super_admin only
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const sessionId = params.sessionId;

    // Get all events for this session, ordered chronologically
    const events = await sql(
      `SELECT
        se.id,
        se.event_type,
        se.page,
        se.feature,
        se.detail,
        se.created_at
      FROM session_events se
      WHERE se.session_id = $1
      ORDER BY se.created_at ASC`,
      [sessionId]
    );

    if (events.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    // Get the user info from the first event
    const profileId = await sql(
      `SELECT DISTINCT se.profile_id FROM session_events se WHERE se.session_id = $1 LIMIT 1`,
      [sessionId]
    );

    let userProfile = null;
    if (profileId.length > 0) {
      const profile = await sql(
        `SELECT p.id, p.full_name, p.email, p.avatar_url, p.role,
                d.name as department_name, d.slug as department_slug,
                p.first_login_at, p.login_count, p.total_session_seconds
        FROM profiles p
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.id = $1`,
        [profileId[0].profile_id]
      );
      userProfile = profile[0] || null;
    }

    // Get any errors during this session's time window
    const sessionStart = events[0].created_at;
    const sessionEnd = events[events.length - 1].created_at;

    const errors = await sql(
      `SELECT id, message, component, severity, created_at
      FROM app_errors
      WHERE profile_id = $1
        AND created_at BETWEEN $2 AND $3
      ORDER BY created_at ASC`,
      [profileId[0]?.profile_id, sessionStart, sessionEnd]
    );

    // Get any help interactions during this session
    const helpInteractions = await sql(
      `SELECT id, question, matched_features, response_source, context_page, helpful, created_at
      FROM help_interactions
      WHERE profile_id = $1
        AND created_at BETWEEN $2 AND $3
      ORDER BY created_at ASC`,
      [profileId[0]?.profile_id, sessionStart, sessionEnd]
    );

    // Calculate time spent on each page (time between consecutive page_view events)
    const timeline = events.map((evt: any, idx: number) => {
      let timeSpentSeconds: number | null = null;
      if (evt.event_type === 'page_view' && idx < events.length - 1) {
        const nextEvent = events[idx + 1];
        timeSpentSeconds = Math.round(
          (new Date(nextEvent.created_at).getTime() - new Date(evt.created_at).getTime()) / 1000
        );
      }

      return {
        id: evt.id,
        event_type: evt.event_type,
        page: evt.page,
        feature: evt.feature,
        detail: evt.detail,
        created_at: evt.created_at,
        time_spent_seconds: timeSpentSeconds,
      };
    });

    // Session summary
    const duration = Math.round(
      (new Date(sessionEnd).getTime() - new Date(sessionStart).getTime()) / 1000
    );

    return NextResponse.json({
      success: true,
      data: {
        session_id: sessionId,
        user: userProfile,
        summary: {
          start: sessionStart,
          end: sessionEnd,
          duration_seconds: duration,
          page_count: events.filter((e: any) => e.event_type === 'page_view').length,
          total_events: events.length,
          error_count: errors.length,
          help_count: helpInteractions.length,
          is_first_session: userProfile?.first_login_at
            ? new Date(userProfile.first_login_at).getTime() ===
              new Date(sessionStart).getTime()
            : false,
        },
        timeline,
        errors: errors.map((e: any) => ({
          id: e.id,
          message: e.message,
          component: e.component,
          severity: e.severity,
          created_at: e.created_at,
        })),
        help_interactions: helpInteractions.map((h: any) => ({
          id: h.id,
          question: h.question,
          matched_features: h.matched_features,
          response_source: h.response_source,
          context_page: h.context_page,
          helpful: h.helpful,
          created_at: h.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/sessions/[sessionId] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch session' },
      { status: 500 }
    );
  }
}
