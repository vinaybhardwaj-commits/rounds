import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { auth } from '@/lib/auth';

// Lazy-init: avoid calling neon() at module load (breaks build without POSTGRES_URL)
let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}
function sqlQuery(text: string, params: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(text, params as never[]);
}

// GET /api/profiles — list all profiles (admin only) or search
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as Record<string, unknown>;
  const isAdmin = user.role === 'super_admin' || user.role === 'department_head';

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const department = searchParams.get('department') || '';
  const role = searchParams.get('role') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = (page - 1) * limit;

  try {
    let queryText = `
      SELECT p.*, d.name as department_name
      FROM profiles p
      LEFT JOIN departments d ON p.department_id = d.id
      WHERE p.is_active = true
    `;
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (search) {
      queryText += ` AND (p.full_name ILIKE $${paramIdx} OR p.email ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (department) {
      queryText += ` AND d.slug = $${paramIdx}`;
      params.push(department);
      paramIdx++;
    }

    if (role) {
      queryText += ` AND p.role = $${paramIdx}`;
      params.push(role);
      paramIdx++;
    }

    queryText += ` ORDER BY p.full_name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const rows = await sqlQuery(queryText, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) as count FROM profiles p LEFT JOIN departments d ON p.department_id = d.id WHERE p.is_active = true`;
    const countParams: string[] = [];
    let countIdx = 1;

    if (search) {
      countQuery += ` AND (p.full_name ILIKE $${countIdx} OR p.email ILIKE $${countIdx})`;
      countParams.push(`%${search}%`);
      countIdx++;
    }
    if (department) {
      countQuery += ` AND d.slug = $${countIdx}`;
      countParams.push(department);
      countIdx++;
    }
    if (role) {
      countQuery += ` AND p.role = $${countIdx}`;
      countParams.push(role);
    }

    const countResult = await sqlQuery(countQuery, countParams);
    const total = parseInt(String((countResult[0] as Record<string, unknown>).count));

    // Sanitize output for non-admins
    const profiles = isAdmin
      ? rows
      : rows.map((p: Record<string, unknown>) => ({
          id: p.id,
          full_name: p.full_name,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          role: p.role,
          department_name: p.department_name,
          designation: p.designation,
        }));

    return NextResponse.json({
      success: true,
      data: profiles,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/profiles error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch profiles' }, { status: 500 });
  }
}

// POST /api/profiles — create a single profile (admin only)
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as Record<string, unknown>;
  if (user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, full_name, role, department_id, designation, phone } = body;

    if (!email || !full_name) {
      return NextResponse.json({ success: false, error: 'email and full_name are required' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO profiles (email, full_name, role, department_id, designation, phone, account_type)
      VALUES (
        ${email},
        ${full_name},
        ${role || 'staff'},
        ${department_id || null},
        ${designation || null},
        ${phone || null},
        ${email.endsWith('@even.in') ? 'internal' : 'guest'}
      )
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        department_id = EXCLUDED.department_id,
        designation = EXCLUDED.designation,
        phone = EXCLUDED.phone,
        updated_at = NOW()
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error) {
    console.error('POST /api/profiles error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create profile' }, { status: 500 });
  }
}
