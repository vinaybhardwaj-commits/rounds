import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
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
             p.status, p.created_at, d.name as department_name
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

// POST /api/admin/approvals — approve or reject a user
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { profileId, action } = body;

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

    const newStatus = action === 'approve' ? 'active' : 'rejected';

    const result = await sql`
      UPDATE profiles
      SET status = ${newStatus},
          approved_by = ${user.profileId},
          approved_at = NOW()
      WHERE id = ${profileId} AND status = 'pending_approval'
      RETURNING id, email, full_name, status
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
