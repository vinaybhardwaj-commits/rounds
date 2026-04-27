import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// GET /api/auth/me — get current user's full profile
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const result = await sql`
      SELECT p.id, p.email, p.full_name, p.display_name, p.avatar_url,
             p.role, p.account_type, p.department_id, p.designation,
             p.phone, p.status, p.is_active, p.created_at, p.last_login_at,
             p.primary_hospital_id::text AS primary_hospital_id,
             p.role_scope,
             d.name as department_name, d.slug as department_slug,
             h.slug       as primary_hospital_slug,
             h.short_name as primary_hospital_short_name,
             h.name       as primary_hospital_name
      FROM profiles p
      LEFT JOIN departments d ON p.department_id = d.id
      LEFT JOIN hospitals   h ON h.id = p.primary_hospital_id
      WHERE p.id = ${user.profileId}
    `;

    if (result.length === 0) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error) {
    console.error('GET /api/auth/me error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch profile' }, { status: 500 });
  }
}
