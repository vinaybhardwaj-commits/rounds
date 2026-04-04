import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser, hashPin, isValidPin, verifyPin } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// POST /api/auth/change-pin — user changes their own PIN (used after forced reset)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json();
  const { current_pin, new_pin } = body;

  if (!new_pin || !isValidPin(new_pin)) {
    return NextResponse.json({ success: false, error: 'New PIN must be exactly 4 digits' }, { status: 400 });
  }

  // Fetch current password hash
  const rows = await sql`
    SELECT password_hash, must_change_pin FROM profiles WHERE id = ${user.profileId}
  `;

  if (!rows.length) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
  }

  const profile = rows[0] as Record<string, unknown>;

  // If not a forced change, require current PIN verification
  if (!profile.must_change_pin) {
    if (!current_pin) {
      return NextResponse.json({ success: false, error: 'Current PIN is required' }, { status: 400 });
    }
    const valid = await verifyPin(current_pin, profile.password_hash as string);
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Current PIN is incorrect' }, { status: 401 });
    }
  } else {
    // For forced change, verify the temp PIN the admin set (so someone else can't just hit this endpoint)
    if (!current_pin) {
      return NextResponse.json({ success: false, error: 'Please enter your temporary PIN' }, { status: 400 });
    }
    const valid = await verifyPin(current_pin, profile.password_hash as string);
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Temporary PIN is incorrect' }, { status: 401 });
    }
  }

  // Don't allow the same PIN
  const samePin = await verifyPin(new_pin, profile.password_hash as string);
  if (samePin) {
    return NextResponse.json({ success: false, error: 'New PIN must be different from your current PIN' }, { status: 400 });
  }

  // Hash and save new PIN, clear the forced-change flag
  const newHash = await hashPin(new_pin);
  try {
    const result = await sql`
      UPDATE profiles
      SET password_hash = ${newHash}, must_change_pin = false, updated_at = NOW()
      WHERE id = ${user.profileId}
      RETURNING id
    `;
    if (!result.length) {
      return NextResponse.json({ success: false, error: 'Failed to update PIN — profile not found' }, { status: 500 });
    }
  } catch (err) {
    console.error('Change PIN DB error:', err);
    return NextResponse.json({ success: false, error: 'Failed to save new PIN. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: 'PIN changed successfully',
  });
}
