// =============================================================================
// GET /api/cron/qa-smoke — Production smoke cron (QA.5)
//
// Hourly cron (vercel.json) that hits a curated subset of authed endpoints
// against this same deploy. On any failure, emails V via Resend (graceful
// degrade to console.error if RESEND_API_KEY not set).
//
// Auth: Bearer CRON_SECRET (Vercel cron signature pattern).
//
// Manual prereqs (V to set in Vercel env):
//   CRON_SECRET           (already exists; shared with sla-sweeper)
//   QA_TEST_USER_EMAIL    test super_admin email
//   QA_TEST_USER_PIN      test super_admin PIN
//   QA_ALERT_EMAIL        recipient (default vinay.bhardwaj@even.in)
//   RESEND_API_KEY        Resend API key (optional; degrades to console.error)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface SmokeResult {
  pass: number;
  fail: number;
  failures: string[];
}

const ALERT_EMAIL = process.env.QA_ALERT_EMAIL || 'vinay.bhardwaj@even.in';
const SMOKE_USER_EMAIL = process.env.QA_TEST_USER_EMAIL || '';
const SMOKE_USER_PIN = process.env.QA_TEST_USER_PIN || '';

async function loginGetCookie(base: string): Promise<string | null> {
  if (!SMOKE_USER_EMAIL || !SMOKE_USER_PIN) return null;
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SMOKE_USER_EMAIL, pin: SMOKE_USER_PIN }),
    });
    if (!res.ok) return null;
    const setCookie = res.headers.get('set-cookie') || '';
    const m = setCookie.match(/rounds_session=[^;]+/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

async function checkEndpoint(base: string, cookie: string | null, method: string, path: string, expected: number, desc: string, result: SmokeResult): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    if (cookie) headers['Cookie'] = cookie;
    const res = await fetch(`${base}${path}`, { method, headers });
    if (res.status === expected) {
      result.pass++;
    } else {
      result.fail++;
      result.failures.push(`${method} ${path} → got ${res.status}, expected ${expected} (${desc})`);
    }
  } catch (e) {
    result.fail++;
    result.failures.push(`${method} ${path} → fetch threw: ${e instanceof Error ? e.message : 'unknown'} (${desc})`);
  }
}

async function sendAlertEmail(failures: string[], deployUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const subject = `QA Gates fail: ${failures.length} check(s) on ${deployUrl}`;
  const body = `QA smoke cron detected ${failures.length} failure(s) at ${new Date().toISOString()}\n\n` +
    `Deploy: ${deployUrl}\n\n` +
    `Failures:\n` +
    failures.map((f) => `  - ${f}`).join('\n') +
    `\n\nRollback: visit Vercel dashboard → rounds-sqxh → Deployments → promote previous READY deploy.\n` +
    `Or: git revert <bad-commit> && git push && [deploy hook]\n`;

  if (!apiKey) {
    console.error('[qa-smoke] RESEND_API_KEY not set; would have sent email:\n', subject, '\n', body);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'qa-bot@rounds.even.in',
        to: [ALERT_EMAIL],
        subject,
        text: body,
      }),
    });
    if (!res.ok) {
      console.error('[qa-smoke] Resend API failed:', res.status, await res.text());
    }
  } catch (e) {
    console.error('[qa-smoke] Email send threw:', e);
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const base = new URL(request.url).origin;
  const cookie = await loginGetCookie(base);
  const result: SmokeResult = { pass: 0, fail: 0, failures: [] };

  // Anon checks (always run)
  await checkEndpoint(base, null, 'GET', '/api/auth/me', 401, 'auth me anon', result);
  await checkEndpoint(base, null, 'GET', '/api/ot/readiness/mine', 401, 'readiness mine anon', result);

  // Authed checks (only if login succeeded)
  if (cookie) {
    await checkEndpoint(base, cookie, 'GET', '/api/auth/me', 200, 'authed me (catches session/JWT regressions)', result);
    await checkEndpoint(base, cookie, 'GET', '/api/ot/readiness/mine', 200, 'authed readiness mine (catches v1.1 #8 SQL bug class)', result);
    await checkEndpoint(base, cookie, 'GET', '/api/ot/readiness/overdue', 200, 'authed readiness overdue', result);
    await checkEndpoint(base, cookie, 'GET', '/api/admin/dashboard-stats', 200, 'authed dashboard', result);
    await checkEndpoint(base, cookie, 'GET', '/api/admin/audit-log', 200, 'authed audit-log', result);
    await checkEndpoint(base, cookie, 'GET', '/api/hospitals/accessible', 200, 'accessible hospitals', result);
  }

  if (result.fail > 0) {
    await sendAlertEmail(result.failures, base);
  }

  return NextResponse.json({
    success: result.fail === 0,
    pass: result.pass,
    fail: result.fail,
    failures: result.failures,
    auth_session: cookie ? 'available' : 'missing (set QA_TEST_USER_EMAIL + QA_TEST_USER_PIN)',
    timestamp: new Date().toISOString(),
  }, { status: result.fail === 0 ? 200 : 500 });
}
