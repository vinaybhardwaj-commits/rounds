// =============================================================================
// GET /api/tasks
//
// Lists pending coordinator tasks visible to the caller. A task is visible if:
//   - the task's hospital_id is in user_accessible_hospital_ids(caller), AND
//   - either:
//       a) assignee_profile_id = caller's profile_id (explicitly assigned),
//          OR
//       b) owner_role = caller's role (role-bucketed, no specific assignee),
//          OR
//       c) caller's role is 'super_admin' (sees everything in their hospitals).
//
// Joins patient + case for context so the panel can render rich rows without
// follow-up requests.
//
// Query params:
//   status — 'pending' (default) | 'in_progress' | 'done' | 'all'
//   limit  — default 100, max 500
//
// 25 Apr 2026 — Phase 3b of the IP Coordinator workflow loop.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface TaskRow {
  id: string;
  hospital_id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  assignee_profile_id: string | null;
  owner_role: string | null;
  due_at: string | null;
  status: string;
  source: string;
  source_ref: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // 26 Apr 2026 CT.2 additions (chat-tasks PRD v1.4 §6.1):
  priority: string;
  source_channel_id: string | null;
  source_channel_type: string | null;
  source_message_id: string | null;
  posted_message_id: string | null;
  // joined — patient_name / patient_thread_id / uhid are COALESCE'd across the
  // direct chat-task patient link (preferred) and the case-via-patient link.
  // Backward-compatible: existing keys (patient_name, patient_thread_id) remain
  // populated for callers that expected them.
  hospital_slug: string | null;
  patient_name: string | null;
  patient_thread_id: string | null;
  uhid: string | null;
  case_state: string | null;
  case_planned_procedure: string | null;
  case_planned_surgery_date: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const limitRaw = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Math.max(1, Math.min(500, isNaN(limitRaw) ? 100 : limitRaw));

    const conditions: string[] = ['t.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))'];
    const params: unknown[] = [user.profileId];

    // Visibility: assignee = me, OR owner_role = my role, OR I'm super_admin.
    if (user.role !== 'super_admin') {
      conditions.push(`(t.assignee_profile_id = $${params.length + 1}::UUID OR t.owner_role = $${params.length + 2}::TEXT)`);
      params.push(user.profileId);
      params.push(user.role);
    }

    if (status !== 'all') {
      conditions.push(`t.status = $${params.length + 1}::TEXT`);
      params.push(status);
    }

    const where = conditions.join(' AND ');

    const rows = await query<TaskRow>(
      `
      SELECT
        t.id, t.hospital_id, t.case_id, t.title, t.description,
        t.assignee_profile_id, t.owner_role, t.due_at, t.status,
        t.source, t.source_ref, t.metadata, t.created_by,
        t.completed_by, t.completed_at, t.created_at, t.updated_at,
        -- 26 Apr 2026 CT.2 additions (chat-tasks PRD v1.4 §6.1):
        t.priority,
        t.source_channel_id,
        t.source_channel_type,
        t.source_message_id,
        t.posted_message_id,
        h.slug AS hospital_slug,
        -- Patient context: chat-tasks carry a direct t.patient_thread_id link;
        -- auto-tasks carry it indirectly via surgical_case.patient_thread_id.
        -- COALESCE so callers see one consistent set of fields regardless of
        -- which path the task was created through. Backward-compatible.
        COALESCE(t.patient_thread_id, pt_via_case.id)              AS patient_thread_id,
        COALESCE(pt_direct.patient_name, pt_via_case.patient_name) AS patient_name,
        COALESCE(pt_direct.uhid, pt_via_case.uhid)                 AS uhid,
        sc.state                AS case_state,
        sc.planned_procedure    AS case_planned_procedure,
        sc.planned_surgery_date AS case_planned_surgery_date
      FROM tasks t
      LEFT JOIN hospitals       h            ON h.id            = t.hospital_id
      LEFT JOIN surgical_cases  sc           ON sc.id           = t.case_id
      LEFT JOIN patient_threads pt_via_case  ON pt_via_case.id  = sc.patient_thread_id
      -- CT.2: chat-tasks attach a patient directly without a surgical_case.
      LEFT JOIN patient_threads pt_direct    ON pt_direct.id    = t.patient_thread_id
      WHERE ${where}
      ORDER BY
        CASE t.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        t.due_at ASC NULLS LAST,
        t.created_at ASC
      LIMIT ${limit}
      `,
      params
    );

    return NextResponse.json({
      success: true,
      data: rows,
      count: rows.length,
    });
  } catch (error) {
    const e = error as { message?: string; code?: string };
    console.error('GET /api/tasks error:', JSON.stringify({ message: e.message, code: e.code }));
    return NextResponse.json(
      { success: false, error: 'Failed to load tasks' },
      { status: 500 }
    );
  }
}
