// =============================================================================
// PAC Coordinator Workspace v1 — SOP-driven auto-suggest engine
// PRD §10 + SOP EHRC/SOP/OT/001 v5.0 §6.2 + §6.3
//
// Two pure functions, no DB calls. Caller passes in lookup tables + per-case
// inputs and gets back ranked suggestions. Keeps the engine testable and
// deterministic — no LLM, no scoring magic, just SOP rules encoded in lookup
// arrays (sop_default_for_asa[], sop_trigger_comorbidities[]).
//
// Why not call the DB inline? Two reasons:
//   1. Suggest endpoint already loads the lookup tables once; passing them
//      as args avoids N+1 queries during a batch suggest.
//   2. Easier to unit-test as a pure function.
// =============================================================================

import type { PacMode } from './types';

export interface PacOrderTypeRow {
  code: string;
  label: string;
  category: string | null;
  sop_default_for_asa: number[] | null;
  sop_default_for_mode: string[] | null;
  active: boolean;
  hospital_id: string | null;
}

export interface PacClearanceSpecialtyRow {
  code: string;
  label: string;
  default_assignee_role: string;
  sop_trigger_comorbidities: string[] | null;
  active: boolean;
  hospital_id: string | null;
}

export interface SuggestInputs {
  asa: number | null;          // 1-5; null = unknown (defaults to 2)
  comorbidities: string[];     // snake_case flag taxonomy (matches sop_trigger_comorbidities)
  mode: PacMode;
}

export interface OrderSuggestion {
  code: string;
  label: string;
  category: string | null;
  reason: 'asa_default' | 'mode_default' | 'manual_only';
}

export interface ClearanceSuggestion {
  code: string;
  label: string;
  default_assignee_role: string;
  reason: 'comorbidity_match' | 'manual_only';
  matched_flags: string[];
}

// =============================================================================
// Order suggestions
// =============================================================================
//
// An order is suggested if:
//   - sop_default_for_asa includes the patient's ASA class, OR
//   - sop_default_for_mode includes a mode tag that the workspace's PAC mode
//     maps to. v1 only honours the 'general_anaesthesia' mode tag (Chest XR
//     for GA per SOP §6.2 footnote). Other tags surface as manual-add-only.
// =============================================================================

const PAC_MODE_TO_ANAESTHESIA_TAGS: Record<PacMode, string[]> = {
  // Anaesthesia type isn't a 1:1 mapping from PAC mode, but in-person OPD +
  // bedside cases default to GA-or-regional consideration. We tag both as
  // 'general_anaesthesia' for the suggest engine; user can deselect Chest XR
  // if regional-only is planned.
  in_person_opd: ['general_anaesthesia'],
  bedside: ['general_anaesthesia'],
  // Telephonic / paper screening don't trigger GA-specific orders.
  telephonic: [],
  paper_screening: [],
};

export function suggestOrders(
  inputs: SuggestInputs,
  catalog: PacOrderTypeRow[],
): OrderSuggestion[] {
  const asa = inputs.asa ?? 2;
  const modeTags = new Set(PAC_MODE_TO_ANAESTHESIA_TAGS[inputs.mode] ?? []);

  const suggestions: OrderSuggestion[] = [];

  for (const row of catalog) {
    if (!row.active) continue;

    const asaMatch = (row.sop_default_for_asa ?? []).includes(asa);
    const modeMatch = (row.sop_default_for_mode ?? []).some((tag) => modeTags.has(tag));

    if (asaMatch || modeMatch) {
      suggestions.push({
        code: row.code,
        label: row.label,
        category: row.category,
        reason: asaMatch ? 'asa_default' : 'mode_default',
      });
    }
  }

  // Stable order: ASA hits first, then mode hits, then alpha by category+label.
  suggestions.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'asa_default' ? -1 : 1;
    const ca = (a.category ?? 'zz').localeCompare(b.category ?? 'zz');
    if (ca !== 0) return ca;
    return a.label.localeCompare(b.label);
  });

  return suggestions;
}

// =============================================================================
// Clearance suggestions
// =============================================================================
//
// A clearance specialty is suggested if any of the patient's comorbidity flags
// is in the specialty's sop_trigger_comorbidities array. The engine returns the
// matched flags so the UI can show "suggested because: hba1c_high, diabetes_uncontrolled".
// =============================================================================

export function suggestClearances(
  inputs: SuggestInputs,
  catalog: PacClearanceSpecialtyRow[],
): ClearanceSuggestion[] {
  const flags = new Set(inputs.comorbidities.map((c) => c.toLowerCase()));
  const suggestions: ClearanceSuggestion[] = [];

  for (const row of catalog) {
    if (!row.active) continue;

    const triggers = row.sop_trigger_comorbidities ?? [];
    const matched = triggers.filter((t) => flags.has(t.toLowerCase()));
    if (matched.length === 0) continue;

    suggestions.push({
      code: row.code,
      label: row.label,
      default_assignee_role: row.default_assignee_role,
      reason: 'comorbidity_match',
      matched_flags: matched,
    });
  }

  // Stable order: most-matched-flags first (signals strongest trigger), then alpha.
  suggestions.sort((a, b) => {
    if (a.matched_flags.length !== b.matched_flags.length) {
      return b.matched_flags.length - a.matched_flags.length;
    }
    return a.label.localeCompare(b.label);
  });

  return suggestions;
}
