import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { hashPin, isValidEvenEmail, isValidPin, isSuperuserEmail, createToken, setSessionCookie } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, full_name, pin, department_id, designation, phone, role } = body;

    // Validate required fields
    if (!email || !full_name || !pin) {
      return NextResponse.json(
        { success: false, error: 'Email, full name, and PIN are required' },
        { status: 400 }
      );
    }

    // Validate email domain
    if (!isValidEvenEmail(email)) {
      return NextResponse.json(
        { success: false, error: 'Only @even.in email addresses are allowed' },
        { status: 400 }
      );
    }

    // Validate PIN format (4 digits)
    if (!isValidPin(pin)) {
      return NextResponse.json(
        { success: false, error: 'PIN must be exactly 4 digits' },
        { status: 400 }
      );
    }

    // Check if email already registered
    const existing = await sql`SELECT id, status FROM profiles WHERE email = ${email.toLowerCase()}`;
    if (existing.length > 0) {
      const profile = existing[0] as Record<string, unknown>;
      if (profile.status === 'pending_approval') {
        return NextResponse.json(
          { success: false, error: 'This email is already registered and pending approval' },
          { status: 409 }
        );
      }
      if (profile.status === 'active') {
        return NextResponse.json(
          { success: false, error: 'This email is already registered. Please log in.' },
          { status: 409 }
        );
      }
      if (profile.status === 'rejected') {
        return NextResponse.json(
          { success: false, error: 'This account has been rejected. Please contact the administrator.' },
          { status: 403 }
        );
      }
    }

    // Hash the PIN
    const passwordHash = await hashPin(pin);

    // Determine status: superuser is auto-approved
    const isSuperuser = isSuperuserEmail(email);
    const status = isSuperuser ? 'active' : 'pending_approval';
    const userRole = isSuperuser ? 'super_admin' : (role || 'staff');

    // Create the profile
    const result = await sql`
      INSERT INTO profiles (
        email, full_name, password_hash, role, account_type,
        department_id, designation, phone, status
      ) VALUES (
        ${email.toLowerCase()},
        ${full_name},
        ${passwordHash},
        ${userRole},
        'internal',
        ${department_id || null},
        ${designation || null},
        ${phone || null},
        ${status}
      )
      RETURNING id, email, full_name, role, status
    `;

    const profile = result[0] as Record<string, unknown>;

    // If superuser, auto-login
    if (isSuperuser) {
      const token = await createToken({
        profileId: profile.id as string,
        email: profile.email as string,
        role: profile.role as string,
        status: 'active',
      });
      await setSessionCookie(token);

      return NextResponse.json({
        success: true,
        data: { ...profile, autoLogin: true },
        message: 'Account created and logged in (superuser)',
      });
    }

    return NextResponse.json({
      success: true,
      data: profile,
      message: 'Account created. Pending admin approval.',
    });
  } catch (error) {
    console.error('POST /api/auth/signup error:', error);
    return NextResponse.json(
      { success: false, error: 'Signup failed. Please try again.' },
      { status: 500 }
    );
  }
}
