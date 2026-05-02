// =============================================================================
// PAC Workspace v2 — Layer 2 comorbidity rule tests (PCW2.2b)
//
// Per PRD §5.2: positive + negative + edge per rule. 59 rules × 3 = 177 tests.
//
// Run: npx vitest run tests/unit/pac-workspace/rules-layer2.test.ts
// =============================================================================

import { describe, expect, it } from 'vitest';
import { evaluate } from '@/lib/pac-workspace/engine';
import { LAYER2_RULES } from '@/lib/pac-workspace/rules/layer2-comorbidities';
import {
  makeSnapshot,
  merge,
  withComorbidity,
  withControl,
  withFalse,
  withFlag,
  withHabit,
  withHabitsStopped,
  withMedication,
  withSurgicalCase,
  withUrgency,
  withVital,
} from './_fixtures';

function fired(facts: ReturnType<typeof makeSnapshot>, ruleId: string): boolean {
  return evaluate(facts, LAYER2_RULES).some((s) => s.ruleId === ruleId);
}

// =============================================================================
// Diabetes (4 rules)
// =============================================================================

describe('sop.6.3.diabetes.hba1c', () => {
  it('positive: diabetes=true → fires REQ diag', () => {
    const snap = makeSnapshot({ facts: withComorbidity('diabetes') });
    expect(fired(snap, 'sop.6.3.diabetes.hba1c')).toBe(true);
  });
  it('negative: no diabetes → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.diabetes.hba1c')).toBe(false);
  });
  it('edge: only hypertension (no diabetes) → does NOT fire', () => {
    const snap = makeSnapshot({ facts: withComorbidity('hypertension') });
    expect(fired(snap, 'sop.6.3.diabetes.hba1c')).toBe(false);
  });
});

describe('sop.6.3.diabetes.endocrine_clearance', () => {
  it('positive: diabetes + hba1c > 8 → fires', () => {
    const snap = makeSnapshot({
      facts: merge(withComorbidity('diabetes'), withVital('lab.hba1c.value', 9.5, '%')),
    });
    expect(fired(snap, 'sop.6.3.diabetes.endocrine_clearance')).toBe(true);
  });
  it('positive2: diabetes + control=unknown → fires', () => {
    const snap = makeSnapshot({
      facts: merge(withComorbidity('diabetes'), withControl('unknown')),
    });
    expect(fired(snap, 'sop.6.3.diabetes.endocrine_clearance')).toBe(true);
  });
  it('negative: diabetes + control=yes + hba1c=7 → does NOT fire', () => {
    const snap = makeSnapshot({
      facts: merge(
        withComorbidity('diabetes'),
        withControl('yes'),
        withVital('lab.hba1c.value', 7, '%')
      ),
    });
    expect(fired(snap, 'sop.6.3.diabetes.endocrine_clearance')).toBe(false);
  });
  it('edge: diabetes + control unset + hba1c unset → does NOT fire (conservative)', () => {
    const snap = makeSnapshot({ facts: withComorbidity('diabetes') });
    expect(fired(snap, 'sop.6.3.diabetes.endocrine_clearance')).toBe(false);
  });
});

describe('sop.6.3.diabetes.day_of_rbs_cutoff', () => {
  it('positive: diabetes=true → INFO fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('diabetes') }), 'sop.6.3.diabetes.day_of_rbs_cutoff')).toBe(true);
  });
  it('negative: no diabetes → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.diabetes.day_of_rbs_cutoff')).toBe(false);
  });
  it('edge: hypertension only → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('hypertension') }), 'sop.6.3.diabetes.day_of_rbs_cutoff')).toBe(false);
  });
});

describe('sop.6.3.diabetes.continue_metformin_hold', () => {
  it('positive: medication.notes contains metformin → fires', () => {
    const snap = makeSnapshot({ facts: withMedication('Metformin 500mg BD, telmisartan 40mg OD') });
    expect(fired(snap, 'sop.6.3.diabetes.continue_metformin_hold')).toBe(true);
  });
  it('negative: medication.notes empty → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.diabetes.continue_metformin_hold')).toBe(false);
  });
  it('edge: medication mentions other diabetic drug (insulin) → does NOT fire (rule is metformin-specific)', () => {
    const snap = makeSnapshot({ facts: withMedication('Insulin glargine 20U HS') });
    expect(fired(snap, 'sop.6.3.diabetes.continue_metformin_hold')).toBe(false);
  });
});

// =============================================================================
// Hypertension (6 rules)
// =============================================================================

describe('sop.6.3.htn.physician_review', () => {
  it('positive: htn=true → REQ clearance fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('hypertension') }), 'sop.6.3.htn.physician_review')).toBe(true);
  });
  it('negative: no htn → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.htn.physician_review')).toBe(false);
  });
  it('edge: diabetes only → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('diabetes') }), 'sop.6.3.htn.physician_review')).toBe(false);
  });
});

