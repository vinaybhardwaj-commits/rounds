// =============================================================================
// PAC Workspace v2 — Shared test fixture builder (PCW2.2a)
// =============================================================================

import type { FactSnapshot, FactValue } from '@/lib/pac-workspace/engine-types';

export interface SnapshotInput {
  asaGrade?: 1 | 2 | 3 | 4 | 5 | null;
  asaSource?: 'inferred' | 'coordinator' | 'anaesthetist' | null;
  /** Fact key → JSONB value. Convenience builders below for common shapes. */
  facts?: Record<string, FactValue>;
}

export function makeSnapshot(input: SnapshotInput = {}): FactSnapshot {
  return {
    asaGrade: input.asaGrade ?? null,
    asaSource: input.asaSource ?? null,
    facts: { ...(input.facts ?? {}) },
  };
}

/** Multiselect-item shape per PCW2.1 convention. */
export const PRESENT: FactValue = { present: true };

/** Free-text / categorical fact value — {value: <text|num|bool>}. */
export function v(val: unknown): FactValue {
  return { value: val };
}

/** Common building blocks composed by every Layer 1 test. */
export function withSurgicalCase(): Record<string, FactValue> {
  return { 'surgery.is_surgical_case': v(true) };
}

export function withAnaesthesia(
  type: 'GA' | 'SA' | 'LA' | 'Block' | 'Other'
): Record<string, FactValue> {
  return { 'surgery.anaesthesia_type': v(type) };
}

export function withComorbidity(name: string): Record<string, FactValue> {
  return { [`comorbidity.${name}`]: PRESENT };
}

export function withHabit(name: string): Record<string, FactValue> {
  return { [`habit.${name}`]: PRESENT };
}

export function withControl(
  status: 'yes' | 'no' | 'unknown'
): Record<string, FactValue> {
  return { 'comorbidity_control._global': v(status) };
}

export function withHabitsStopped(
  status: 'yes' | 'no'
): Record<string, FactValue> {
  return { 'habit_stopped._global': v(status) };
}

/** Numeric vital / lab fact. */
export function withVital(
  key: string,
  value: number,
  unit?: string
): Record<string, FactValue> {
  return { [key]: unit ? { value, unit } : { value } };
}

export function withFlag(key: string): Record<string, FactValue> {
  return { [key]: { value: true } };
}

/** Spread-merge multiple fact builders. */
export function merge(
  ...parts: Record<string, FactValue>[]
): Record<string, FactValue> {
  return Object.assign({}, ...parts);
}

/** medication.notes free-text — matches what the form-registry's textarea emits. */
export function withMedication(text: string): Record<string, FactValue> {
  return { 'medication.notes': v(text) };
}

/** Set a `{value: false}` fact (e.g., habit_stopped.anticoagulant=false). */
export function withFalse(key: string): Record<string, FactValue> {
  return { [key]: { value: false } };
}

/** surgery.urgency — 'elective' | 'urgent' | 'emergency'. */
export function withUrgency(
  urg: 'elective' | 'urgent' | 'emergency'
): Record<string, FactValue> {
  return { 'surgery.urgency': v(urg) };
}
