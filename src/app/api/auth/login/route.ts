import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { verifyPin, createToken, setSessionCookie } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
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

    // Find the profile
    const result = await sql`
      SELECT id, email, full_name, role, status, password_hash, account_type
      FROM profiles
      WHERE email = ${email.toLowerCase()}
    `;

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

    return NextResponse.json({
      success: true,
      data: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
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
