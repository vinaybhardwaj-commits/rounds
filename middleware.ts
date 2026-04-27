import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'rounds_session';

// Routes that don't require authentication
// Uses exact match to prevent unintended path matching (e.g. /auth/login-admin)
const PUBLIC_ROUTES = ['/auth/login', '/auth/signup', '/auth/pending'];
const PUBLIC_API_ROUTES = ['/api/auth/login', '/api/auth/signup', '/api/auth/logout'];

// Routes that bypass auth entirely (webhooks from external services)
const WEBHOOK_ROUTES = ['/api/webhooks/'];

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets, _next, favicon, manifest
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/manifest') ||
    pathname.startsWith('/icon-') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some(r => pathname === r)) {
    return NextResponse.next();
  }

  // Allow public API routes (exact match to prevent /api/auth/login-backdoor etc.)
  if (PUBLIC_API_ROUTES.some(r => pathname === r)) {
    return NextResponse.next();
  }

  // Allow webhook routes (GetStream, Vercel Cron, etc.)
  if (WEBHOOK_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Allow cron job routes (verified by Vercel's CRON_SECRET)
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next();
  }

  // Check for session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    // API routes return 401, pages redirect to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  // Verify JWT
  const secret = getJwtSecret();
  if (!secret) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);

    // Block non-active users from everything except /auth/pending
    if (payload.status !== 'active') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, error: 'Account pending approval' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/auth/pending', request.url));
    }

    // Block non-admins from /admin routes (both UI and API)
    // NOTE: department_heads get access to the /admin UI and some API routes.
    // Individual API handlers enforce finer-grained permissions (e.g. super_admin-only).
    // MH.3: hospital_admin can access /admin too; per-page filters scope to their hospital.
    if (pathname.startsWith('/admin') && payload.role !== 'super_admin' && payload.role !== 'department_head' && payload.role !== 'hospital_admin') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
  } catch {
    // Invalid or expired token — clear cookie and redirect to login
    const response = pathname.startsWith('/api/')
      ? NextResponse.json({ success: false, error: 'Session expired' }, { status: 401 })
      : NextResponse.redirect(new URL('/auth/login', request.url));

    response.cookies.delete(COOKIE_NAME);
    return response;
  }
}

export const config = {
  matcher: [
    // Match everything except static assets
    '/((?!_next/static|_next/image).*)',
  ],
};
