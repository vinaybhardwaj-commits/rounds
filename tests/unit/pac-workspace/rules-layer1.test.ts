// =============================================================================
// PAC Workspace v2 — Layer 1 rule unit tests (PCW2.2a)
//
// Per PRD §5.2: every rule has at least one positive-trigger fixture, one
// negative, and one edge case. ~16 rules × 3 = ~48 tests.
//
// Run: npx vitest run tests/unit/pac-workspace/rules-layer1.test.ts
// =============================================================================

import { describe, expect, it } from 'vitest';
import { evaluate } from '@/lib/pac-workspace/engine';
import { LAYER1_RULES } from '@/lib/pac-workspace/rules/layer1-asa';
import {
  makeSnapshot,
  merge,
  withAnaesthesia,
  withComorbidity,
  withFlag,
  withSurgicalCase,
} from './_fixtures';

function fired(facts: ReturnType<typeof makeSnapshot>, ruleId: string): boolean {
  const out = evaluate(facts, LAYER1_RULES);
  return out.some((s) => s.ruleId === ruleId);
}

function suggestion(
  facts: ReturnType<typeof makeSnapshot>,
  ruleId: string
) {
  const out = evaluate(facts, LAYER1_RULES);
  return out.find((s) => s.ruleId === ruleId);
}

const baselineFacts = (anaesthesia: 'GA' | 'SA' | 'LA' | 'Block' | 'Other' = 'GA') =>
  merge(withSurgicalCase(), withAnaesthesia(anaesthesia));

// =============================================================================
// Layer 1 baseline (CBC, RFT, TSH, Glucose, Coag, Serology, ECG)
// All fire identically for ASA 1-3 + any anaesthesia type.
// =============================================================================

describe.each([
  ['sop.6.2.layer1.cbc', 'CBC'],
  ['sop.6.2.layer1.rft', 'RFT'],
  ['sop.6.2.layer1.tsh', 'TSH'],
  ['sop.6.2.layer1.glucose', 'RBS / HbA1c'],
  ['sop.6.2.layer1.coag', 'PT / aPTT / INR'],
  ['sop.6.2.layer1.serology', 'Serology (HBsAg, anti-HCV, HIV)'],
  ['sop.6.2.layer1.ecg', 'ECG'],
])('%s — %s baseline rule', (ruleId, label) => {
  it('positive: ASA 2 + GA → fires', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: baselineFacts('GA') });
    expect(fired(snap, ruleId)).toBe(true);
    const sug = suggestion(snap, ruleId);
    expect(sug?.payload).toMatchObject({ kind: ruleId.includes('ecg') ? 'diagnostic' : 'diagnostic', label });
    expect(sug?.severity).toBe('required');
    expect(sug?.recencyWindowDays).toBe(180);
  });

  it('negative: anaesthesia_type missing → does NOT fire (Layer 1 ineligible)', () => {
    const snap = makeSnapshot({
      asaGrade: 2,
      facts: withSurgicalCase(),
    });
    expect(fired(snap, ruleId)).toBe(false);
  });

  it('edge: ASA 4 → does NOT fire (out of baseline; ICU short-circuit handles workup)', () => {
    const snap = makeSnapshot({ asaGrade: 4, facts: baselineFacts('GA') });
    expect(fired(snap, ruleId)).toBe(false);
  });
});

// =============================================================================
// CXR — anaesthesia-type sensitive at ASA 1
// =============================================================================

describe('sop.6.2.layer1.cxr — Chest X-Ray', () => {
  it('positive: ASA 1 + GA → fires', () => {
    const snap = makeSnapshot({ asaGrade: 1, facts: baselineFacts('GA') });
    expect(fired(snap, 'sop.6.2.layer1.cxr')).toBe(true);
  });

  it('positive: ASA 2 + SA (regional) → fires (CXR mandatory at ASA 2+ regardless of anaesthesia)', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: baselineFacts('SA') });
    expect(fired(snap, 'sop.6.2.layer1.cxr')).toBe(true);
  });

  it('negative: ASA 1 + SA (regional) → does NOT fire (CXR only required at ASA 1 for GA)', () => {
    const snap = makeSnapshot({ asaGrade: 1, facts: baselineFacts('SA') });
    expect(fired(snap, 'sop.6.2.layer1.cxr')).toBe(false);
  });

  it('edge: ASA 1 + Other (unknown anaesthesia category) → does NOT fire (conservative)', () => {
    const snap = makeSnapshot({ asaGrade: 1, facts: baselineFacts('Other') });
    expect(fired(snap, 'sop.6.2.layer1.cxr')).toBe(false);
  });
});

// =============================================================================
// ASA 2 additions: lipid, urine_rm, echo
// Inherited by ASA 3.
// =============================================================================

