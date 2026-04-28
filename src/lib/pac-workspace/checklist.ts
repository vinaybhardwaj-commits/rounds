// =============================================================================
// PAC Coordinator Workspace v1 — checklist seeding helper
//
// Reads a template from pac_checklist_templates (by code) and converts its
// items_json into the runtime shape stored in pac_workspace_progress.checklist_state.
// Each runtime item adds {state: 'pending'} and clears the actor + ticked_at fields.
//
// Used in two places:
//   1. /api/pac-workspace/[caseId] GET (auto-create on first open)
//   2. /api/pac-workspace/[caseId]/mode PUT (re-seed on mode change — D5)
// =============================================================================

import { queryOne } from '@/lib/db';
import type { PacChecklistItem, PacChecklistTemplate, PacMode } from './types';
import { PAC_MODE_DEFAULT_TEMPLATE } from './types';

export async function seedChecklistFromTemplate(
  pacMode: PacMode,
  hospitalId: string | null,
): Promise<{ templateCode: string; items: PacChecklistItem[] }> {
  const desired = PAC_MODE_DEFAULT_TEMPLATE[pacMode];

  // Prefer hospital-specific template if it exists; fall back to global.
  let row = hospitalId
    ? await queryOne<PacChecklistTemplate>(
        `SELECT code, pac_mode, items_json
           FROM pac_checklist_templates
          WHERE code = $1 AND active = TRUE AND hospital_id = $2::uuid
          LIMIT 1`,
        [desired, hospitalId],
      )
    : null;

  if (!row) {
    row = await queryOne<PacChecklistTemplate>(
      `SELECT code, pac_mode, items_json
         FROM pac_checklist_templates
        WHERE code = $1 AND active = TRUE AND hospital_id IS NULL
        LIMIT 1`,
      [desired],
    );
  }

  if (!row) {
    return { templateCode: desired, items: [] };
  }

  const items: PacChecklistItem[] = (row.items_json || []).map((src) => ({
    id: src.id,
    label: src.label,
    state: 'pending',
    required: !!src.required,
    gating_condition: src.gating_condition ?? null,
    sop_ref: src.sop_ref ?? null,
    actor_id: null,
    actor_name: null,
    ticked_at: null,
    notes: null,
  }));

  return { templateCode: row.code, items };
}
