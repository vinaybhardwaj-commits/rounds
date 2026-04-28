// =============================================================================
// /api/ot-management/notes — Coordinator notes per hospital (OT.3)
//
// GET ?hospital={slug} → { body, updated_by_name, updated_at }
// PUT ?hospital={slug}  body { body: string } → 200 with new state
//
// Glass: any signed-in user can read AND edit (PRD D8). Every PUT writes an
// audit_log row via audit() so /admin/audit-log + the inline history modal
// can show diffs over time.
//
// Body cap 4 KB enforced both at API layer (returns 413) and DB CHECK
// constraint (defensive; should never trip if API check works).
//
// Graceful degrade: if ot_coordinator_notes table doesn't exist (V hasn't
// run the OT.1 migration yet), GET returns empty + 200, PUT returns 503.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const MAX_BODY_BYTES = 4096;

async function resolveHospital(slug: string, userId: string) {
  const hospital = await queryOne<{ id: string; slug: string; name: string }>(
    `SELECT id::text AS id, slug, name FROM hospitals WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  if (!hospital) return { ok: false as const, status: 404, error: `Hospital '${slug}' not found` };
  const access = await queryOne<{ allowed: boolean }>(
    `SELECT $1::uuid = ANY(user_accessible_hospital_ids($2::uuid)) AS allowed`,
    [hospital.id, userId]
  );
  if (!access?.allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, hospital };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get('hospital') || '').trim().toLowerCase();
  if (!slug) return NextResponse.json({ success: false, error: 'hospital query param required' }, { status: 400 });

  const r = await resolveHospital(slug, user.profileId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: r.status });

  try {
    const row = await queryOne<{ body: string; updated_by_name: string | null; updated_at: string }>(
      `SELECT body, updated_by_name, updated_at::text AS updated_at
         FROM ot_coordinator_notes WHERE hospital_id = $1::uuid LIMIT 1`,
      [r.hospital.id]
    );
    return NextResponse.json({
      success: true,
      data: row || { body: '', updated_by_name: null, updated_at: null },
    });
  } catch (e) {
    // Table missing — return empty (V's migration not applied yet).
    console.warn('[notes:GET] table read failed (likely migration pending):', e instanceof Error ? e.message : e);
    return NextResponse.json({
      success: true,
      data: { body: '', updated_by_name: null, updated_at: null, _migration_pending: true },
    });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get('hospital') || '').trim().toLowerCase();
  if (!slug) return NextResponse.json({ success: false, error: 'hospital query param required' }, { status: 400 });

  const r = await resolveHospital(slug, user.profileId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: r.status });

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const newBody = typeof payload.body === 'string' ? payload.body : '';
  if (Buffer.byteLength(newBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: `Note exceeds ${MAX_BODY_BYTES} byte cap` },
      { status: 413 }
    );
  }

  // Resolve user's display name for the row (avoids audit-only history lookups for the chip).
  const me = await queryOne<{ full_name: string | null }>(
    `SELECT full_name FROM profiles WHERE id = $1::uuid LIMIT 1`,
    [user.profileId]
  );
  const displayName = me?.full_name || user.email || null;

  // Read prior body for the audit payload_before (diff source).
  let priorBody = '';
  try {
    const prior = await queryOne<{ body: string }>(
      `SELECT body FROM ot_coordinator_notes WHERE hospital_id = $1::uuid LIMIT 1`,
      [r.hospital.id]
    );
    priorBody = prior?.body || '';
  } catch {
    // Table missing — continue; UPSERT below will also fail with the same error
    // and we'll catch it.
  }

  try {
    await query(
      `INSERT INTO ot_coordinator_notes (hospital_id, body, updated_by, updated_by_name, updated_at)
            VALUES ($1::uuid, $2, $3::uuid, $4, NOW())
       ON CONFLICT (hospital_id) DO UPDATE
             SET body = EXCLUDED.body,
                 updated_by = EXCLUDED.updated_by,
                 updated_by_name = EXCLUDED.updated_by_name,
                 updated_at = NOW()`,
      [r.hospital.id, newBody, user.profileId, displayName]
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return NextResponse.json(
        {
          success: false,
          error: 'ot_coordinator_notes table not yet created. Run /api/admin/migrate as super_admin to apply Step 20.',
        },
        { status: 503 }
      );
    }
    throw e;
  }

  // Audit (fire-and-forget).
  await audit({
    actorId: user.profileId,
    actorRole: user.role,
    hospitalId: r.hospital.id,
    action: 'ot.coordinator_notes.updated',
    targetType: 'ot_coordinator_notes',
    targetId: null,
    summary: `Notes updated for ${r.hospital.slug.toUpperCase()} (${newBody.length} chars)`,
    payloadBefore: { body: priorBody },
    payloadAfter: { body: newBody },
    request,
  });

  return NextResponse.json({
    success: true,
    data: {
      body: newBody,
      updated_by_name: displayName,
      updated_at: new Date().toISOString(),
    },
  });
}