describe.each([
  ['sop.6.2.asa2.lipid', 'Lipid profile'],
  ['sop.6.2.asa2.urine_rm', 'Urine R/M'],
  ['sop.6.2.asa2.echo', '2D ECHO'],
])('%s — %s', (ruleId, label) => {
  it('positive: ASA 2 + any anaesthesia → fires', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: baselineFacts('Block') });
    expect(fired(snap, ruleId)).toBe(true);
    expect(suggestion(snap, ruleId)?.payload).toMatchObject({ label });
  });

  it('negative: ASA 1 → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 1, facts: baselineFacts('GA') });
    expect(fired(snap, ruleId)).toBe(false);
  });

  it('edge: ASA 3 also fires (inherits ASA 2 baseline)', () => {
    const snap = makeSnapshot({ asaGrade: 3, facts: baselineFacts('LA') });
    expect(fired(snap, ruleId)).toBe(true);
  });
});

// =============================================================================
// Cardiology consult — ASA 2 or 3 + ECG/echo abnormality
// =============================================================================

describe('sop.6.2.layer1.cardiology_consult', () => {
  it('positive: ASA 2 + ECG abnormality → fires', () => {
    const snap = makeSnapshot({
      asaGrade: 2,
      facts: merge(baselineFacts('GA'), withFlag('imaging.ecg.abnormality')),
    });
    expect(fired(snap, 'sop.6.2.layer1.cardiology_consult')).toBe(true);
    expect(suggestion(snap, 'sop.6.2.layer1.cardiology_consult')?.payload).toMatchObject({
      kind: 'clearance',
      specialty: 'cardiology',
    });
  });

  it('negative: ASA 2 with no abnormality → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: baselineFacts('GA') });
    expect(fired(snap, 'sop.6.2.layer1.cardiology_consult')).toBe(false);
  });

  it('edge: ASA 1 + ECG abnormality → does NOT fire (rule scoped to ASA 2-3)', () => {
    const snap = makeSnapshot({
      asaGrade: 1,
      facts: merge(baselineFacts('GA'), withFlag('imaging.ecg.abnormality')),
    });
    expect(fired(snap, 'sop.6.2.layer1.cardiology_consult')).toBe(false);
  });
});

// =============================================================================
// Dobutamine stress — ASA 2 conditional, ASA 3 broader
// =============================================================================

describe('sop.6.2.layer1.dobutamine_stress', () => {
  it('positive: ASA 2 + echo abnormality → fires (RECOMMENDED)', () => {
    const snap = makeSnapshot({
      asaGrade: 2,
      facts: merge(baselineFacts('GA'), withFlag('imaging.echo.abnormality')),
    });
    expect(fired(snap, 'sop.6.2.layer1.dobutamine_stress')).toBe(true);
    expect(suggestion(snap, 'sop.6.2.layer1.dobutamine_stress')?.severity).toBe('recommended');
  });

  it('negative: ASA 2 with no abnormality and no major surgery → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: baselineFacts('GA') });
    expect(fired(snap, 'sop.6.2.layer1.dobutamine_stress')).toBe(false);
  });

  it('edge: ASA 3 + is_major (no abnormality) → fires (additional ASA 3 trigger)', () => {
    const snap = makeSnapshot({
      asaGrade: 3,
      facts: merge(baselineFacts('GA'), withFlag('surgery.is_major')),
    });
    expect(fired(snap, 'sop.6.2.layer1.dobutamine_stress')).toBe(true);
  });
});

// =============================================================================
// ASA 3 ABG
// =============================================================================

describe('sop.6.2.asa3.abg', () => {
  it('positive: ASA 3 + any anaesthesia → fires', () => {
    const snap = makeSnapshot({ asaGrade: 3, facts: baselineFacts('SA') });
    expect(fired(snap, 'sop.6.2.asa3.abg')).toBe(true);
    expect(suggestion(snap, 'sop.6.2.asa3.abg')?.payload).toMatchObject({
      label: 'ABG',
    });
  });

  it('negative: ASA 2 → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: baselineFacts('GA') });
    expect(fired(snap, 'sop.6.2.asa3.abg')).toBe(false);
  });

  it('edge: ASA 3 but no anaesthesia type set → does NOT fire (Layer 1 ineligible)', () => {
    const snap = makeSnapshot({ asaGrade: 3, facts: withSurgicalCase() });
    expect(fired(snap, 'sop.6.2.asa3.abg')).toBe(false);
  });
});

// =============================================================================
// ASA 3 CT thorax — gated on respiratory + (recent_pneumonia OR wheeze_active)
// =============================================================================

