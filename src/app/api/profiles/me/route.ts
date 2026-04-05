import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// GET /api/profiles/me — get current user's profile
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const result = await sql`
      SELECT p.id, p.email, p.full_name, p.display_name, p.avatar_url,
             p.role, p.account_type, p.department_id, d.name as department_name, d.slug as department,
             p.designation, p.phone, p.status, p.is_active, p.created_at, p.last_login_at,
             p.first_login_at, p.last_active_at, p.login_count, p.total_session_seconds
      FROM profiles p
      LEFT JOIN departments d ON p.department_id = d.id
      WHERE p.id = ${user.profileId}
    `;

    if (result.length === 0) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error) {
    console.error('GET /api/profiles/me error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch profile' }, { status: 500 });
  }
}

// PATCH /api/profiles/me — update current user's own profile
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { full_name, designation, phone } = body;

    // Build dynamic update query
    const updates: string[] = [];
    const params: (string | null)[] = [];
    let paramIdx = 1;

    if (full_name !== undefined && full_name !== null) {
      updates.push(`full_name = $${paramIdx}`);
      params.push(full_name);
      paramIdx++;
    }

    if (designation !== undefined) {
      updates.push(`designation = $${paramIdx}`);
      params.push(designation);
      paramIdx++;
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramIdx}`);
      params.push(phone);
      paramIdx++;
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at, no changes
      return NextResponse.json({
        success: false,
        error: 'No fields to update',
      }, { status: 400 });
    }

    // Execute update
    params.push(user.profileId);
    const query = `
      UPDATE profiles
      SET ${updates.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING id, email, full_name, display_name, avatar_url,
                role, account_type, department_id, designation,
                phone, status, is_active, created_at, last_login_at
    `;

    const result = await sql(query as any, params as never[]);

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error) {
    console.error('PATCH /api/profiles/me error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
