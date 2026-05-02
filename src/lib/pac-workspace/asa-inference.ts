// =============================================================================
// PAC Workspace v2 — ASA inference (PCW2.2a)
//
// Pure function implementing PRD §7.2. Engine-only; UI override modal +
// PATCH endpoint ship in PCW2.9.
//
// ASA 4/5 are NEVER inferred — they require a clinical sign (recent MI,
// EF<25%, ongoing sepsis/shock) and are anaesthetist-set per §7.1.
// =============================================================================

import type { AsaInference, FactSnapshot } from './engine-types';
import {
  anyKeyStartsWith,
  getFactString,
  isTrue,
} from './fact-helpers';

/**
 * Infer provisional ASA from a fact snapshot.
 *
 * Algorithm (PRD §7.2):
 *   - No surgical case → null (gate: needs `surgery.is_surgical_case=true`).
 *   - No comorbidity AND no habit → ASA 1, high.
 *   - Comorbidity present, control=yes, (no habits OR habits stopped) → ASA 2, high.
 *   - Comorbidity present, (uncontrolled OR habit not stopped) → ASA 3, high.
 *   - Default (comorbidity present, unclear control; or habit-only) → ASA 2, low.
 *
 * Returns null when the snapshot is too sparse to infer (no surgical case
 * marker yet — Marketing Handoff hasn't been filed).
 */
export function inferAsa(snap: FactSnapshot): AsaInference | null {
  // Gate: no inference until we know this is a surgical case.
  if (!isTrue(snap, 'surgery.is_surgical_case')) return null;

  const hasComorbidity = anyKeyStartsWith(snap, 'comorbidity.');
  const hasHabit = anyKeyStartsWith(snap, 'habit.');
  const control = getFactString(snap, 'comorbidity_control._global');
  const habitStopped = getFactString(snap, 'habit_stopped._global');

  // Branch 1 — clean intake: ASA 1, high confidence.
  if (!hasComorbidity && !hasHabit) {
    return { grade: 1, confidence: 'high' };
  }

  // Branch 2 — comorbidity present + controlled + habits clean: ASA 2, high.
  if (hasComorbidity && control === 'yes' && (!hasHabit || habitStopped === 'yes')) {
    return { grade: 2, confidence: 'high' };
  }

  // Branch 3 — comorbidity present + uncontrolled or habit not stopped: ASA 3, high.
  if (
    hasComorbidity &&
    (control === 'no' || control === 'unknown' || habitStopped === 'no')
  ) {
    return { grade: 3, confidence: 'high' };
  }

  // Branch 4 — default cautious: comorbidity present but control unclear,
  // or habit-only patient. ASA 2, low.
  return { grade: 2, confidence: 'low' };
}