describe('sop.6.3.htn.ecg_recency', () => {
  it('positive: htn=true → REQ diag ECG fires with recency', () => {
    const snap = makeSnapshot({ facts: withComorbidity('hypertension') });
    expect(fired(snap, 'sop.6.3.htn.ecg_recency')).toBe(true);
    const out = evaluate(snap, LAYER2_RULES).find(s => s.ruleId === 'sop.6.3.htn.ecg_recency');
    expect(out?.recencyWindowDays).toBe(180);
  });
  it('negative: no htn → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.htn.ecg_recency')).toBe(false);
  });
  it('edge: cardiac (separate rule but no htn) → does NOT fire htn-ecg specifically', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('cardiac_disease') }), 'sop.6.3.htn.ecg_recency')).toBe(false);
  });
});

describe('sop.6.3.htn.echo_recency', () => {
  it('positive: htn=true → fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('hypertension') }), 'sop.6.3.htn.echo_recency')).toBe(true);
  });
  it('negative: no htn → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.htn.echo_recency')).toBe(false);
  });
  it('edge: htn + asa=4 → still fires (Layer 2 not gated by asa eligibility)', () => {
    const snap = makeSnapshot({ asaGrade: 4, facts: withComorbidity('hypertension') });
    expect(fired(snap, 'sop.6.3.htn.echo_recency')).toBe(true);
  });
});

describe('sop.6.3.htn.continue_meds_morning', () => {
  it('positive: htn=true → INFO order fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('hypertension') }), 'sop.6.3.htn.continue_meds_morning')).toBe(true);
  });
  it('negative: no htn → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.htn.continue_meds_morning')).toBe(false);
  });
  it('edge: htn + diabetes → still fires (independent of other comorbidities)', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('hypertension'), withComorbidity('diabetes')) });
    expect(fired(snap, 'sop.6.3.htn.continue_meds_morning')).toBe(true);
  });
});

describe('sop.6.3.htn.bp_cutoff_asa2', () => {
  it('positive: ASA 2 + htn → fires', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: withComorbidity('hypertension') });
    expect(fired(snap, 'sop.6.3.htn.bp_cutoff_asa2')).toBe(true);
  });
  it('negative: htn but ASA 1 → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 1, facts: withComorbidity('hypertension') });
    expect(fired(snap, 'sop.6.3.htn.bp_cutoff_asa2')).toBe(false);
  });
  it('edge: ASA 2 but no htn → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 2 });
    expect(fired(snap, 'sop.6.3.htn.bp_cutoff_asa2')).toBe(false);
  });
});

describe('sop.6.3.htn.bp_cutoff_asa3_defer', () => {
  it('positive: ASA 3 + bp_systolic > 150 → REQ fires', () => {
    const snap = makeSnapshot({ asaGrade: 3, facts: withVital('vital.bp_systolic.value', 165, 'mmHg') });
    expect(fired(snap, 'sop.6.3.htn.bp_cutoff_asa3_defer')).toBe(true);
  });
  it('negative: ASA 3 + bp_systolic = 130 → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 3, facts: withVital('vital.bp_systolic.value', 130, 'mmHg') });
    expect(fired(snap, 'sop.6.3.htn.bp_cutoff_asa3_defer')).toBe(false);
  });
  it('edge: ASA 2 + bp_systolic = 165 → does NOT fire (rule is ASA 3-only)', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: withVital('vital.bp_systolic.value', 165, 'mmHg') });
    expect(fired(snap, 'sop.6.3.htn.bp_cutoff_asa3_defer')).toBe(false);
  });
});

// =============================================================================
// Cardiac (5 rules)
// =============================================================================

describe('sop.6.3.cardiac.cardiology_consult', () => {
  it('positive: cardiac_disease=true → fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('cardiac_disease') }), 'sop.6.3.cardiac.cardiology_consult')).toBe(true);
  });
  it('positive2: ECG abnormality flag → fires (no cardiac comorbidity needed)', () => {
    expect(fired(makeSnapshot({ facts: withFlag('imaging.ecg.abnormality') }), 'sop.6.3.cardiac.cardiology_consult')).toBe(true);
  });
  it('negative: no cardiac, no abnormality → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.cardiac.cardiology_consult')).toBe(false);
  });
});

describe('sop.6.3.cardiac.echo_recency', () => {
  it('positive: cardiac_disease=true → fires with recency 180', () => {
    const snap = makeSnapshot({ facts: withComorbidity('cardiac_disease') });
    const out = evaluate(snap, LAYER2_RULES).find(s => s.ruleId === 'sop.6.3.cardiac.echo_recency');
    expect(out?.recencyWindowDays).toBe(180);
  });
  it('negative: no cardiac, no abnormality → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.cardiac.echo_recency')).toBe(false);
  });
  it('edge: ecg.abnormality only (no cardiac comorbidity) → still fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('imaging.ecg.abnormality') }), 'sop.6.3.cardiac.echo_recency')).toBe(true);
  });
});

describe('sop.6.3.cardiac.dobutamine_stress', () => {
  it('positive: echo abnormality + is_major → REC fires', () => {
    const snap = makeSnapshot({ facts: merge(withFlag('imaging.echo.abnormality'), withFlag('surgery.is_major')) });
    expect(fired(snap, 'sop.6.3.cardiac.dobutamine_stress')).toBe(true);
  });
  it('negative: echo abnormality without is_major → does NOT fire (cardiac-row rule needs both)', () => {
    expect(fired(makeSnapshot({ facts: withFlag('imaging.echo.abnormality') }), 'sop.6.3.cardiac.dobutamine_stress')).toBe(false);
  });
  it('edge: is_major without echo abnormality → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withFlag('surgery.is_major') }), 'sop.6.3.cardiac.dobutamine_stress')).toBe(false);
  });
});

