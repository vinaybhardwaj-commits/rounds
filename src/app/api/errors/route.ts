// ============================================
// POST /api/errors — Client error reporter
// Receives JS errors from the browser and logs
// them to the app_errors table. No auth required
// (errors can happen before/during login).
// Rate limited: max 20 per minute per IP.
//
// GET /api/errors — Admin error viewer
// Returns recent errors. super_admin only.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

// Simple in-memory rate limiter (resets on cold start, which is fine)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ success: false, error: 'Rate limited' }, { status: 429 });
    }

    const body = await request.json();
    const {
      message,
      stack,
      url,
      component,
      severity = 'error',
      userAgent,
      extra,
    } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 });
    }

    // Try to get user context if logged in
    let profileId: string | null = null;
    let userRole: string | null = null;
    try {
      const user = await getCurrentUser();
      if (user) {
        profileId = user.profileId;
        userRole = user.role;
      }
    } catch {
      // Not logged in — that's fine
    }

    const sql = neon(process.env.POSTGRES_URL!);

    await sql(
      `INSERT INTO app_errors (message, stack, url, component, severity, profile_id, user_role, user_agent, ip_address, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        message.substring(0, 1000),
        (stack || '').substring(0, 5000),
        (url || '').substring(0, 500),
        (component || '').substring(0, 200),
        severity,
        profileId,
        userRole,
        (userAgent || request.headers.get('user-agent') || '').substring(0, 500),
        ip,
        extra ? JSON.stringify(extra).substring(0, 2000) : null,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/errors failed:', error);
    // Don't fail loudly — error reporting should never break the app
    return NextResponse.json({ success: true });
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // Recent errors with counts
    const errors = await sql(`
      SELECT id, message, stack, url, component, severity, profile_id, user_role,
             user_agent, ip_address, extra, created_at
      FROM app_errors
      ORDER BY created_at DESC
      LIMIT 100
    `);

    // Error summary: count by message in last 24h
    const summary = await sql(`
      SELECT message, severity, COUNT(*)::int as count,
             MAX(created_at) as last_seen,
             MIN(created_at) as first_seen
      FROM app_errors
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY message, severity
      ORDER BY count DESC
      LIMIT 50
    `);

    return NextResponse.json({
      success: true,
      data: { errors, summary },
    });
  } catch (error) {
    console.error('GET /api/errors failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch errors' }, { status: 500 });
  }
}
