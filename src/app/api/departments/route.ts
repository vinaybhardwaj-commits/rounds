import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// GET /api/departments — list all departments (public for signup form)
export async function GET() {
  try {
    const result = await sql`
      SELECT d.id, d.name, d.slug, d.is_active,
        (SELECT COUNT(*) FROM profiles pr WHERE pr.department_id = d.id AND pr.status = 'active') as member_count
      FROM departments d
      WHERE d.is_active = true
      ORDER BY d.name ASC
    `;

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/departments error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch departments' }, { status: 500 });
  }
}

// POST /api/departments — create or update a department (admin only)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, slug, head_profile_id } = body;

    if (!name || !slug) {
      return NextResponse.json({ success: false, error: 'name and slug are required' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO departments (name, slug, head_profile_id)
      VALUES (${name}, ${slug}, ${head_profile_id || null})
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        head_profile_id = EXCLUDED.head_profile_id
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error) {
    console.error('POST /api/departments error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create department' }, { status: 500 });
  }
}
