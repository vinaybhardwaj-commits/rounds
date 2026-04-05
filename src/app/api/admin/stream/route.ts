// ============================================
// GET /api/admin/stream
// Server-Sent Events endpoint for live activity feed
// Protected: admin/super_admin only (via middleware)
// Uses Edge Runtime for efficient long-lived connections
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';

export const runtime = 'edge';

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds
const POLL_INTERVAL = 3_000; // 3 seconds
const MAX_LIFETIME = 295_000; // 295 seconds (just under 300s Vercel limit)

async function getEdgeUser(request: NextRequest) {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    const match = cookieHeader.match(/rounds_session=([^;]+)/);
    if (!match) return null;

    const secret = process.env.JWT_SECRET;
    if (!secret) return null;

    const { payload } = await jwtVerify(
      match[1],
      new TextEncoder().encode(secret)
    );

    return {
      profileId: payload.profileId as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  // Auth check (jose works in Edge Runtime)
  const user = await getEdgeUser(request);
  if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = neon(process.env.POSTGRES_URL!);
  let lastCheck = new Date();

  const stream = new ReadableStream(
    {
      async start(controller) {
        const encoder = new TextEncoder();

        function sendEvent(eventType: string, data: unknown) {
          const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        }

        try {
          // Send initial data: last events from each table
          try {
            const [initialActivity, initialErrors, initialLlm] = await Promise.all([
              sql(`SELECT profile_id as user_id, event_type, page, feature, detail, created_at FROM session_events ORDER BY created_at DESC LIMIT 10`).catch(() => []),
              sql(`SELECT profile_id as user_id, message, component, severity, created_at FROM app_errors ORDER BY created_at DESC LIMIT 5`).catch(() => []),
              sql(`SELECT triggered_by as user_id, analysis_type, status, model, latency_ms, tokens_prompt + tokens_completion as tokens, created_at FROM llm_logs ORDER BY created_at DESC LIMIT 5`).catch(() => []),
            ]);

            for (const evt of initialActivity) {
              sendEvent('activity', { ...evt, type: 'activity', ts: evt.created_at, message: `${evt.event_type}: ${evt.page || evt.feature || ''}`.trim(), category: evt.event_type?.includes('session') ? 'session' : evt.event_type?.includes('form') ? 'form' : evt.event_type?.includes('help') ? 'help' : 'feature' });
            }
            for (const err of initialErrors) {
              sendEvent('error_event', { ...err, type: 'error', ts: err.created_at, message: err.message || 'Error' });
            }
            for (const log of initialLlm) {
              sendEvent('llm', { ...log, type: 'llm', ts: log.created_at, analysis_type: log.analysis_type, latency_ms: log.latency_ms, tokens: log.tokens });
            }
          } catch (err) {
            console.error('Initial load failed:', err);
          }

          // Polling loop
          const startTime = Date.now();
          const heartbeatInterval = setInterval(() => {
            sendEvent('heartbeat', { timestamp: new Date().toISOString() });
          }, HEARTBEAT_INTERVAL);

          const pollInterval = setInterval(async () => {
            try {
              if (Date.now() - startTime > MAX_LIFETIME) {
                clearInterval(pollInterval);
                clearInterval(heartbeatInterval);
                controller.close();
                return;
              }

              const now = new Date();

              // Fetch new session events
              try {
                const newEvents = await sql(
                  `SELECT
                    profile_id as user_id,
                    event_type,
                    page,
                    feature,
                    detail,
                    created_at
                  FROM session_events
                  WHERE created_at > $1
                  ORDER BY created_at DESC
                  LIMIT 20`,
                  [lastCheck.toISOString()]
                );

                for (const evt of newEvents) {
                  sendEvent('activity', {
                    type: 'activity',
                    ts: evt.created_at,
                    message: `${evt.event_type}: ${evt.page || evt.feature || ''}`.trim(),
                    category: evt.event_type?.includes('session') ? 'session' : evt.event_type?.includes('form') ? 'form' : evt.event_type?.includes('help') ? 'help' : 'feature',
                    user_id: evt.user_id,
                    event_type: evt.event_type,
                    page: evt.page,
                    feature: evt.feature,
                  });
                }
              } catch {
                // Skip on error
              }

              // Fetch new errors
              try {
                const newErrors = await sql(
                  `SELECT
                    'error'::text as type,
                    profile_id as user_id,
                    message,
                    component,
                    severity,
                    created_at
                  FROM app_errors
                  WHERE created_at > $1
                  ORDER BY created_at DESC
                  LIMIT 20`,
                  [lastCheck.toISOString()]
                );

                for (const err of newErrors) {
                  sendEvent('error_event', {
                    type: 'error',
                    ts: err.created_at,
                    message: err.message || 'Error',
                    user_id: err.user_id,
                    component: err.component,
                    severity: err.severity,
                  });
                }
              } catch {
                // Skip on error
              }

              // Fetch new LLM logs
              try {
                const newLlmLogs = await sql(
                  `SELECT
                    triggered_by as user_id,
                    analysis_type,
                    status,
                    model,
                    latency_ms,
                    tokens_prompt,
                    tokens_completion,
                    created_at
                  FROM llm_logs
                  WHERE created_at > $1
                  ORDER BY created_at DESC
                  LIMIT 20`,
                  [lastCheck.toISOString()]
                );

                for (const log of newLlmLogs) {
                  sendEvent('llm', {
                    type: 'llm',
                    ts: log.created_at,
                    analysis_type: log.analysis_type,
                    latency_ms: log.latency_ms,
                    tokens: log.tokens_prompt + log.tokens_completion,
                    status: log.status,
                    model: log.model,
                    user_id: log.user_id,
                  });
                }
              } catch {
                // Skip on error
              }

              lastCheck = now;
            } catch (err) {
              console.error('Polling error:', err);
            }
          }, POLL_INTERVAL);
        } catch (err) {
          console.error('Stream start error:', err);
          controller.close();
        }
      },
      cancel() {
        // Clean up when client disconnects
      },
    },
    {
      highWaterMark: 1,
    }
  );

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
