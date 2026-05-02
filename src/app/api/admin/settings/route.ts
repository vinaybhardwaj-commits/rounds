// =============================================================================
// /api/admin/settings — read + update entries in app_settings
// 1 May 2026 (sub-sprint D.1)
//
// GET    super_admin only — returns all rows with key/value/description/updated_at
// PATCH  super_admin only — body { key: string, value: unknown }
//        validates key is a known setting; upserts value + stamps updated_by/at.
//        Audit-logged via the standard audit() helper.
//
// Read-side feature-flag access for normal users goes through
// GET /api/settings/flags. This admin endpoint is for the toggle UI.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Allowlist of mutable settings. Adding a new feature flag requires:
//   1. Add the seed row in /api/admin/migrate
//   2. Add the key here so PATCH accepts it
//   3. Add a KEY_META entry in /admin/settings/page.tsx for the toggle UI
const MUTABLE_KEYS = new Set<string>([
  'ot_planning_enabled',
  // 2 May 2026 (PCW2.0): PAC Workspace v2 master toggle.
  'pac_workspace_v2_enabled',
]);

interface SettingsRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, ['super_admin'])) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403 },
      );
    }
    const rows = await query<SettingsRow>(
      `SELECT key, value, description, updated_at, updated_by::text AS updated_by
         FROM app_settings
        ORDER BY key`,
    );
    return NextResponse.json(
      { success: true, data: rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('GET /api/admin/settings error:', err);
    return NextResponse.json({ success: false, error: 'Failed to load settings' }, { status: 500 });
  }
}

interface PatchBody {
  key?: string;
  value?: unknown;
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user.role, ['super_admin'])) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as PatchBody;
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key) {
      return NextResponse.json({ success: false, error: 'key is required' }, { status: 400 });
    }
    if (!MUTABLE_KEYS.has(key)) {
      return NextResponse.json(
        { success: false, error: `key '${key}' is not a known mutable setting. Add it to MUTABLE_KEYS in /api/admin/settings/route.ts.` },
        { status: 400 },
      );
    }
    if (body.value === undefined) {
      return NextResponse.json({ success: false, error: 'value is required' }, { status: 400 });
    }

    // Read previous value for the audit payload.
    const prev = await queryOne<{ value: unknown }>(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
      [key],
    );

    const updated = await queryOne<{ key: string; value: unknown; updated_at: string }>(
      `INSERT INTO app_settings (key, value, updated_at, updated_by)
            VALUES ($1, $2::jsonb, NOW(), $3::uuid)
       ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
        RETURNING key, value, updated_at`,
      [key, JSON.stringify(body.value), user.profileId],
    );
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 });
    }

    // Best-effort audit. Non-fatal if it throws.
    try {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: null,
        action: 'admin.settings.update',
        targetType: 'app_setting',
        targetId: key,
        summary: `Updated app setting '${key}'`,
        payloadBefore: { value: prev?.value ?? null },
        payloadAfter: { value: body.value },
        request,
        mode: 'fire_and_forget',
      });
    } catch (auditErr) {
      console.warn('[audit] admin.settings.update non-fatal:', auditErr instanceof Error ? auditErr.message : auditErr);
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    console.error('PATCH /api/admin/settings error:', err);
    return NextResponse.json({ success: false, error: 'Failed to update setting' }, { status: 500 });
  }
}
