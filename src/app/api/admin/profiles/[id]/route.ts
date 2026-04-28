import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { hashPin, isValidPin } from '@/lib/auth';
import { isValidRole } from '@/lib/roles';

// Force Vercel to regenerate the serverless function with all HTTP methods
export const dynamic = 'force-dynamic';

// _rawSql: for dynamic queries (string + params). sql: tagged template wrapper for safe queries.
let _rawSql: ReturnType<typeof neon> | null = null;
function getRawSql() {
  if (!_rawSql) _rawSql = neon(process.env.POSTGRES_URL!);
  return _rawSql;
}
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return getRawSql()(strings, ...values);
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
           p.primary_hospital_id::text AS primary_hospital_id,
           p.role_scope,
           d.name as department_name, d.slug as department_slug,
           h.slug       as primary_hospital_slug,
           h.short_name as primary_hospital_short_name,
           h.name       as primary_hospital_name,
           p.created_at, p.last_login_at,
           (p.password_hash IS NOT NULL) as has_pin
    FROM profiles p
    LEFT JOIN departments d ON d.id = p.department_id
    LEFT JOIN hospitals   h ON h.id = p.primary_hospital_id
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
    // MH.7c — multi-hospital tenancy fields editable from /admin/users edit modal
    primary_hospital_id: 'primary_hospital_id',
    role_scope: 'role_scope',
  };
  const VALID_SCOPES = new Set(['hospital_bound', 'multi_hospital', 'central']);

  for (const [key, col] of Object.entries(allowedFields)) {
    if (key in body && body[key] !== undefined) {
      // Validate role against the UserRole enum
      if (key === 'role' && !isValidRole(body[key])) {
        return NextResponse.json({ success: false, error: `Invalid role: ${body[key]}` }, { status: 400 });
      }
      // MH.7c — validate role_scope enum
      if (key === 'role_scope' && body[key] && !VALID_SCOPES.has(body[key])) {
        return NextResponse.json({ success: false, error: `Invalid role_scope: ${body[key]}. Must be one of: hospital_bound, multi_hospital, central.` }, { status: 400 });
      }
      // MH.7c — validate primary_hospital_id is a real hospital + active (skip if blanking to null)
      if (key === 'primary_hospital_id' && body[key]) {
        const exists = await sql`SELECT 1 AS ok FROM hospitals WHERE id = ${body[key]}::uuid` as Record<string, unknown>[];
        if (exists.length === 0) {
          return NextResponse.json({ success: false, error: `primary_hospital_id not found in hospitals table` }, { status: 400 });
        }
      }
      updates.push(`${col} = $${paramIdx}`);
      values.push(body[key] === '' ? null : body[key]);
      paramIdx++;
    }
  }

  // Handle PIN reset separately — also force user to change it on next login
  if (body.new_pin) {
    if (!isValidPin(body.new_pin)) {
      return NextResponse.json({ success: false, error: 'PIN must be exactly 4 digits' }, { status: 400 });
    }
    const hash = await hashPin(body.new_pin);
    updates.push(`password_hash = $${paramIdx}`);
    values.push(hash);
    paramIdx++;
    updates.push(`must_change_pin = $${paramIdx}`);
    values.push(true);
    paramIdx++;

    // Auto-activate if currently pending — admin resetting PIN implies approval
    const statusAlreadyInPayload = 'status' in body;
    if (!statusAlreadyInPayload) {
      const current = await sql`SELECT status FROM profiles WHERE id = ${id}`;
      if (current.length && (current[0] as Record<string, string>).status === 'pending_approval') {
        updates.push(`status = $${paramIdx}`);
        values.push('active');
        paramIdx++;
      }
    }
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
  const result = await getRawSql()(query, values);

  if (!result.length) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: result[0] });
}