describe('sop.6.3.cardiac.recent_mi_asa4', () => {
  it('positive: recent_mi flag → REQ asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('risk.recent_mi_within_month') }), 'sop.6.3.cardiac.recent_mi_asa4')).toBe(true);
  });
  it('negative: no flag → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.cardiac.recent_mi_asa4')).toBe(false);
  });
  it('edge: payload suggestedGrade is 4', () => {
    const snap = makeSnapshot({ facts: withFlag('risk.recent_mi_within_month') });
    const out = evaluate(snap, LAYER2_RULES).find(s => s.ruleId === 'sop.6.3.cardiac.recent_mi_asa4');
    expect(out?.payload).toMatchObject({ kind: 'asa_review', suggestedGrade: 4 });
  });
});

describe('sop.6.3.cardiac.ef_below_25_asa4', () => {
  it('positive: ef_below_25 flag → REQ asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('risk.ef_below_25') }), 'sop.6.3.cardiac.ef_below_25_asa4')).toBe(true);
  });
  it('negative: no flag → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.cardiac.ef_below_25_asa4')).toBe(false);
  });
  it('edge: cardiac_disease=true alone (no EF flag) → does NOT fire this specific rule', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('cardiac_disease') }), 'sop.6.3.cardiac.ef_below_25_asa4')).toBe(false);
  });
});

// =============================================================================
// Renal (6 rules)
// =============================================================================

describe('sop.6.3.renal.nephrology_consult', () => {
  it('positive: egfr < 30 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 25) }), 'sop.6.3.renal.nephrology_consult')).toBe(true);
  });
  it('positive2: renal + control=no → fires', () => {
    expect(fired(makeSnapshot({ facts: merge(withComorbidity('renal_disease'), withControl('no')) }), 'sop.6.3.renal.nephrology_consult')).toBe(true);
  });
  it('negative: renal + control=yes + egfr>30 → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('renal_disease'), withControl('yes'), withVital('lab.egfr.value', 50)) });
    expect(fired(snap, 'sop.6.3.renal.nephrology_consult')).toBe(false);
  });
});

describe('sop.6.3.renal.fluid_management_plan', () => {
  it('positive: egfr<30 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 28) }), 'sop.6.3.renal.fluid_management_plan')).toBe(true);
  });
  it('negative: no renal facts → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.renal.fluid_management_plan')).toBe(false);
  });
  it('edge: renal + control=unknown → does NOT fire (rule needs control=no specifically)', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('renal_disease'), withControl('unknown')) });
    expect(fired(snap, 'sop.6.3.renal.fluid_management_plan')).toBe(false);
  });
});

describe('sop.6.3.renal.electrolyte_correction', () => {
  it('positive: K+ > 6 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 6.4, 'mmol/L') }), 'sop.6.3.renal.electrolyte_correction')).toBe(true);
  });
  it('positive2: K+ < 3 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 2.7, 'mmol/L') }), 'sop.6.3.renal.electrolyte_correction')).toBe(true);
  });
  it('negative: K+ = 4.2 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 4.2, 'mmol/L') }), 'sop.6.3.renal.electrolyte_correction')).toBe(false);
  });
});

describe('sop.6.3.renal.egfr_60_flag', () => {
  it('positive: egfr=55 → INFO fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 55) }), 'sop.6.3.renal.egfr_60_flag')).toBe(true);
  });
  it('negative: egfr=80 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 80) }), 'sop.6.3.renal.egfr_60_flag')).toBe(false);
  });
  it('edge: egfr unset → does NOT fire (conservative)', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('renal_disease') }), 'sop.6.3.renal.egfr_60_flag')).toBe(false);
  });
});

describe('sop.6.3.renal.k_cutoff', () => {
  it('positive: renal_disease=true → INFO fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('renal_disease') }), 'sop.6.3.renal.k_cutoff')).toBe(true);
  });
  it('negative: no renal → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.renal.k_cutoff')).toBe(false);
  });
  it('edge: low egfr but no comorbidity flag → does NOT fire (rule is comorbidity-driven)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 25) }), 'sop.6.3.renal.k_cutoff')).toBe(false);
  });
});

describe('sop.6.3.renal.esrd_asa3', () => {
  it('positive: egfr<15 → REQ asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 12) }), 'sop.6.3.renal.esrd_asa3')).toBe(true);
  });
  it('positive2: medication mentions dialysis → fires', () => {
    expect(fired(makeSnapshot({ facts: withMedication('On haemodialysis MWF') }), 'sop.6.3.renal.esrd_asa3')).toBe(true);
  });
  it('negative: egfr=40, no dialysis → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 40) }), 'sop.6.3.renal.esrd_asa3')).toBe(false);
  });
});

// =============================================================================
// Hypothyroidism (2 rules)
// =============================================================================

