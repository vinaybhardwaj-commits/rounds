import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
  try {
    await clearSessionCookie();
    return NextResponse.json({ success: true, message: 'Logged out' });
  } catch (error) {
    console.error('POST /api/auth/logout error:', error);
    return NextResponse.json({ success: false, error: 'Logout failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await clearSessionCookie();
    return NextResponse.redirect(new URL('/auth/login', request.nextUrl.origin));
  } catch (error) {
    console.error('GET /api/auth/logout error:', error);
    return NextResponse.redirect(new URL('/auth/login', request.nextUrl.origin));
  }
}