// DELETE /api/admin/profiles/[id] — permanently remove a user while preserving all history
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Only super admins can delete users' }, { status: 403 });
  }

  const { id } = await params;

  // Cannot delete yourself
  if (id === user.profileId) {
    return NextResponse.json({ success: false, error: 'You cannot delete your own account' }, { status: 400 });
  }

  // Fetch the profile to snapshot before deletion
  const rows = await sql`
    SELECT p.id, p.email, p.full_name, p.role, p.status, p.designation,
           p.phone, p.department_id, d.name as department_name,
           p.created_at, p.last_login_at
    FROM profiles p
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.id = ${id}
  `;

  if (!rows.length) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
  }

  const profile = rows[0] as Record<string, unknown>;

  try {
    // 1. Snapshot into deleted_profiles audit table
    await sql`
      INSERT INTO deleted_profiles (
        original_id, email, full_name, role, designation, department_name,
        created_at, last_login_at, deleted_by
      ) VALUES (
        ${id}, ${profile.email}, ${profile.full_name}, ${profile.role},
        ${profile.designation}, ${profile.department_name},
        ${profile.created_at}, ${profile.last_login_at}, ${user.profileId}
      )
    `;

    // 2. Nullify all FK references across operational tables
    //    This preserves the rows but removes the link to the profile.
    //    The deleted_profiles table lets us look up who the person was.
    //    IMPORTANT: If you add a new table with a FK to profiles.id,
    //    you MUST add a corresponding nullify query here.
    const rawSql = getRawSql();

    const nullifyQueries = [
      // Patient threads
      `UPDATE patient_threads SET primary_consultant_id = NULL WHERE primary_consultant_id = $1`,
      `UPDATE patient_threads SET created_by = NULL WHERE created_by = $1`,
      `UPDATE patient_threads SET archived_by = NULL WHERE archived_by = $1`,
      // Form submissions (submitted_by is already nullable per schema)
      `UPDATE form_submissions SET submitted_by = NULL WHERE submitted_by = $1`,
      // Readiness items
      `UPDATE readiness_items SET responsible_user_id = NULL WHERE responsible_user_id = $1`,
      `UPDATE readiness_items SET confirmed_by = NULL WHERE confirmed_by = $1`,
      // Escalation log
      `UPDATE escalation_log SET escalated_from = NULL WHERE escalated_from = $1`,
      `UPDATE escalation_log SET escalated_to = NULL WHERE escalated_to = $1`,
      `UPDATE escalation_log SET resolved_by = NULL WHERE resolved_by = $1`,
      // Admission tracker
      `UPDATE admission_tracker SET admitted_by = NULL WHERE admitted_by = $1`,
      `UPDATE admission_tracker SET primary_surgeon_id = NULL WHERE primary_surgeon_id = $1`,
      `UPDATE admission_tracker SET ip_coordinator_id = NULL WHERE ip_coordinator_id = $1`,
      // Duty roster (user_id is already nullable per schema)
      `UPDATE duty_roster SET user_id = NULL WHERE user_id = $1`,
      // Deleted messages audit (deleted_by_id is already nullable per schema)
      `UPDATE deleted_messages SET deleted_by_id = NULL WHERE deleted_by_id = $1`,
      // Discharge milestones
      `UPDATE discharge_milestones SET discharge_ordered_by = NULL WHERE discharge_ordered_by = $1`,
      `UPDATE discharge_milestones SET pharmacy_cleared_by = NULL WHERE pharmacy_cleared_by = $1`,
      `UPDATE discharge_milestones SET lab_cleared_by = NULL WHERE lab_cleared_by = $1`,
      `UPDATE discharge_milestones SET discharge_summary_by = NULL WHERE discharge_summary_by = $1`,
      `UPDATE discharge_milestones SET billing_closed_by = NULL WHERE billing_closed_by = $1`,
      `UPDATE discharge_milestones SET final_bill_submitted_by = NULL WHERE final_bill_submitted_by = $1`,
      `UPDATE discharge_milestones SET final_approval_logged_by = NULL WHERE final_approval_logged_by = $1`,
      `UPDATE discharge_milestones SET patient_settled_by = NULL WHERE patient_settled_by = $1`,
      // Insurance claims
      `UPDATE insurance_claims SET created_by = NULL WHERE created_by = $1`,
      // OT readiness audit log (performed_by is already nullable per schema)
      `UPDATE ot_readiness_audit_log SET performed_by = NULL WHERE performed_by = $1`,
      // Surgery postings (posted_by is already nullable per schema)
      `UPDATE surgery_postings SET posted_by = NULL WHERE posted_by = $1`,
      `UPDATE surgery_postings SET primary_surgeon_id = NULL WHERE primary_surgeon_id = $1`,
      `UPDATE surgery_postings SET anaesthesiologist_id = NULL WHERE anaesthesiologist_id = $1`,
      `UPDATE surgery_postings SET asa_confirmed_by = NULL WHERE asa_confirmed_by = $1`,
      // OT readiness items
      `UPDATE ot_readiness_items SET responsible_user_id = NULL WHERE responsible_user_id = $1`,
      `UPDATE ot_readiness_items SET confirmed_by = NULL WHERE confirmed_by = $1`,
      `UPDATE ot_readiness_items SET escalated_to = NULL WHERE escalated_to = $1`,
      // App errors
      `UPDATE app_errors SET profile_id = NULL WHERE profile_id = $1`,
    ];

    for (const query of nullifyQueries) {
      try {
        await rawSql(query, [id]);
      } catch (e) {
        // Some tables may not exist yet — log and skip
        console.warn(`[DeleteProfile] Skipping nullify query (table may not exist): ${query.substring(0, 60)}`, e);
      }
    }

    // 3. Delete the profile row (cascades handle session_events, help_*, push_subs, dau)
    await sql`DELETE FROM profiles WHERE id = ${id}`;

    return NextResponse.json({
      success: true,
      message: `User ${profile.full_name} (${profile.email}) has been permanently deleted. All their actions and history are preserved.`,
    });
  } catch (err) {
    console.error('Delete profile error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete profile. Please try again.' },
      { status: 500 }
    );
  }
}
