import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { hashPin, isValidPin } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// GET /api/admin/profiles/[id] — fetch single profile with department info
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'super_admin' && user.role !== 'department_head')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const rows = await sql`
    SELECT p.id, p.email, p.full_name, p.display_name, p.role, p.status,
           p.designation, p.phone, p.department_id, p.account_type,
           d.name as department_name, d.slug as department_slug,
           p.created_at, p.last_login_at,
           (p.password_hash IS NOT NULL) as has_pin
    FROM profiles p
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.id = ${id}
  `;

  if (!rows.length) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: rows[0] });
}

// PATCH /api/admin/profiles/[id] — update profile fields + optional PIN reset
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'super_admin' && user.role !== 'department_head')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  // Prevent department_heads from editing super_admins
  if (user.role === 'department_head') {
    const target = await sql`SELECT role FROM profiles WHERE id = ${id}`;
    if (target.length && (target[0] as Record<string, string>).role === 'super_admin') {
      return NextResponse.json({ success: false, error: 'Cannot edit super admin' }, { status: 403 });
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  // Allowed fields
  const allowedFields: Record<string, string> = {
    full_name: 'full_name',
    display_name: 'display_name',
    email: 'email',
    role: 'role',
    status: 'status',
    designation: 'designation',
    phone: 'phone',
    department_id: 'department_id',
    account_type: 'account_type',
  };

  for (const [key, col] of Object.entries(allowedFields)) {
    if (key in body && body[key] !== undefined) {
      updates.push(`${col} = $${paramIdx}`);
      values.push(body[key] === '' ? null : body[key]);
      paramIdx++;
    }
  }

  // Handle PIN reset separately
  if (body.new_pin) {
    if (!isValidPin(body.new_pin)) {
      return NextResponse.json({ success: false, error: 'PIN must be exactly 4 digits' }, { status: 400 });
    }
    const hash = await hashPin(body.new_pin);
    updates.push(`password_hash = $${paramIdx}`);
    values.push(hash);
    paramIdx++;
  }

  if (updates.length === 0) {
    return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
  }

  updates.push(`updated_at = NOW()`);
  values.push(id); // for WHERE clause

  const query = `
    UPDATE profiles
    SET ${updates.join(', ')}
    WHERE id = $${paramIdx}
    RETURNING id, email, full_name, role, status, designation, phone, department_id
  `;

  // Use raw sql for dynamic query
  const result = await _sql!(query, values);

  if (!result.length) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: result[0] });
}
