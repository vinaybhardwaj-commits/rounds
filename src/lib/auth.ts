// ============================================
// Rounds — Custom Auth (JWT + bcrypt)
// No third-party auth library. Full control.
// ============================================

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';

// --- Constants ---
const COOKIE_NAME = 'rounds_session';
const JWT_EXPIRY = '7d'; // 7 days for normal login
const SALT_ROUNDS = 10;

// --- JWT helpers ---

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return new TextEncoder().encode(secret);
}

export interface JWTPayload {
  profileId: string;
  email: string;
  role: string;
  status: string;
}

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// --- Cookie helpers ---

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function getSessionCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// --- Get current user from cookie ---

export async function getCurrentUser(): Promise<JWTPayload | null> {
  const token = await getSessionCookie();
  if (!token) return null;
  return verifyToken(token);
}

// --- Password (4-digit PIN) helpers ---

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

// --- Validation ---

export function isValidEvenEmail(email: string): boolean {
  return email.toLowerCase().endsWith('@even.in');
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// --- Superuser check ---
const SUPERUSER_EMAIL = 'vinay.bhardwaj@even.in';

export function isSuperuserEmail(email: string): boolean {
  return email.toLowerCase() === SUPERUSER_EMAIL;
}
