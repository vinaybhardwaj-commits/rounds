// =============================================================================
// GET /api/ot-management/notes/history?hospital={slug}&limit=10
//
// Glass: any signed-in user can read the audit history of the OT coordinator
// notes pad for the hospital they have access to. Backs the inline "See
// history" modal in the Notes section (PRD Q3).
//
// Returns last N (default 10, max 50) audit_log rows where
// action='ot.coordinator_notes.updated' for the resolved hospital_id.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

interface HistoryRow {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_name: string | null;
  summary: string;
  payload_before: { body?: string } | null;
  payload_after: { body?: string } | null;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get('hospital') || '').trim().toLowerCase();
  if (!slug) return NextResponse.json({ success: false, error: 'hospital query param required' }, { status: 400 });
  const limitRaw = parseInt(searchParams.get('limit') || '10', 10);
  const limit = Math.max(1, Math.min(50, isNaN(limitRaw) ? 10 : limitRaw));

  const hospital = await queryOne<{ id: string; slug: string }>(
    `SELECT id::text AS id, slug FROM hospitals WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  if (!hospital) return NextResponse.json({ success: false, error: 'Hospital not found' }, { status: 404 });

  const access = await queryOne<{ allowed: boolean }>(
    `SELECT $1::uuid = ANY(user_accessible_hospital_ids($2::uuid)) AS allowed`,
    [hospital.id, user.profileId]
  );
  if (!access?.allowed) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rows = await query<HistoryRow>(
    `SELECT al.id::text AS id,
            al.ts::text AS ts,
            al.actor_id::text AS actor_id,
            p.full_name AS actor_name,
            al.summary,
            al.payload_before,
            al.payload_after
       FROM audit_log al
       LEFT JOIN profiles p ON p.id = al.actor_id
      WHERE al.action = 'ot.coordinator_notes.updated'
        AND al.hospital_id = $1::uuid
      ORDER BY al.ts DESC
      LIMIT $2`,
    [hospital.id, limit]
  );

  return NextResponse.json({ success: true, data: rows, count: rows.length });
}