describe('sop.6.3.hypothyroid.tft_required', () => {
  it('positive: thyroid=true → fires with recency 90d', () => {
    const snap = makeSnapshot({ facts: withComorbidity('thyroid') });
    expect(fired(snap, 'sop.6.3.hypothyroid.tft_required')).toBe(true);
    const out = evaluate(snap, LAYER2_RULES).find(s => s.ruleId === 'sop.6.3.hypothyroid.tft_required');
    expect(out?.recencyWindowDays).toBe(90);
  });
  it('negative: no thyroid → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.hypothyroid.tft_required')).toBe(false);
  });
  it('edge: thyroid=true + control=yes → still fires (TFT is universal for thyroid pts)', () => {
    expect(fired(makeSnapshot({ facts: merge(withComorbidity('thyroid'), withControl('yes')) }), 'sop.6.3.hypothyroid.tft_required')).toBe(true);
  });
});

describe('sop.6.3.hypothyroid.physician_review', () => {
  it('positive: thyroid + tsh > 5 → REC fires', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('thyroid'), withVital('lab.tsh.value', 7.2)) });
    expect(fired(snap, 'sop.6.3.hypothyroid.physician_review')).toBe(true);
  });
  it('negative: thyroid + tsh = 3 → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('thyroid'), withVital('lab.tsh.value', 3)) });
    expect(fired(snap, 'sop.6.3.hypothyroid.physician_review')).toBe(false);
  });
  it('edge: thyroid + tsh unset → does NOT fire (conservative)', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('thyroid') }), 'sop.6.3.hypothyroid.physician_review')).toBe(false);
  });
});

// =============================================================================
// Obesity (6 rules)
// =============================================================================

describe('sop.6.3.obesity.airway_assessment', () => {
  it('positive: BMI 32 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 32, 'kg/m2') }), 'sop.6.3.obesity.airway_assessment')).toBe(true);
  });
  it('positive2: comorbidity.obesity=true → fires (no BMI value needed)', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('obesity') }), 'sop.6.3.obesity.airway_assessment')).toBe(true);
  });
  it('negative: BMI 25, no obesity flag → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 25, 'kg/m2') }), 'sop.6.3.obesity.airway_assessment')).toBe(false);
  });
});

describe('sop.6.3.obesity.osa_screening', () => {
  it('positive: BMI 38 → REQ clearance fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 38, 'kg/m2') }), 'sop.6.3.obesity.osa_screening')).toBe(true);
  });
  it('negative: BMI 32 → does NOT fire (threshold is 35)', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 32, 'kg/m2') }), 'sop.6.3.obesity.osa_screening')).toBe(false);
  });
  it('edge: comorbidity.obesity flag without BMI value → does NOT fire (literal trigger needs BMI value)', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('obesity') }), 'sop.6.3.obesity.osa_screening')).toBe(false);
  });
});

describe('sop.6.3.obesity.positioning_plan', () => {
  it('positive: BMI 40 → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 40, 'kg/m2') }), 'sop.6.3.obesity.positioning_plan')).toBe(true);
  });
  it('negative: BMI 33 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 33, 'kg/m2') }), 'sop.6.3.obesity.positioning_plan')).toBe(false);
  });
  it('edge: BMI exactly 35 → does NOT fire (strict >)', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 35, 'kg/m2') }), 'sop.6.3.obesity.positioning_plan')).toBe(false);
  });
});

describe('sop.6.3.obesity.bmi_30_asa2', () => {
  it('positive: BMI 31 → INFO asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 31, 'kg/m2') }), 'sop.6.3.obesity.bmi_30_asa2')).toBe(true);
  });
  it('negative: BMI 28 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 28, 'kg/m2') }), 'sop.6.3.obesity.bmi_30_asa2')).toBe(false);
  });
  it('edge: payload suggestedGrade=2', () => {
    const snap = makeSnapshot({ facts: withVital('vital.bmi.value', 32, 'kg/m2') });
    const out = evaluate(snap, LAYER2_RULES).find(s => s.ruleId === 'sop.6.3.obesity.bmi_30_asa2');
    expect(out?.payload).toMatchObject({ kind: 'asa_review', suggestedGrade: 2 });
  });
});

describe('sop.6.3.obesity.bmi_35_osa_asa3', () => {
  it('positive: BMI 38 + osa flag → fires', () => {
    const snap = makeSnapshot({ facts: merge(withVital('vital.bmi.value', 38, 'kg/m2'), withComorbidity('osa')) });
    expect(fired(snap, 'sop.6.3.obesity.bmi_35_osa_asa3')).toBe(true);
  });
  it('negative: BMI 38 alone (no osa) → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.bmi.value', 38, 'kg/m2') }), 'sop.6.3.obesity.bmi_35_osa_asa3')).toBe(false);
  });
  it('edge: osa alone (no BMI) → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('osa') }), 'sop.6.3.obesity.bmi_35_osa_asa3')).toBe(false);
  });
});

describe('sop.6.3.obesity.glp1_npo', () => {
  it('positive: medication mentions Ozempic → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Ozempic 0.5mg weekly') }), 'sop.6.3.obesity.glp1_npo')).toBe(true);
  });
  it('positive2: medication mentions semaglutide → fires (regex-matched)', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Patient on semaglutide 1mg/wk') }), 'sop.6.3.obesity.glp1_npo')).toBe(true);
  });
  it('negative: medication.notes empty → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.obesity.glp1_npo')).toBe(false);
  });
});

