// ============================================
// PATCH /api/profiles/[id]
// Admin-only: update any profile's department,
// role, designation, etc.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin role required' }, { status: 403 });
    }

    const { id } = params;
    const body = await request.json();

    // Allowed fields for admin update
    const allowedFields = ['department_id', 'role', 'designation', 'full_name', 'phone', 'status'];
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${idx}`);
        values.push(body[field]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await queryOne(
      `UPDATE profiles SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, email, full_name, role, department_id, designation, phone, status`,
      values
    );

    if (!result) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('PATCH /api/profiles/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update profile' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const profile = await queryOne(
      `SELECT p.*, d.name as department_name, d.slug as department_slug
       FROM profiles p
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE p.id = $1`,
      [id]
    );

    if (!profile) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: profile });
  } catch (error) {
    console.error('GET /api/profiles/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get profile' }, { status: 500 });
  }
}
