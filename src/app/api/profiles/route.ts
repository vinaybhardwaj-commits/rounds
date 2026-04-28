import { NextRequest, NextResponse } from 'next/server';
import { withApiTelemetry } from '@/lib/api-telemetry';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { VALID_ROLES } from '@/lib/roles';

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
async function GET_inner(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = user.role === 'super_admin' || user.role === 'department_head';

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const department = searchParams.get('department') || '';
  const role = searchParams.get('role') || '';
  const status = searchParams.get('status') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = (page - 1) * limit;

  try {
    // MH.6 — JOIN hospitals to surface primary_hospital_slug + short_name on
    // each profile row (used by /admin/users HospitalChip render).
    let queryText = `
      SELECT p.*,
             d.name       as department_name,
             h.slug       as primary_hospital_slug,
             h.short_name as primary_hospital_short_name,
             h.name       as primary_hospital_name
      FROM profiles p
      LEFT JOIN departments d ON p.department_id = d.id
      LEFT JOIN hospitals   h ON h.id = p.primary_hospital_id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    let paramIdx = 1;

    // Non-admins only see active users
    if (!isAdmin) {
      queryText += ` AND p.status = 'active'`;
    }

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

    if (status && isAdmin) {
      queryText += ` AND p.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    queryText += ` ORDER BY p.full_name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const rows = await sqlQuery(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM profiles p LEFT JOIN departments d ON p.department_id = d.id WHERE 1=1`;
    const countParams: string[] = [];
    let countIdx = 1;

    if (!isAdmin) {
      countQuery += ` AND p.status = 'active'`;
    }
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
      countIdx++;
    }
    if (status && isAdmin) {
      countQuery += ` AND p.status = $${countIdx}`;
      countParams.push(status);
    }

    const countResult = await sqlQuery(countQuery, countParams);
    const total = parseInt(String((countResult[0] as Record<string, unknown>).count));

    // Sanitize output for non-admins (hide sensitive fields)
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
async function POST_inner(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, full_name, role, department_id, designation, phone, primary_hospital_id, role_scope } = body;

    if (!email || !full_name) {
      return NextResponse.json({ success: false, error: 'email and full_name are required' }, { status: 400 });
    }

    // Validate role against the UserRole enum
    const validatedRole = role && VALID_ROLES.includes(role) ? role : 'staff';

    // MH.7c — multi-hospital tenancy validation
    const VALID_SCOPES = new Set(['hospital_bound', 'multi_hospital', 'central']);
    const validatedScope = role_scope && VALID_SCOPES.has(role_scope) ? role_scope : 'hospital_bound';
    if (role_scope && !VALID_SCOPES.has(role_scope)) {
      return NextResponse.json({ success: false, error: `Invalid role_scope: ${role_scope}` }, { status: 400 });
    }
    // Verify primary_hospital_id exists if provided. profiles.primary_hospital_id is NOT NULL
    // post-MH.1 — fall back to EHRC if caller didn't pass one (back-compat for old admin flows).
    let resolvedPrimaryHospitalId: string | null = primary_hospital_id || null;
    if (resolvedPrimaryHospitalId) {
      const hExists = await sql`SELECT 1 AS ok FROM hospitals WHERE id = ${resolvedPrimaryHospitalId}::uuid` as Record<string, unknown>[];
      if (hExists.length === 0) {
        return NextResponse.json({ success: false, error: 'primary_hospital_id not found' }, { status: 400 });
      }
    } else {
      const ehrc = await sql`SELECT id::text AS id FROM hospitals WHERE slug = 'ehrc' LIMIT 1` as Record<string, string>[];
      resolvedPrimaryHospitalId = ehrc[0]?.id ?? null;
    }
    if (!resolvedPrimaryHospitalId) {
      return NextResponse.json({ success: false, error: 'No primary_hospital_id resolvable (EHRC fallback also missing)' }, { status: 500 });
    }

    const result = await sql`
      INSERT INTO profiles (email, full_name, role, department_id, designation, phone, account_type, status, primary_hospital_id, role_scope)
      VALUES (
        ${email.toLowerCase()},
        ${full_name},
        ${validatedRole},
        ${department_id || null},
        ${designation || null},
        ${phone || null},
        ${email.endsWith('@even.in') ? 'internal' : 'guest'},
        'active',
        ${resolvedPrimaryHospitalId}::uuid,
        ${validatedScope}
      )
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        department_id = EXCLUDED.department_id,
        designation = EXCLUDED.designation,
        phone = EXCLUDED.phone,
        primary_hospital_id = EXCLUDED.primary_hospital_id,
        role_scope = EXCLUDED.role_scope,
        updated_at = NOW()
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error) {
    console.error('POST /api/profiles error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create profile' }, { status: 500 });
  }
}

// AP.3 — telemetry-wrapped exports (auto-applied)
export const GET = withApiTelemetry('/api/profiles', GET_inner);
export const POST = withApiTelemetry('/api/profiles', POST_inner);
