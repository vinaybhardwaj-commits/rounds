// =============================================================================
// PAC Workspace v2 — Rule engine (PCW2.2a)
//
// Pure pipeline: walks the rule set, fires triggers, gathers payload + reason
// per fired rule. PCW2.3 wraps this with persistence (pac_suggestions
// reconciliation, supersede, auto-dismiss).
//
// Predicate failures are non-fatal: a buggy trigger is logged and skipped.
// Engine never throws on a single bad rule; better partial output than total
// failure, since the engine runs on every form submit and ASA change.
// =============================================================================

import type {
  FactSnapshot,
  PacRule,
  SuggestionEvaluation,
} from './engine-types';

export function evaluate(
  facts: FactSnapshot,
  ruleSet: readonly PacRule[]
): SuggestionEvaluation[] {
  const out: SuggestionEvaluation[] = [];

  for (const rule of ruleSet) {
    let triggered = false;
    try {
      triggered = rule.trigger(facts);
    } catch (err) {
      console.error(
        `[pcw2.2 engine] rule ${rule.id} trigger threw — skipping:`,
        (err as Error).message
      );
      continue;
    }
    if (!triggered) continue;

    let payload;
    let reason: string;
    try {
      payload = rule.payload(facts);
      reason = rule.reason(facts);
    } catch (err) {
      console.error(
        `[pcw2.2 engine] rule ${rule.id} payload/reason threw — skipping:`,
        (err as Error).message
      );
      continue;
    }

    out.push({
      ruleId: rule.id,
      ruleVersion: rule.version,
      layer: rule.layer,
      severity: rule.severity,
      routesTo: rule.routesTo,
      recencyWindowDays: rule.recencyWindowDays,
      sopReference: rule.sopReference,
      payload,
      reason,
    });
  }

  return out;
}