describe('sop.6.2.asa3.ct_thorax', () => {
  it('positive: ASA 3 + respiratory + recent pneumonia → fires', () => {
    const snap = makeSnapshot({
      asaGrade: 3,
      facts: merge(
        baselineFacts('GA'),
        withComorbidity('respiratory_disease'),
        withFlag('history.recent_pneumonia')
      ),
    });
    expect(fired(snap, 'sop.6.2.asa3.ct_thorax')).toBe(true);
  });

  it('negative: ASA 3 + respiratory but no pneumonia/wheeze → does NOT fire', () => {
    const snap = makeSnapshot({
      asaGrade: 3,
      facts: merge(baselineFacts('GA'), withComorbidity('respiratory_disease')),
    });
    expect(fired(snap, 'sop.6.2.asa3.ct_thorax')).toBe(false);
  });

  it('edge: ASA 2 + respiratory + recent pneumonia → does NOT fire (ASA-gated to 3)', () => {
    const snap = makeSnapshot({
      asaGrade: 2,
      facts: merge(
        baselineFacts('GA'),
        withComorbidity('respiratory_disease'),
        withFlag('history.recent_pneumonia')
      ),
    });
    expect(fired(snap, 'sop.6.2.asa3.ct_thorax')).toBe(false);
  });

  it('edge2: ASA 3 + respiratory + wheeze_active (no pneumonia) → fires', () => {
    const snap = makeSnapshot({
      asaGrade: 3,
      facts: merge(
        baselineFacts('GA'),
        withComorbidity('respiratory_disease'),
        withFlag('vital.wheeze_active')
      ),
    });
    expect(fired(snap, 'sop.6.2.asa3.ct_thorax')).toBe(true);
  });
});

// =============================================================================
// ASA 4/5 — direct ICU short-circuit
// =============================================================================

describe('sop.6.2.asa4_5.direct_icu', () => {
  it('positive: ASA 4 → fires INFO', () => {
    const snap = makeSnapshot({ asaGrade: 4, facts: baselineFacts('GA') });
    expect(fired(snap, 'sop.6.2.asa4_5.direct_icu')).toBe(true);
    const sug = suggestion(snap, 'sop.6.2.asa4_5.direct_icu');
    expect(sug?.severity).toBe('info');
    expect(sug?.routesTo).toBe('info_only');
    expect(sug?.payload).toMatchObject({ kind: 'info_only' });
  });

  it('positive2: ASA 5 → also fires', () => {
    const snap = makeSnapshot({ asaGrade: 5, facts: baselineFacts('GA') });
    expect(fired(snap, 'sop.6.2.asa4_5.direct_icu')).toBe(true);
  });

  it('negative: ASA 3 → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 3, facts: baselineFacts('GA') });
    expect(fired(snap, 'sop.6.2.asa4_5.direct_icu')).toBe(false);
  });

  it('edge: ASA 4 with NO surgical case → STILL fires (rule is asa-only, no eligibility gate)', () => {
    // The ICU short-circuit fires whenever ASA 4/5 is set, even without
    // anaesthesia type — there's no point hiding the ICU notice waiting on
    // form data to arrive.
    const snap = makeSnapshot({ asaGrade: 4 });
    expect(fired(snap, 'sop.6.2.asa4_5.direct_icu')).toBe(true);
  });
});

// =============================================================================
// PRD §15.1 acceptance — ASA 2 + GA fires the 11 expected diagnostic suggestions
// =============================================================================

describe('PRD §15.1 acceptance', () => {
  it('ASA 2 + GA + diabetes (controlled) → 11 REQUIRED diagnostic suggestions from Layer 1', () => {
    const snap = makeSnapshot({
      asaGrade: 2,
      facts: merge(
        baselineFacts('GA'),
        withComorbidity('diabetes')
        // Layer 2 rules add comorbidity-driven suggestions; we count only
        // Layer 1 here.
      ),
    });
    const out = evaluate(snap, LAYER1_RULES);
    const layer1Required = out.filter(
      (s) => s.layer === 1 && s.severity === 'required' && s.routesTo === 'diagnostic'
    );
    // 7 baseline (CBC, RFT, TSH, Glucose, Coag, Serology, ECG) +
    // 1 CXR (ASA 2 always) + 3 ASA-2 additions (Lipid, Urine, Echo) = 11
    expect(layer1Required.map((s) => s.payload)).toHaveLength(11);
  });
});

// =============================================================================
// Eligibility gate — no rules fire when asaGrade is null OR anaesthesia missing
// =============================================================================

describe('Layer 1 eligibility gate', () => {
  it('null asaGrade → only ASA 4/5 rule could fire (and it doesn\'t with null)', () => {
    const snap = makeSnapshot({ facts: baselineFacts('GA') });
    const out = evaluate(snap, LAYER1_RULES);
    expect(out).toEqual([]);
  });

  it('asaGrade=2 but no anaesthesia_type → no Layer 1 baseline rules fire', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: withSurgicalCase() });
    const out = evaluate(snap, LAYER1_RULES);
    expect(out).toEqual([]);
  });
});