// =============================================================================
// Anaemia (4 rules)
// =============================================================================

describe('sop.6.3.anaemia.iron_studies', () => {
  it('positive: anaemia=true → fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('anaemia') }), 'sop.6.3.anaemia.iron_studies')).toBe(true);
  });
  it('positive2: hb < 10 (no anaemia flag) → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 9.2, 'g/dL') }), 'sop.6.3.anaemia.iron_studies')).toBe(true);
  });
  it('negative: hb=14, no anaemia → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 14, 'g/dL') }), 'sop.6.3.anaemia.iron_studies')).toBe(false);
  });
});

describe('sop.6.3.anaemia.identify_cause', () => {
  it('positive: anaemia=true → fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('anaemia') }), 'sop.6.3.anaemia.identify_cause')).toBe(true);
  });
  it('negative: hb=9 alone (no anaemia comorbidity flag) → does NOT fire (rule needs flag)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 9, 'g/dL') }), 'sop.6.3.anaemia.identify_cause')).toBe(false);
  });
  it('edge: anaemia + asa=4 → still fires', () => {
    const snap = makeSnapshot({ asaGrade: 4, facts: withComorbidity('anaemia') });
    expect(fired(snap, 'sop.6.3.anaemia.identify_cause')).toBe(true);
  });
});

describe('sop.6.3.anaemia.hb_8_defer', () => {
  it('positive: hb < 8 → REQ asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 7.8, 'g/dL') }), 'sop.6.3.anaemia.hb_8_defer')).toBe(true);
  });
  it('negative: hb 9 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 9, 'g/dL') }), 'sop.6.3.anaemia.hb_8_defer')).toBe(false);
  });
  it('edge: hb exactly 8 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 8, 'g/dL') }), 'sop.6.3.anaemia.hb_8_defer')).toBe(false);
  });
});

describe('sop.6.3.anaemia.hb_7_transfuse', () => {
  it('positive: hb < 7 → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 6.5, 'g/dL') }), 'sop.6.3.anaemia.hb_7_transfuse')).toBe(true);
  });
  it('negative: hb=8 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 8, 'g/dL') }), 'sop.6.3.anaemia.hb_7_transfuse')).toBe(false);
  });
  it('edge: hb=7 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 7, 'g/dL') }), 'sop.6.3.anaemia.hb_7_transfuse')).toBe(false);
  });
});

// =============================================================================
// Respiratory (6 rules)
// =============================================================================

describe('sop.6.3.respiratory.pulmonology_consult', () => {
  it('positive: respiratory_disease + control=no → fires', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('respiratory_disease'), withControl('no')) });
    expect(fired(snap, 'sop.6.3.respiratory.pulmonology_consult')).toBe(true);
  });
  it('negative: respiratory + control=yes → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('respiratory_disease'), withControl('yes')) });
    expect(fired(snap, 'sop.6.3.respiratory.pulmonology_consult')).toBe(false);
  });
  it('edge: respiratory + control=unknown → fires', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('respiratory_disease'), withControl('unknown')) });
    expect(fired(snap, 'sop.6.3.respiratory.pulmonology_consult')).toBe(true);
  });
});

describe('sop.6.3.respiratory.abg_asa3', () => {
  it('positive: respiratory + ASA 3 → fires', () => {
    const snap = makeSnapshot({ asaGrade: 3, facts: withComorbidity('respiratory_disease') });
    expect(fired(snap, 'sop.6.3.respiratory.abg_asa3')).toBe(true);
  });
  it('negative: respiratory + ASA 2 → does NOT fire', () => {
    const snap = makeSnapshot({ asaGrade: 2, facts: withComorbidity('respiratory_disease') });
    expect(fired(snap, 'sop.6.3.respiratory.abg_asa3')).toBe(false);
  });
  it('edge: ASA 3 alone (no respiratory) → does NOT fire', () => {
    expect(fired(makeSnapshot({ asaGrade: 3 }), 'sop.6.3.respiratory.abg_asa3')).toBe(false);
  });
});

describe('sop.6.3.respiratory.ct_thorax', () => {
  it('positive: respiratory + recent_pneumonia → fires', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('respiratory_disease'), withFlag('history.recent_pneumonia')) });
    expect(fired(snap, 'sop.6.3.respiratory.ct_thorax')).toBe(true);
  });
  it('positive2: respiratory + wheeze_active → fires', () => {
    const snap = makeSnapshot({ facts: merge(withComorbidity('respiratory_disease'), withFlag('vital.wheeze_active')) });
    expect(fired(snap, 'sop.6.3.respiratory.ct_thorax')).toBe(true);
  });
  it('negative: respiratory alone → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('respiratory_disease') }), 'sop.6.3.respiratory.ct_thorax')).toBe(false);
  });
});

describe('sop.6.3.respiratory.spo2_94_flag', () => {
  it('positive: spo2=92 → REC fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 92, '%') }), 'sop.6.3.respiratory.spo2_94_flag')).toBe(true);
  });
  it('negative: spo2=98 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 98, '%') }), 'sop.6.3.respiratory.spo2_94_flag')).toBe(false);
  });
  it('edge: spo2 unset → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.respiratory.spo2_94_flag')).toBe(false);
  });
});

