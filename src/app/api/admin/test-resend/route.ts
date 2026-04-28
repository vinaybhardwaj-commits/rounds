// =============================================================================
// POST /api/admin/test-resend — Send a test alert email via Resend (super_admin)
//
// Lets V verify Tier 3 cron alert wiring after adding RESEND_API_KEY +
// QA_ALERT_EMAIL to Vercel env, without waiting for a real qa-smoke failure.
//
// Returns structured status so V can see exactly what happened:
//   { api_key_set, alert_email, send_status, resend_id?, error? }
//
// NEVER throws on missing env vars — always returns 200 with diagnostic info.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function POST(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasRole(user.role, ['super_admin'])) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.QA_ALERT_EMAIL || 'vinay.bhardwaj@even.in';

  const status: {
    api_key_set: boolean;
    alert_email: string;
    send_status: 'skipped_no_key' | 'sent' | 'error';
    resend_id?: string;
    error?: string;
  } = {
    api_key_set: Boolean(apiKey),
    alert_email: alertEmail,
    send_status: 'skipped_no_key',
  };

  if (!apiKey) {
    return NextResponse.json({ success: true, data: status });
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
        to: [alertEmail],
        subject: 'QA Gates Tier 3 — Resend wiring verified',
        text:
          `This is a test alert sent from /api/admin/test-resend by ${user.email} at ${new Date().toISOString()}.\n\n` +
          `If you're reading this, your RESEND_API_KEY + QA_ALERT_EMAIL env vars are wired correctly. ` +
          `The hourly /api/cron/qa-smoke job will use this same path to send failure alerts.\n\n` +
          `If you did NOT trigger this, someone with super_admin access did. Audit log: /admin/audit-log\n`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.send_status = 'error';
      status.error = `Resend API ${res.status}: ${JSON.stringify(body)}`;
      return NextResponse.json({ success: false, data: status }, { status: 502 });
    }
    status.send_status = 'sent';
    status.resend_id = (body as { id?: string }).id;
    return NextResponse.json({ success: true, data: status });
  } catch (e) {
    status.send_status = 'error';
    status.error = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ success: false, data: status }, { status: 500 });
  }
}
