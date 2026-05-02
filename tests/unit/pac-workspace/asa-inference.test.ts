// =============================================================================
// PAC Workspace v2 — ASA inference tests (PCW2.2a)
//
// PRD §7.2 has 4 explicit branches + 1 gate (no surgical case → null).
// Run: npx vitest run tests/unit/pac-workspace/asa-inference.test.ts
// =============================================================================

import { describe, expect, it } from 'vitest';
import { inferAsa } from '@/lib/pac-workspace/asa-inference';
import {
  makeSnapshot,
  merge,
  withComorbidity,
  withControl,
  withHabit,
  withHabitsStopped,
  withSurgicalCase,
} from './_fixtures';

describe('inferAsa() — gate', () => {
  it('returns null when no surgical case is on the snapshot', () => {
    expect(inferAsa(makeSnapshot())).toBeNull();
  });

  it('returns null when surgery.is_surgical_case is explicitly false', () => {
    const snap = makeSnapshot({
      facts: { 'surgery.is_surgical_case': { value: false } },
    });
    expect(inferAsa(snap)).toBeNull();
  });
});

describe('inferAsa() — branch 1: clean intake → ASA 1 high', () => {
  it('no comorbidity, no habit → ASA 1 high', () => {
    const snap = makeSnapshot({ facts: withSurgicalCase() });
    expect(inferAsa(snap)).toEqual({ grade: 1, confidence: 'high' });
  });

  it('no comorbidity, no habit, control_global=yes (irrelevant) → still ASA 1 high', () => {
    const snap = makeSnapshot({
      facts: merge(withSurgicalCase(), withControl('yes')),
    });
    expect(inferAsa(snap)).toEqual({ grade: 1, confidence: 'high' });
  });
});

describe('inferAsa() — branch 2: comorbidity controlled, habits clean → ASA 2 high', () => {
  it('1 comorbidity + control=yes + no habits → ASA 2 high', () => {
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withComorbidity('diabetes'),
        withControl('yes')
      ),
    });
    expect(inferAsa(snap)).toEqual({ grade: 2, confidence: 'high' });
  });

  it('comorbidity + control=yes + habits stopped=yes → ASA 2 high', () => {
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withComorbidity('hypertension'),
        withControl('yes'),
        withHabit('smoking'),
        withHabitsStopped('yes')
      ),
    });
    expect(inferAsa(snap)).toEqual({ grade: 2, confidence: 'high' });
  });

  it('multiple comorbidities all controlled → ASA 2 high', () => {
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withComorbidity('diabetes'),
        withComorbidity('hypertension'),
        withControl('yes')
      ),
    });
    expect(inferAsa(snap)).toEqual({ grade: 2, confidence: 'high' });
  });
});

describe('inferAsa() — branch 3: comorbidity uncontrolled or habit not stopped → ASA 3 high', () => {
  it('comorbidity + control=no → ASA 3 high', () => {
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withComorbidity('diabetes'),
        withControl('no')
      ),
    });
    expect(inferAsa(snap)).toEqual({ grade: 3, confidence: 'high' });
  });

  it('comorbidity + control=unknown → ASA 3 high', () => {
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withComorbidity('cardiac_disease'),
        withControl('unknown')
      ),
    });
    expect(inferAsa(snap)).toEqual({ grade: 3, confidence: 'high' });
  });

  it('comorbidity + control=yes + habit not stopped → ASA 3 high', () => {
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withComorbidity('hypertension'),
        withControl('yes'),
        withHabit('alcohol'),
        withHabitsStopped('no')
      ),
    });
    expect(inferAsa(snap)).toEqual({ grade: 3, confidence: 'high' });
  });
});

describe('inferAsa() — branch 4: default cautious → ASA 2 low', () => {
  it('comorbidity present, control unset → ASA 2 low (cautious)', () => {
    const snap = makeSnapshot({
      facts: merge(withSurgicalCase(), withComorbidity('diabetes')),
    });
    expect(inferAsa(snap)).toEqual({ grade: 2, confidence: 'low' });
  });

  it('habit-only patient (no comorbidity) → ASA 2 low', () => {
    const snap = makeSnapshot({
      facts: merge(withSurgicalCase(), withHabit('smoking')),
    });
    expect(inferAsa(snap)).toEqual({ grade: 2, confidence: 'low' });
  });

  it('habit-only patient with habit_stopped=yes → still ASA 2 low', () => {
    // PRD §7.2 gates ASA 2 high on `has_any_comorbidity` — habit-only patients
    // who quit don't qualify even though SOP §6.3 implies cessation ≥3d → ASA 2.
    // The smoking-stopped-3d rule (sop.6.3.smoking.stopped_3d_asa2) surfaces
    // an asa_review suggestion to prompt coordinator override to ASA 2 high.
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withHabit('smoking'),
        withHabitsStopped('yes')
      ),
    });
    expect(inferAsa(snap)).toEqual({ grade: 2, confidence: 'low' });
  });
});

describe('inferAsa() — never returns ASA 4 or 5', () => {
  it('high-risk facts never escalate inference past ASA 3', () => {
    // ASA 4/5 require clinical sign per §7.1; even with severe comorbidity
    // controlled poorly, inference caps at ASA 3.
    const snap = makeSnapshot({
      facts: merge(
        withSurgicalCase(),
        withComorbidity('cardiac_disease'),
        withComorbidity('renal_disease'),
        withComorbidity('respiratory_disease'),
        withControl('no')
      ),
    });
    const result = inferAsa(snap);
    expect(result?.grade).toBe(3);
  });
});