describe('sop.6.3.respiratory.spo2_90_abg', () => {
  it('positive: spo2=88 → REQ ABG fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 88, '%') }), 'sop.6.3.respiratory.spo2_90_abg')).toBe(true);
  });
  it('negative: spo2=92 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 92, '%') }), 'sop.6.3.respiratory.spo2_90_abg')).toBe(false);
  });
  it('edge: spo2 exactly 90 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 90, '%') }), 'sop.6.3.respiratory.spo2_90_abg')).toBe(false);
  });
});

describe('sop.6.3.respiratory.active_wheeze_asa3', () => {
  it('positive: wheeze_active flag → INFO asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('vital.wheeze_active') }), 'sop.6.3.respiratory.active_wheeze_asa3')).toBe(true);
  });
  it('positive2: urti_active flag → fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('vital.urti_active') }), 'sop.6.3.respiratory.active_wheeze_asa3')).toBe(true);
  });
  it('negative: no wheeze, no urti → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.respiratory.active_wheeze_asa3')).toBe(false);
  });
});

// =============================================================================
// Infection (6 rules)
// =============================================================================

describe('sop.6.3.infection.source_identification', () => {
  it('positive: temperature > 38 → REQ clearance fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.temperature_c.value', 39, '°C') }), 'sop.6.3.infection.source_identification')).toBe(true);
  });
  it('positive2: infection_active flag → fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('infection_active') }), 'sop.6.3.infection.source_identification')).toBe(true);
  });
  it('negative: temp=37.5, no infection → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.temperature_c.value', 37.5, '°C') }), 'sop.6.3.infection.source_identification')).toBe(false);
  });
});

describe('sop.6.3.infection.cultures', () => {
  it('positive: temperature > 38 → REQ diag fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.temperature_c.value', 38.5, '°C') }), 'sop.6.3.infection.cultures')).toBe(true);
  });
  it('negative: temp=37, no infection → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.temperature_c.value', 37, '°C') }), 'sop.6.3.infection.cultures')).toBe(false);
  });
  it('edge: infection_active flag alone → fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('infection_active') }), 'sop.6.3.infection.cultures')).toBe(true);
  });
});

describe('sop.6.3.infection.antibiotic_plan', () => {
  it('positive: infection_active flag → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('infection_active') }), 'sop.6.3.infection.antibiotic_plan')).toBe(true);
  });
  it('negative: no infection → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.infection.antibiotic_plan')).toBe(false);
  });
  it('edge: temp=38.1 → fires (just over threshold)', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.temperature_c.value', 38.1, '°C') }), 'sop.6.3.infection.antibiotic_plan')).toBe(true);
  });
});

describe('sop.6.3.infection.recent_resolved_asa2', () => {
  it('positive: recent_fever_resolved flag → INFO fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('history.recent_fever_resolved_within_week') }), 'sop.6.3.infection.recent_resolved_asa2')).toBe(true);
  });
  it('negative: no flag → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.infection.recent_resolved_asa2')).toBe(false);
  });
  it('edge: ongoing fever flag (different rule) → does NOT fire this one', () => {
    expect(fired(makeSnapshot({ facts: withFlag('vital.fever_ongoing') }), 'sop.6.3.infection.recent_resolved_asa2')).toBe(false);
  });
});

describe('sop.6.3.infection.ongoing_asa3_defer', () => {
  it('positive: fever_ongoing flag → REQ asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('vital.fever_ongoing') }), 'sop.6.3.infection.ongoing_asa3_defer')).toBe(true);
  });
  it('negative: no fever flag → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.infection.ongoing_asa3_defer')).toBe(false);
  });
  it('edge: temperature high (>38) but no fever_ongoing flag → does NOT fire (rule needs structured flag)', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.temperature_c.value', 39, '°C') }), 'sop.6.3.infection.ongoing_asa3_defer')).toBe(false);
  });
});

describe('sop.6.3.infection.elective_defer_48h', () => {
  it('positive: elective + fever_ongoing → REQ info_only fires', () => {
    const snap = makeSnapshot({ facts: merge(withUrgency('elective'), withFlag('vital.fever_ongoing')) });
    expect(fired(snap, 'sop.6.3.infection.elective_defer_48h')).toBe(true);
  });
  it('negative: emergency + fever_ongoing → does NOT fire (rule is elective-only)', () => {
    const snap = makeSnapshot({ facts: merge(withUrgency('emergency'), withFlag('vital.fever_ongoing')) });
    expect(fired(snap, 'sop.6.3.infection.elective_defer_48h')).toBe(false);
  });
  it('edge: elective without fever → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withUrgency('elective') }), 'sop.6.3.infection.elective_defer_48h')).toBe(false);
  });
});

// =============================================================================
// Anticoagulant (6 rules)
// =============================================================================

