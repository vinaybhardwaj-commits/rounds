// =============================================================================
// PAC Workspace v2 — Rule registry (PCW2.2a)
//
// Single source of truth for the engine's ruleSet. PCW2.2b/c append additional
// arrays as Layer 2 / 3 / NPO / Transfer / Pre-op rules ship.
//
// Engine consumers import ALL_RULES and pass it to evaluate(facts, rules).
// =============================================================================

import type { PacRule } from '../engine-types';
import { LAYER1_RULES } from './layer1-asa';
import { LAYER2_RULES } from './layer2-comorbidities';

export const ALL_RULES: readonly PacRule[] = [
  ...LAYER1_RULES,
  ...LAYER2_RULES,
  // PCW2.2c appends LAYER3_RULES, NPO_RULES, TRANSFER_RULES, PREOP_CHECKLIST_RULES.
];

export { LAYER1_RULES, LAYER2_RULES };
