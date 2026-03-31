import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}
function sqlQuery(text: string, params: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(text, params as never[]);
}

// GET /api/admin/approvals — list pending signups
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await sql`
      SELECT p.id, p.email, p.full_name, p.role, p.designation, p.phone,
             p.department_id, p.status, p.created_at, d.name as department_name
      FROM profiles p
      LEFT JOIN departments d ON p.department_id = d.id
      WHERE p.status = 'pending_approval'
      ORDER BY p.created_at ASC
    `;

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/admin/approvals error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch pending approvals' }, { status: 500 });
  }
}

// POST /api/admin/approvals — approve or reject a user (with optional profile edits)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { profileId, action, updates } = body;

    if (!profileId || !action) {
      return NextResponse.json(
        { success: false, error: 'profileId and action are required' },
        { status: 400 }
      );
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { success: false, error: 'action must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    // If approving with updates, apply them first
    if (action === 'approve' && updates) {
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (updates.full_name !== undefined) {
        setClauses.push(`full_name = $${paramIdx}`);
        params.push(updates.full_name);
        paramIdx++;
      }
      if (updates.role !== undefined) {
        setClauses.push(`role = $${paramIdx}`);
        params.push(updates.role);
        paramIdx++;
      }
      if (updates.department_id !== undefined) {
        setClauses.push(`department_id = $${paramIdx}`);
        params.push(updates.department_id || null);
        paramIdx++;
      }
      if (updates.designation !== undefined) {
        setClauses.push(`designation = $${paramIdx}`);
        params.push(updates.designation || null);
        paramIdx++;
      }
      if (updates.phone !== undefined) {
        setClauses.push(`phone = $${paramIdx}`);
        params.push(updates.phone || null);
        paramIdx++;
      }

      if (setClauses.length > 0) {
        const updateQuery = `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND status = 'pending_approval'`;
        params.push(profileId);
        await sqlQuery(updateQuery, params);
      }
    }

    const newStatus = action === 'approve' ? 'active' : 'rejected';

    const result = await sql`
      UPDATE profiles
      SET status = ${newStatus},
          approved_by = ${user.profileId},
          approved_at = NOW()
      WHERE id = ${profileId} AND status = 'pending_approval'
      RETURNING id, email, full_name, role, status
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Profile not found or not pending approval' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result[0],
      message: `User ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
    });
  } catch (error) {
    console.error('POST /api/admin/approvals error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process approval' },
      { status: 500 }
    );
  }
}