describe('sop.6.3.anticoag.haematology_guidance', () => {
  it('positive: medication mentions warfarin → REQ clearance fires', () => {
    expect(fired(makeSnapshot({ facts: withMedication('On warfarin 5mg OD INR 2.4') }), 'sop.6.3.anticoag.haematology_guidance')).toBe(true);
  });
  it('positive2: medication mentions clopidogrel → fires', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Clopidogrel 75mg post-PCI') }), 'sop.6.3.anticoag.haematology_guidance')).toBe(true);
  });
  it('negative: medication.notes empty → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.anticoag.haematology_guidance')).toBe(false);
  });
});

describe('sop.6.3.anticoag.inr_documented', () => {
  it('positive: anticoag in medication → fires REQ diag', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Apixaban 5mg BD') }), 'sop.6.3.anticoag.inr_documented')).toBe(true);
  });
  it('negative: no anticoag medication → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Pantoprazole 40mg') }), 'sop.6.3.anticoag.inr_documented')).toBe(false);
  });
  it('edge: heparin in medication → fires (regex captures heparin)', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Heparin SC bridging') }), 'sop.6.3.anticoag.inr_documented')).toBe(true);
  });
});

describe('sop.6.3.anticoag.neuraxial_safety', () => {
  it('positive: anticoag + requires_neuraxial → fires', () => {
    const snap = makeSnapshot({ facts: merge(withMedication('Aspirin 75mg OD'), withFlag('surgery.requires_neuraxial')) });
    expect(fired(snap, 'sop.6.3.anticoag.neuraxial_safety')).toBe(true);
  });
  it('negative: anticoag without neuraxial → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Aspirin 75mg OD') }), 'sop.6.3.anticoag.neuraxial_safety')).toBe(false);
  });
  it('edge: neuraxial without anticoag → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withFlag('surgery.requires_neuraxial') }), 'sop.6.3.anticoag.neuraxial_safety')).toBe(false);
  });
});

describe('sop.6.3.anticoag.inr_1_5_major_defer', () => {
  it('positive: inr=1.8 + is_major → REQ fires', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.8), withFlag('surgery.is_major')) });
    expect(fired(snap, 'sop.6.3.anticoag.inr_1_5_major_defer')).toBe(true);
  });
  it('negative: inr=1.2 + is_major → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.2), withFlag('surgery.is_major')) });
    expect(fired(snap, 'sop.6.3.anticoag.inr_1_5_major_defer')).toBe(false);
  });
  it('edge: inr=1.8 without is_major → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.inr.value', 1.8) }), 'sop.6.3.anticoag.inr_1_5_major_defer')).toBe(false);
  });
});

describe('sop.6.3.anticoag.inr_1_4_neuraxial_defer', () => {
  it('positive: inr=1.5 + requires_neuraxial → REQ fires', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.5), withFlag('surgery.requires_neuraxial')) });
    expect(fired(snap, 'sop.6.3.anticoag.inr_1_4_neuraxial_defer')).toBe(true);
  });
  it('negative: inr=1.2 + requires_neuraxial → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.2), withFlag('surgery.requires_neuraxial')) });
    expect(fired(snap, 'sop.6.3.anticoag.inr_1_4_neuraxial_defer')).toBe(false);
  });
  it('edge: inr=1.5 without neuraxial → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.inr.value', 1.5) }), 'sop.6.3.anticoag.inr_1_4_neuraxial_defer')).toBe(false);
  });
});

describe('sop.6.3.anticoag.not_stopped_asa3', () => {
  it('positive: medication mentions anticoagulant + habit_stopped.anticoagulant=false → REQ asa_review fires', () => {
    const snap = makeSnapshot({
      facts: merge(withMedication('Patient on chronic anticoagulant'), withFalse('habit_stopped.anticoagulant')),
    });
    expect(fired(snap, 'sop.6.3.anticoag.not_stopped_asa3')).toBe(true);
  });
  it('negative: anticoagulant in notes but no stopped flag → does NOT fire (stop flag must be explicitly false)', () => {
    expect(fired(makeSnapshot({ facts: withMedication('On anticoagulant') }), 'sop.6.3.anticoag.not_stopped_asa3')).toBe(false);
  });
  it('edge: anticoag + stopped=true (i.e., has been stopped) → does NOT fire', () => {
    const snap = makeSnapshot({
      facts: merge(withMedication('On anticoagulant'), { 'habit_stopped.anticoagulant': { value: true } }),
    });
    expect(fired(snap, 'sop.6.3.anticoag.not_stopped_asa3')).toBe(false);
  });
});

// =============================================================================
// Smoking / Alcohol (3 rules)
// =============================================================================

describe('sop.6.3.smoking.cessation_status', () => {
  it('positive: habit.smoking → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withHabit('smoking') }), 'sop.6.3.smoking.cessation_status')).toBe(true);
  });
  it('positive2: habit.alcohol → fires', () => {
    expect(fired(makeSnapshot({ facts: withHabit('alcohol') }), 'sop.6.3.smoking.cessation_status')).toBe(true);
  });
  it('negative: no habits → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.smoking.cessation_status')).toBe(false);
  });
});

