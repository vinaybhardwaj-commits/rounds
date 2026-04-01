import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { verifyPin, createToken, setSessionCookie } from '@/lib/auth';
import { generateStreamToken, syncUserToGetStream, autoJoinDefaultChannels } from '@/lib/getstream';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// --- Simple rate limiting (in-memory, per serverless instance) ---
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - entry.count };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, pin } = body;

    if (!email || !pin) {
      return NextResponse.json(
        { success: false, error: 'Email and PIN are required' },
        { status: 400 }
      );
    }

    // Rate limit by email (normalized)
    const rateLimitKey = email.toLowerCase().trim();
    const { allowed, remaining } = checkRateLimit(rateLimitKey);
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many login attempts. Please wait 15 minutes and try again.' },
        { status: 429 }
      );
    }

    // Find the profile (with department slug for auto-join)
    // Note: must_change_pin may not exist until migration v9 runs — query it safely
    let result;
    try {
      result = await sql`
        SELECT p.id, p.email, p.full_name, p.role, p.status, p.password_hash, p.account_type, p.department_id,
               p.must_change_pin, d.slug as department_slug
        FROM profiles p
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.email = ${email.toLowerCase()}
      `;
    } catch {
      // Fallback if must_change_pin column doesn't exist yet
      result = await sql`
        SELECT p.id, p.email, p.full_name, p.role, p.status, p.password_hash, p.account_type, p.department_id,
               false as must_change_pin, d.slug as department_slug
        FROM profiles p
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.email = ${email.toLowerCase()}
      `;
    }

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No account found with this email. Please sign up first.' },
        { status: 401 }
      );
    }

    const profile = result[0] as Record<string, unknown>;

    // Check account status
    if (profile.status === 'pending_approval') {
      return NextResponse.json(
        { success: false, error: 'Your account is pending admin approval. Please check back later.' },
        { status: 403 }
      );
    }

    if (profile.status === 'suspended') {
      return NextResponse.json(
        { success: false, error: 'Your account has been suspended. Please contact the administrator.' },
        { status: 403 }
      );
    }

    if (profile.status === 'rejected') {
      return NextResponse.json(
        { success: false, error: 'Your account has been rejected. Please contact the administrator.' },
        { status: 403 }
      );
    }

    // Check if password_hash exists (legacy profiles without PIN)
    if (!profile.password_hash) {
      return NextResponse.json(
        { success: false, error: 'No PIN set for this account. Please sign up again or contact the administrator.' },
        { status: 401 }
      );
    }

    // Verify PIN
    const isValid = await verifyPin(pin, profile.password_hash as string);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Incorrect PIN. Please try again.' },
        { status: 401 }
      );
    }

    // Update last_login_at
    await sql`
      UPDATE profiles SET last_login_at = NOW(), last_seen_at = NOW()
      WHERE id = ${profile.id as string}
    `;

    // Create JWT and set cookie
    const token = await createToken({
      profileId: profile.id as string,
      email: profile.email as string,
      role: profile.role as string,
      status: profile.status as string,
    });
    await setSessionCookie(token);

    // Sync user to GetStream and generate stream token
    let streamToken: string | null = null;
    try {
      await syncUserToGetStream({
        id: profile.id as string,
        name: profile.full_name as string,
        email: profile.email as string,
        role: profile.role as string,
        department_id: profile.department_id as string | null,
      });
      streamToken = generateStreamToken(profile.id as string);

      // Auto-join default channels (department + broadcast + all depts for super_admin)
      await autoJoinDefaultChannels(
        profile.id as string,
        profile.department_slug as string | null,
        profile.role as string | null
      );
    } catch (streamError) {
      // Log but don't fail login — chat is degraded, not broken
      console.error('GetStream sync failed during login:', streamError);
    }

    return NextResponse.json({
      success: true,
      data: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        department_id: profile.department_id,
        stream_token: streamToken,
        must_change_pin: Boolean(profile.must_change_pin),
      },
      message: 'Logged in successfully',
    });
  } catch (error) {
    console.error('POST /api/auth/login error:', error);
    return NextResponse.json(
      { success: false, error: 'Login failed. Please try again.' },
      { status: 500 }
    );
  }
}
