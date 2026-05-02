// =============================================================================
// PAC Workspace v2 — Fact accessor helpers (PCW2.2a)
//
// Conservative-on-missing semantics: every accessor returns `undefined` /
// `false` when the fact_key is absent or the value can't be coerced to the
// expected shape. Rule predicates compose these with `&&` / `||`; missing
// facts naturally produce `false` for positive comparisons, so the rule
// just doesn't fire (per PCW2.2 Q3 lock).
// =============================================================================

import type { FactSnapshot, FactValue } from './engine-types';

/** Raw fact value (JSONB shape) for the given key, or undefined if missing. */
export function getFact(snap: FactSnapshot, key: string): FactValue | undefined {
  const v = snap.facts[key];
  return v && typeof v === 'object' ? v : undefined;
}

export function hasFact(snap: FactSnapshot, key: string): boolean {
  return getFact(snap, key) !== undefined;
}

/** True when ANY fact_key in the snapshot starts with `prefix`. */
export function anyKeyStartsWith(snap: FactSnapshot, prefix: string): boolean {
  for (const k in snap.facts) {
    if (k.startsWith(prefix)) return true;
  }
  return false;
}

export function getFactString(snap: FactSnapshot, key: string): string | undefined {
  const v = getFact(snap, key);
  if (!v) return undefined;
  if (typeof v.value === 'string') return v.value;
  return undefined;
}

export function getFactNumber(snap: FactSnapshot, key: string): number | undefined {
  const v = getFact(snap, key);
  if (!v) return undefined;
  if (typeof v.value === 'number' && Number.isFinite(v.value)) return v.value;
  return undefined;
}

export function getFactBool(snap: FactSnapshot, key: string): boolean | undefined {
  const v = getFact(snap, key);
  if (!v) return undefined;
  if (typeof v.value === 'boolean') return v.value;
  return undefined;
}

/**
 * "Is this fact present and truthy?"
 *
 * Returns true when EITHER:
 *   - `fact_value.present === true` (multiselect items per PCW2.1 convention)
 *   - `fact_value.value === true` (boolean facts)
 *
 * Returns false otherwise (including missing). Conservative.
 */
export function isTrue(snap: FactSnapshot, key: string): boolean {
  const v = getFact(snap, key);
  if (!v) return false;
  return v.present === true || v.value === true;
}

/** Inverse of isTrue() — returns true ONLY when the fact is present and is explicitly false. */
export function isFalse(snap: FactSnapshot, key: string): boolean {
  const v = getFact(snap, key);
  if (!v) return false;
  return v.value === false;
}

export function valueGt(snap: FactSnapshot, key: string, threshold: number): boolean {
  const n = getFactNumber(snap, key);
  return n !== undefined && n > threshold;
}

export function valueGte(snap: FactSnapshot, key: string, threshold: number): boolean {
  const n = getFactNumber(snap, key);
  return n !== undefined && n >= threshold;
}

export function valueLt(snap: FactSnapshot, key: string, threshold: number): boolean {
  const n = getFactNumber(snap, key);
  return n !== undefined && n < threshold;
}

export function valueLte(snap: FactSnapshot, key: string, threshold: number): boolean {
  const n = getFactNumber(snap, key);
  return n !== undefined && n <= threshold;
}

export function valueEq(snap: FactSnapshot, key: string, target: string): boolean {
  return getFactString(snap, key) === target;
}

export function inSet(snap: FactSnapshot, key: string, values: readonly string[]): boolean {
  const s = getFactString(snap, key);
  return s !== undefined && values.includes(s);
}

export function notInSet(snap: FactSnapshot, key: string, values: readonly string[]): boolean {
  const s = getFactString(snap, key);
  // Conservative: if missing, NOT-in-set is FALSE (we can't assert anything).
  return s !== undefined && !values.includes(s);
}

export function regexMatch(snap: FactSnapshot, key: string, pattern: RegExp): boolean {
  const s = getFactString(snap, key);
  if (s === undefined) return false;
  return pattern.test(s);
}

/**
 * Anaesthesia category mapping per form-registry values:
 *   GA → 'general'
 *   SA / LA / Block → 'regional'
 *   Other / unknown / missing → null (don't fire general-only rules)
 */
export function getAnaesthesiaCategory(
  snap: FactSnapshot
): 'general' | 'regional' | null {
  const t = getFactString(snap, 'surgery.anaesthesia_type');
  if (!t) return null;
  if (t === 'GA') return 'general';
  if (t === 'SA' || t === 'LA' || t === 'Block') return 'regional';
  return null; // 'Other' / unknown
}

/**
 * Layer 1 eligibility gate per PRD §6.1: rules require BOTH `asa_grade` AND
 * `surgery.anaesthesia_type` to be known. If either is missing, no Layer 1
 * suggestion fires (intake-only patients see Layer 2 + ASA inference card).
 */
export function layer1Eligible(snap: FactSnapshot): boolean {
  return snap.asaGrade !== null && hasFact(snap, 'surgery.anaesthesia_type');
}