describe('sop.6.3.smoking.stopped_3d_asa2', () => {
  it('positive: smoking + habit_stopped=yes → INFO asa_review fires', () => {
    const snap = makeSnapshot({ facts: merge(withHabit('smoking'), withHabitsStopped('yes')) });
    expect(fired(snap, 'sop.6.3.smoking.stopped_3d_asa2')).toBe(true);
  });
  it('negative: smoking + habit_stopped=no → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withHabit('smoking'), withHabitsStopped('no')) });
    expect(fired(snap, 'sop.6.3.smoking.stopped_3d_asa2')).toBe(false);
  });
  it('edge: habit_stopped=yes alone (no habit) → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withHabitsStopped('yes') }), 'sop.6.3.smoking.stopped_3d_asa2')).toBe(false);
  });
});

describe('sop.6.3.smoking.not_stopped_asa3', () => {
  it('positive: alcohol + habit_stopped=no → INFO asa_review fires', () => {
    const snap = makeSnapshot({ facts: merge(withHabit('alcohol'), withHabitsStopped('no')) });
    expect(fired(snap, 'sop.6.3.smoking.not_stopped_asa3')).toBe(true);
  });
  it('negative: alcohol + habit_stopped=yes → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withHabit('alcohol'), withHabitsStopped('yes')) });
    expect(fired(snap, 'sop.6.3.smoking.not_stopped_asa3')).toBe(false);
  });
  it('edge: tobacco_chewing + stopped=no → fires (any habit qualifies)', () => {
    const snap = makeSnapshot({ facts: merge(withHabit('tobacco_chewing'), withHabitsStopped('no')) });
    expect(fired(snap, 'sop.6.3.smoking.not_stopped_asa3')).toBe(true);
  });
});

// =============================================================================
// Coagulopathy (5 rules)
// =============================================================================

describe('sop.6.3.coag.haematology_consult', () => {
  it('positive: coagulopathy=true → REQ clearance fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('coagulopathy') }), 'sop.6.3.coag.haematology_consult')).toBe(true);
  });
  it('negative: no coagulopathy → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.coag.haematology_consult')).toBe(false);
  });
  it('edge: thrombocytopenia (different comorbidity) → does NOT fire this rule', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('thrombocytopenia') }), 'sop.6.3.coag.haematology_consult')).toBe(false);
  });
});

describe('sop.6.3.coag.detailed_workup', () => {
  it('positive: coagulopathy=true → REQ diag fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('coagulopathy') }), 'sop.6.3.coag.detailed_workup')).toBe(true);
  });
  it('negative: no coagulopathy → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.coag.detailed_workup')).toBe(false);
  });
  it('edge: coagulopathy + asa=4 → still fires', () => {
    expect(fired(makeSnapshot({ asaGrade: 4, facts: withComorbidity('coagulopathy') }), 'sop.6.3.coag.detailed_workup')).toBe(true);
  });
});

describe('sop.6.3.coag.factor_replacement_plan', () => {
  it('positive: coagulopathy=true → REC order fires', () => {
    expect(fired(makeSnapshot({ facts: withComorbidity('coagulopathy') }), 'sop.6.3.coag.factor_replacement_plan')).toBe(true);
  });
  it('negative: no coagulopathy → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.3.coag.factor_replacement_plan')).toBe(false);
  });
  it('edge: payload severity is recommended', () => {
    const snap = makeSnapshot({ facts: withComorbidity('coagulopathy') });
    const out = evaluate(snap, LAYER2_RULES).find(s => s.ruleId === 'sop.6.3.coag.factor_replacement_plan');
    expect(out?.severity).toBe('recommended');
  });
});

describe('sop.6.3.coag.platelets_50_major_defer', () => {
  it('positive: platelets=40 → REQ info_only fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 40, 'x10^9/L') }), 'sop.6.3.coag.platelets_50_major_defer')).toBe(true);
  });
  it('negative: platelets=120 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 120, 'x10^9/L') }), 'sop.6.3.coag.platelets_50_major_defer')).toBe(false);
  });
  it('edge: platelets exactly 50 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 50, 'x10^9/L') }), 'sop.6.3.coag.platelets_50_major_defer')).toBe(false);
  });
});

describe('sop.6.3.coag.platelets_80_epidural_defer', () => {
  it('positive: platelets=70 + requires_epidural → REQ fires', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.platelets.value', 70, 'x10^9/L'), withFlag('surgery.requires_epidural')) });
    expect(fired(snap, 'sop.6.3.coag.platelets_80_epidural_defer')).toBe(true);
  });
  it('negative: platelets=70 without epidural → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 70, 'x10^9/L') }), 'sop.6.3.coag.platelets_80_epidural_defer')).toBe(false);
  });
  it('edge: platelets=85 + requires_epidural → does NOT fire (above threshold)', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.platelets.value', 85, 'x10^9/L'), withFlag('surgery.requires_epidural')) });
    expect(fired(snap, 'sop.6.3.coag.platelets_80_epidural_defer')).toBe(false);
  });
});

// =============================================================================
// Sanity — all 59 Layer 2 rules covered
// =============================================================================

describe('Layer 2 catalogue coverage', () => {
  it('LAYER2_RULES has exactly 59 rules', () => {
    expect(LAYER2_RULES).toHaveLength(59);
  });
  it('every rule has unique id', () => {
    const ids = LAYER2_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every rule has layer === 2', () => {
    expect(LAYER2_RULES.every((r) => r.layer === 2)).toBe(true);
  });
});
