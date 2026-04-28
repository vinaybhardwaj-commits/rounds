// =============================================================================
// GET /api/pac-workspace/[caseId]/suggest?asa=2&comorbidities=cardiac_disease,asthma&mode=in_person_opd
//
// Returns SOP-driven order + clearance suggestions for a case (PRD §10).
// Inputs derive from query params (PCW.2 manual entry); PCW.3 will auto-fill
// from intake form. Always returns the full lookup catalogs alongside so the
// UI can render both "suggested" and "all available" lists from one fetch.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import {
  suggestOrders,
  suggestClearances,
  type PacOrderTypeRow,
  type PacClearanceSpecialtyRow,
} from '@/lib/pac-workspace/sop-suggest';
import { VALID_PAC_MODES, type PacMode } from '@/lib/pac-workspace/types';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { caseId } = params;
    if (!UUID_RE.test(caseId)) {
      return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 });
    }

    const access = await queryOne<{ hospital_id: string }>(
      `SELECT sc.hospital_id::text AS hospital_id
         FROM surgical_cases sc
        WHERE sc.id = $1::uuid
          AND sc.archived_at IS NULL
          AND sc.hospital_id = ANY(user_accessible_hospital_ids($2::uuid))`,
      [caseId, user.profileId],
    );
    if (!access) {
      return NextResponse.json({ success: false, error: 'Case not found or access denied' }, { status: 404 });
    }

    const sp = new URL(request.url).searchParams;
    const asaRaw = sp.get('asa');
    const asa = asaRaw && /^[1-5]$/.test(asaRaw) ? Number(asaRaw) : null;
    const modeRaw = sp.get('mode') as PacMode | null;
    const mode: PacMode = modeRaw && VALID_PAC_MODES.includes(modeRaw) ? modeRaw : 'in_person_opd';
    const comorbidities = (sp.get('comorbidities') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const [ordersAll, clearancesAll] = await Promise.all([
      query<PacOrderTypeRow>(
        `SELECT code, label, category, sop_default_for_asa, sop_default_for_mode, active, hospital_id::text AS hospital_id
           FROM pac_order_types
          WHERE active = TRUE AND (hospital_id IS NULL OR hospital_id = $1::uuid)
          ORDER BY hospital_id NULLS LAST, code`,
        [access.hospital_id],
      ),
      query<PacClearanceSpecialtyRow>(
        `SELECT code, label, default_assignee_role, sop_trigger_comorbidities, active, hospital_id::text AS hospital_id
           FROM pac_clearance_specialties
          WHERE active = TRUE AND (hospital_id IS NULL OR hospital_id = $1::uuid)
          ORDER BY hospital_id NULLS LAST, code`,
        [access.hospital_id],
      ),
    ]);

    const orderCatalog = dedupByCode(ordersAll);
    const clearanceCatalog = dedupByCode(clearancesAll);

    const suggestedOrders = suggestOrders({ asa, comorbidities, mode }, orderCatalog);
    const suggestedClearances = suggestClearances({ asa, comorbidities, mode }, clearanceCatalog);

    return NextResponse.json({
      success: true,
      data: {
        inputs: { asa, mode, comorbidities },
        suggested_orders: suggestedOrders,
        suggested_clearances: suggestedClearances,
        order_catalog: orderCatalog,
        clearance_catalog: clearanceCatalog,
      },
    });
  } catch (error) {
    console.error('GET /api/pac-workspace/[caseId]/suggest error:', error);
    return NextResponse.json({ success: false, error: 'Suggest failed' }, { status: 500 });
  }
}

function dedupByCode<T extends { code: string; hospital_id: string | null }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const cur = map.get(r.code);
    if (!cur || (cur.hospital_id === null && r.hospital_id !== null)) {
      map.set(r.code, r);
    }
  }
  return Array.from(map.values());
}
