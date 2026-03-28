import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ success: true, message: 'Logged out' });
}

export async function GET() {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/auth/login', process.env.NEXTAUTH_URL || 'http://localhost:3000'));
}
