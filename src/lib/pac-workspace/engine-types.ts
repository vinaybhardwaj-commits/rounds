// =============================================================================
// PAC Workspace v2 — Rule engine type contracts (PCW2.2a)
//
// All shapes here are pure TypeScript — no DB, no IO. Per PRD §5.2:
// rules are stored as code (not in DB) for v1; engine output is consumed by
// the persistence layer (PCW2.3) and the inbox UI (PCW2.4).
// =============================================================================

export type FactValue = Record<string, unknown>;

/**
 * Live snapshot of facts for one case at evaluation time.
 *
 * - `facts` is keyed by `fact_key` (e.g., 'comorbidity.diabetes',
 *   'lab.hba1c.value', 'surgery.anaesthesia_type'). Values are JSONB shapes
 *   from `pac_facts.fact_value`. Per PCW2.1: free-text uses {value: "..."},
 *   numeric uses {value: <num>, unit?: "..."}, multiselect items use
 *   {present: true}, booleans use {value: <bool>}.
 *
 * - `asaGrade` and `asaSource` come from `pac_workspace_progress` (set by
 *   ASA inference, coordinator override, or anaesthetist publish per §7.1).
 *   Lifted out of `facts` because they have a special lifecycle that doesn't
 *   match the supersede-first fact pattern.
 *
 * Engine consumers must treat missing facts as UNKNOWN, not false. The
 * helpers in `fact-helpers.ts` enforce conservative-on-missing behavior.
 */
export interface FactSnapshot {
  facts: Record<string, FactValue>;
  asaGrade: 1 | 2 | 3 | 4 | 5 | null;
  asaSource: 'inferred' | 'coordinator' | 'anaesthetist' | null;
}

export type PacRuleSeverity = 'required' | 'recommended' | 'info';

export type PacRuleRoutesTo =
  | 'diagnostic'
  | 'clearance'
  | 'order'
  | 'pac_visit'
  | 'asa_review'
  | 'info_only';

/**
 * The proposed body of a suggestion. Shape varies by destination section
 * so the inbox UI can render with the correct affordance.
 */
export type SuggestionPayload =
  | { kind: 'diagnostic'; orderType: string; label: string }
  | { kind: 'order'; orderType?: string; label: string }
  | { kind: 'clearance'; specialty: string; label: string }
  | { kind: 'pac_visit'; label: string }
  | { kind: 'asa_review'; suggestedGrade: 1 | 2 | 3 | 4 | 5; reasonText: string }
  | { kind: 'info_only'; message: string };

/**
 * One SOP-derived rule. Every rule listed in PRD §6 maps to one of these.
 *
 * `version` is bumped when rule logic changes — engine writes a new pending
 * pac_suggestions row and supersedes the old one (PCW2.3 reconciliation).
 */
export interface PacRule {
  id: string;
  version: number;
  layer: 1 | 2 | 3;
  severity: PacRuleSeverity;
  routesTo: PacRuleRoutesTo;
  sopReference: string;
  /** Days since `done_at` after which an "already done" suggestion resurrects (§5.5). */
  recencyWindowDays?: number;

  trigger: (facts: FactSnapshot) => boolean;
  payload: (facts: FactSnapshot) => SuggestionPayload;
  reason: (facts: FactSnapshot) => string;
}

/**
 * Engine output — one row per fired rule. PCW2.3 reconciles against
 * pac_suggestions (insert new, supersede on version change, auto-dismiss
 * on rule-no-longer-fires).
 */
export interface SuggestionEvaluation {
  ruleId: string;
  ruleVersion: number;
  layer: 1 | 2 | 3;
  severity: PacRuleSeverity;
  routesTo: PacRuleRoutesTo;
  recencyWindowDays?: number;
  sopReference: string;
  payload: SuggestionPayload;
  reason: string;
}

/**
 * Inferred ASA from §7.2. Engine never returns ASA 4/5 — those require a
 * clinical sign and are anaesthetist-set only. Returns null when the
 * snapshot is too sparse for any inference (no surgical case detected).
 */
export interface AsaInference {
  grade: 1 | 2 | 3;
  confidence: 'high' | 'low';
}

/** Helper for rule files — preserves PacRule typing through const arrays. */
export function defineRule(rule: PacRule): PacRule {
  return rule;
}
