// =============================================================================
// PAC Workspace v2 — Layer 2 comorbidity rules (PCW2.2b)
//
// PRD §6.3. 12 categories, 59 rules. Conservative-on-missing semantics
// throughout — rules referencing facts not yet emitted by the form/lab
// pipeline (vital.*, lab.*, history.*, risk.*) sit dormant until those
// facts arrive (PCW2.5 result entry, PCW2.7 PAC-visit data, future feeds).
//
// Layer 2 has NO eligibility gate — comorbidity rules fire whenever the
// underlying fact is present, regardless of asaGrade or anaesthesia type
// (those constrain Layer 1 only). Some rules cross-reference asaGrade
// (e.g., bp_cutoff_asa3_defer); they check it explicitly.
// =============================================================================

import { defineRule } from '../engine-types';
import type { PacRule } from '../engine-types';
import {
  isTrue,
  inSet,
  regexMatch,
  valueGt,
  valueLt,
} from '../fact-helpers';

const ANTICOAG_REGEX =
  /(warfarin|heparin|apixaban|rivaroxaban|dabigatran|aspirin|clopidogrel|ticagrelor|edoxaban)/i;
const GLP1_REGEX = /(ozempic|mounjaro|semaglutide|tirzepatide|GLP-1)/i;
const METFORMIN_REGEX = /metformin/i;
const DIALYSIS_REGEX = /dialysis/i;

const REC_180D = 180;
const REC_90D = 90;
const REC_30D = 30;

// Helper: any of the three habits is present.
function hasAnyHabit(s: Parameters<PacRule['trigger']>[0]): boolean {
  return (
    isTrue(s, 'habit.smoking') ||
    isTrue(s, 'habit.alcohol') ||
    isTrue(s, 'habit.tobacco_chewing')
  );
}

// =============================================================================
// Diabetes (4 rules)
// =============================================================================

const DIABETES: PacRule[] = [
  defineRule({
    id: 'sop.6.3.diabetes.hba1c',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Diabetes row',
    recencyWindowDays: REC_90D,
    trigger: (s) => isTrue(s, 'comorbidity.diabetes'),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.hba1c', label: 'HbA1c' }),
    reason: () => 'Diabetic patient — HbA1c required for optimisation review (SOP §6.3, recency 90 days).',
  }),
  defineRule({
    id: 'sop.6.3.diabetes.endocrine_clearance',
    version: 1,
    layer: 2,
    severity: 'recommended',
    routesTo: 'clearance',
    sopReference: '§6.3 Diabetes row',
    trigger: (s) =>
      isTrue(s, 'comorbidity.diabetes') &&
      (valueGt(s, 'lab.hba1c.value', 8) ||
        inSet(s, 'comorbidity_control._global', ['no', 'unknown'])),
    payload: () => ({
      kind: 'clearance',
      specialty: 'endocrinology',
      label: 'Endocrinology / Physician consultation',
    }),
    reason: (s) => {
      if (valueGt(s, 'lab.hba1c.value', 8)) {
        return 'HbA1c > 8 — endocrine review for optimisation (SOP §6.3).';
      }
      return 'Diabetes control unclear (Marketing Handoff) — endocrine review recommended (SOP §6.3).';
    },
  }),
  defineRule({
    id: 'sop.6.3.diabetes.day_of_rbs_cutoff',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'info_only',
    sopReference: '§6.3 Diabetes / §6.2 day-of cutoffs',
    trigger: (s) => isTrue(s, 'comorbidity.diabetes'),
    payload: () => ({
      kind: 'info_only',
      message: 'Day-of cutoff: RBS < 180 mg/dL. RBS > 216 → initiate VRIII per §6.2.',
    }),
    reason: () => 'Diabetic patient — surface day-of glucose cutoff for the OT team.',
  }),
  defineRule({
    id: 'sop.6.3.diabetes.continue_metformin_hold',
    version: 1,
    layer: 2,
    severity: 'recommended',
    routesTo: 'order',
    sopReference: '§6.3 Diabetes row (clinical convention)',
    trigger: (s) => regexMatch(s, 'medication.notes', METFORMIN_REGEX),
    payload: () => ({
      kind: 'order',
      orderType: 'medication.metformin_hold',
      label: 'Hold metformin 24h pre-op',
    }),
    reason: () => 'Metformin in current medication — hold 24 hours pre-op (clinical convention).',
  }),
];

// =============================================================================
// Hypertension (6 rules)
// =============================================================================

const HYPERTENSION: PacRule[] = [
  defineRule({
    id: 'sop.6.3.htn.physician_review',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Hypertension row',
    trigger: (s) => isTrue(s, 'comorbidity.hypertension'),
    payload: () => ({ kind: 'clearance', specialty: 'physician', label: 'Physician review of BP optimisation' }),
    reason: () => 'Hypertensive patient — physician review of BP optimisation required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.htn.ecg_recency',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Hypertension row',
    recencyWindowDays: REC_180D,
    trigger: (s) => isTrue(s, 'comorbidity.hypertension'),
    payload: () => ({ kind: 'diagnostic', orderType: 'imaging.ecg', label: 'ECG' }),
    reason: () => 'Hypertensive patient — ECG required, recency 180 days (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.htn.echo_recency',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Hypertension row',
    recencyWindowDays: REC_180D,
    trigger: (s) => isTrue(s, 'comorbidity.hypertension'),
    payload: () => ({ kind: 'diagnostic', orderType: 'imaging.echo', label: '2D Echo' }),
    reason: () => 'Hypertensive patient — 2D Echo required, recency 180 days (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.htn.continue_meds_morning',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'order',
    sopReference: '§6.3 Hypertension row',
    trigger: (s) => isTrue(s, 'comorbidity.hypertension'),
    payload: () => ({
      kind: 'order',
      orderType: 'medication.continue_antihypertensive',
      label: 'Continue antihypertensives morning of surgery (sip of water)',
    }),
    reason: () => 'Continue regular antihypertensives morning of surgery (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.htn.bp_cutoff_asa2',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'info_only',
    sopReference: '§6.3 Hypertension row (ASA 2 cutoff)',
    trigger: (s) => s.asaGrade === 2 && isTrue(s, 'comorbidity.hypertension'),
    payload: () => ({
      kind: 'info_only',
      message: 'BP target < 150/100 mmHg on ≥ 2 readings before listing.',
    }),
    reason: () => 'Hypertensive ASA 2 — surface BP cutoff (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.htn.bp_cutoff_asa3_defer',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: '§6.3 Hypertension row (ASA 3 defer)',
    trigger: (s) => s.asaGrade === 3 && valueGt(s, 'vital.bp_systolic.value', 150),
    payload: () => ({
      kind: 'info_only',
      message: 'BP > 150/90 on 2 readings — defer elective surgery, optimise (SOP §6.3).',
    }),
    reason: () => 'ASA 3 with BP > 150 — defer per SOP §6.3 hypertension cutoff.',
  }),
];

// =============================================================================
// Cardiac disease / new ECG changes (5 rules)
// =============================================================================

const CARDIAC: PacRule[] = [
  defineRule({
    id: 'sop.6.3.cardiac.cardiology_consult',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Cardiac row',
    trigger: (s) =>
      isTrue(s, 'comorbidity.cardiac_disease') ||
      isTrue(s, 'imaging.ecg.abnormality'),
    payload: () => ({ kind: 'clearance', specialty: 'cardiology', label: 'Cardiology consultation' }),
    reason: (s) =>
      isTrue(s, 'imaging.ecg.abnormality')
        ? 'New ECG abnormality — cardiology consultation MANDATORY (SOP §6.3).'
        : 'Known cardiac disease — cardiology consultation MANDATORY (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.cardiac.echo_recency',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Cardiac row',
    recencyWindowDays: REC_180D,
    trigger: (s) =>
      isTrue(s, 'comorbidity.cardiac_disease') ||
      isTrue(s, 'imaging.ecg.abnormality'),
    payload: () => ({ kind: 'diagnostic', orderType: 'imaging.echo', label: '2D Echo' }),
    reason: () => 'Cardiac patient — 2D Echo required, recency 180 days (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.cardiac.dobutamine_stress',
    version: 1,
    layer: 2,
    severity: 'recommended',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Cardiac row (conditional)',
    trigger: (s) =>
      isTrue(s, 'imaging.echo.abnormality') && isTrue(s, 'surgery.is_major'),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'imaging.dobutamine_stress_echo',
      label: 'Dobutamine stress echo',
    }),
    reason: () =>
      'Echo abnormality + major surgery — stress test recommended (SOP §6.3 cardiac conditional).',
  }),
  defineRule({
    id: 'sop.6.3.cardiac.recent_mi_asa4',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: '§6.3 Cardiac row + §6.2 ASA 4 trigger',
    trigger: (s) => isTrue(s, 'risk.recent_mi_within_month'),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 4,
      reasonText: 'Recent MI within 1 month — ASA 4, direct ICU admission per §6.2.',
    }),
    reason: () => 'Recent MI < 1 month — ASA 4 review required (SOP §6.3 + §6.2).',
  }),
  defineRule({
    id: 'sop.6.3.cardiac.ef_below_25_asa4',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: '§6.3 Cardiac row',
    trigger: (s) => isTrue(s, 'risk.ef_below_25'),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 4,
      reasonText: 'Ejection fraction < 25% — ASA 4 review required.',
    }),
    reason: () => 'EF < 25% — ASA 4 review required (SOP §6.3).',
  }),
];

// =============================================================================
// Renal impairment (6 rules)
// =============================================================================

const RENAL: PacRule[] = [
  defineRule({
    id: 'sop.6.3.renal.nephrology_consult',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Renal row',
    trigger: (s) =>
      valueLt(s, 'lab.egfr.value', 30) ||
      (isTrue(s, 'comorbidity.renal_disease') &&
        inSet(s, 'comorbidity_control._global', ['no'])),
    payload: () => ({ kind: 'clearance', specialty: 'nephrology', label: 'Nephrology consultation' }),
    reason: (s) =>
      valueLt(s, 'lab.egfr.value', 30)
        ? 'eGFR < 30 mL/min/1.73m² — nephrology consultation required (SOP §6.3).'
        : 'Uncontrolled renal disease — nephrology consultation required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.renal.fluid_management_plan',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.3 Renal row',
    trigger: (s) =>
      valueLt(s, 'lab.egfr.value', 30) ||
      (isTrue(s, 'comorbidity.renal_disease') &&
        inSet(s, 'comorbidity_control._global', ['no'])),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.fluid_management',
      label: 'Fluid management plan documented',
    }),
    reason: () => 'Renal impairment — fluid management plan required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.renal.electrolyte_correction',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.3 Renal row (electrolytes)',
    trigger: (s) =>
      valueLt(s, 'lab.potassium.value', 3.0) ||
      valueGt(s, 'lab.potassium.value', 6.0),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.electrolyte_correction',
      label: 'Electrolyte correction',
    }),
    reason: (s) =>
      valueGt(s, 'lab.potassium.value', 6.0)
        ? 'K⁺ > 6.0 mmol/L — correction required before surgery (SOP §6.3).'
        : 'K⁺ < 3.0 mmol/L — correction required before surgery (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.renal.egfr_60_flag',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'info_only',
    sopReference: '§6.3 Renal row',
    trigger: (s) => valueLt(s, 'lab.egfr.value', 60),
    payload: () => ({
      kind: 'info_only',
      message: 'eGFR < 60 — flag increased perioperative risk.',
    }),
    reason: () => 'eGFR < 60 — increased perioperative risk (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.renal.k_cutoff',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'info_only',
    sopReference: '§6.3 Renal row (K+ cutoff)',
    trigger: (s) => isTrue(s, 'comorbidity.renal_disease'),
    payload: () => ({
      kind: 'info_only',
      message: 'K⁺ cutoff for surgery: 3.0–6.0 mmol/L.',
    }),
    reason: () => 'Renal patient — surface K⁺ cutoff (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.renal.esrd_asa3',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: '§6.3 Renal row (ESRD)',
    trigger: (s) =>
      valueLt(s, 'lab.egfr.value', 15) ||
      regexMatch(s, 'medication.notes', DIALYSIS_REGEX),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'ESRD (eGFR < 15 or on dialysis) — ASA 3 minimum.',
    }),
    reason: () => 'ESRD detected — ASA 3 review required (SOP §6.3).',
  }),
];

// =============================================================================
// Hypothyroidism (2 rules)
// =============================================================================

const HYPOTHYROID: PacRule[] = [
  defineRule({
    id: 'sop.6.3.hypothyroid.tft_required',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Hypothyroidism row',
    recencyWindowDays: REC_90D,
    trigger: (s) => isTrue(s, 'comorbidity.thyroid'),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.tft', label: 'TFT' }),
    reason: () => 'Thyroid disease — TFT required, recency 90 days (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.hypothyroid.physician_review',
    version: 1,
    layer: 2,
    severity: 'recommended',
    routesTo: 'clearance',
    sopReference: '§6.3 Hypothyroidism row',
    trigger: (s) =>
      isTrue(s, 'comorbidity.thyroid') && valueGt(s, 'lab.tsh.value', 5),
    payload: () => ({ kind: 'clearance', specialty: 'physician', label: 'Physician review for TSH optimisation' }),
    reason: () => 'TSH > 5 — physician review for optimisation recommended (SOP §6.3).',
  }),
];

// =============================================================================
// Obesity (6 rules)
// =============================================================================

const OBESITY: PacRule[] = [
  defineRule({
    id: 'sop.6.3.obesity.airway_assessment',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.3 Obesity row',
    trigger: (s) =>
      valueGt(s, 'vital.bmi.value', 30) || isTrue(s, 'comorbidity.obesity'),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.airway_assessment',
      label: 'Airway assessment (Mallampati, neck circumference) at PAC visit',
    }),
    reason: () => 'BMI > 30 or known obesity — airway assessment required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.obesity.osa_screening',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Obesity row',
    trigger: (s) => valueGt(s, 'vital.bmi.value', 35),
    payload: () => ({ kind: 'clearance', specialty: 'pulmonology', label: 'OSA screening (pulmonology referral if positive)' }),
    reason: () => 'BMI > 35 — OSA screening required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.obesity.positioning_plan',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.3 Obesity row',
    trigger: (s) => valueGt(s, 'vital.bmi.value', 35),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.positioning',
      label: 'Positioning plan documented',
    }),
    reason: () => 'BMI > 35 — positioning plan required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.obesity.bmi_30_asa2',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'asa_review',
    sopReference: '§6.3 Obesity row',
    trigger: (s) => valueGt(s, 'vital.bmi.value', 30),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 2,
      reasonText: 'BMI > 30 — ASA 2 minimum.',
    }),
    reason: () => 'BMI > 30 — ASA 2 minimum per SOP §6.3.',
  }),
  defineRule({
    id: 'sop.6.3.obesity.bmi_35_osa_asa3',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'asa_review',
    sopReference: '§6.3 Obesity row',
    trigger: (s) =>
      valueGt(s, 'vital.bmi.value', 35) && isTrue(s, 'comorbidity.osa'),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'BMI > 35 + OSA — ASA 3.',
    }),
    reason: () => 'BMI > 35 with confirmed OSA — ASA 3 per SOP §6.3.',
  }),
  defineRule({
    id: 'sop.6.3.obesity.glp1_npo',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.4 NPO + §6.3 Obesity row',
    trigger: (s) => regexMatch(s, 'medication.notes', GLP1_REGEX),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.npo_glp1',
      label: 'NPO 8–10 hours (GLP-1 agonist user)',
    }),
    reason: () => 'GLP-1 agonist in current medication — NPO 8–10 hours per §6.4.',
  }),
];

// =============================================================================
// Anaemia (4 rules)
// =============================================================================

const ANAEMIA: PacRule[] = [
  defineRule({
    id: 'sop.6.3.anaemia.iron_studies',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Anaemia row',
    trigger: (s) =>
      isTrue(s, 'comorbidity.anaemia') || valueLt(s, 'lab.hb.value', 10),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.iron_studies', label: 'Iron studies' }),
    reason: (s) =>
      valueLt(s, 'lab.hb.value', 10)
        ? `Hb < 10 g/dL — iron studies required (SOP §6.3).`
        : 'Anaemia flagged — iron studies required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anaemia.identify_cause',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Anaemia row',
    trigger: (s) => isTrue(s, 'comorbidity.anaemia'),
    payload: () => ({ kind: 'clearance', specialty: 'physician', label: 'Physician consultation: identify cause' }),
    reason: () => 'Anaemia flagged — physician consultation to identify cause (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anaemia.hb_8_defer',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: '§6.3 Anaemia row',
    trigger: (s) => valueLt(s, 'lab.hb.value', 8),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'Hb < 8 g/dL — ASA 3, defer elective; optimise / transfuse.',
    }),
    reason: () => 'Hb < 8 g/dL — ASA 3 review and elective deferral (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anaemia.hb_7_transfuse',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.3 Anaemia row',
    trigger: (s) => valueLt(s, 'lab.hb.value', 7),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.transfuse',
      label: 'Transfuse before proceeding',
    }),
    reason: () => 'Hb < 7 g/dL — transfuse before proceeding (SOP §6.3).',
  }),
];

// =============================================================================
// Respiratory disease (Asthma / COPD / OSA) (6 rules)
// =============================================================================

const RESPIRATORY: PacRule[] = [
  defineRule({
    id: 'sop.6.3.respiratory.pulmonology_consult',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Respiratory row',
    trigger: (s) =>
      isTrue(s, 'comorbidity.respiratory_disease') &&
      inSet(s, 'comorbidity_control._global', ['no', 'unknown']),
    payload: () => ({ kind: 'clearance', specialty: 'pulmonology', label: 'Pulmonology referral' }),
    reason: () => 'Respiratory disease with unclear/poor control — pulmonology referral required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.respiratory.abg_asa3',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Respiratory row',
    trigger: (s) =>
      isTrue(s, 'comorbidity.respiratory_disease') && s.asaGrade === 3,
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.abg', label: 'ABG' }),
    reason: () => 'Respiratory disease + ASA 3 — ABG required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.respiratory.ct_thorax',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Respiratory row',
    trigger: (s) =>
      isTrue(s, 'comorbidity.respiratory_disease') &&
      (isTrue(s, 'history.recent_pneumonia') ||
        isTrue(s, 'vital.wheeze_active')),
    payload: () => ({ kind: 'diagnostic', orderType: 'imaging.ct_thorax_plain', label: 'CT Thorax (plain)' }),
    reason: (s) =>
      isTrue(s, 'history.recent_pneumonia')
        ? 'Respiratory disease + recent pneumonia — CT thorax required (SOP §6.3).'
        : 'Respiratory disease + active wheeze — CT thorax required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.respiratory.spo2_94_flag',
    version: 1,
    layer: 2,
    severity: 'recommended',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Respiratory row',
    trigger: (s) => valueLt(s, 'vital.spo2.value', 94),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'plan.further_respiratory_invest',
      label: 'Further respiratory investigation',
    }),
    reason: () => 'SpO₂ < 94% — further respiratory investigation recommended (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.respiratory.spo2_90_abg',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Respiratory row',
    trigger: (s) => valueLt(s, 'vital.spo2.value', 90),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.abg', label: 'ABG (urgent)' }),
    reason: () => 'SpO₂ < 90% — ABG MANDATORY; consider deferral (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.respiratory.active_wheeze_asa3',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'asa_review',
    sopReference: '§6.3 Respiratory row',
    trigger: (s) =>
      isTrue(s, 'vital.wheeze_active') || isTrue(s, 'vital.urti_active'),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'Active wheeze / URTI — ASA 3, may defer.',
    }),
    reason: () => 'Active wheeze or URTI — ASA 3 review (SOP §6.3).',
  }),
];

// =============================================================================
// Active infection / fever > 38°C (6 rules)
// =============================================================================

const INFECTION: PacRule[] = [
  defineRule({
    id: 'sop.6.3.infection.source_identification',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Infection row',
    trigger: (s) =>
      valueGt(s, 'vital.temperature_c.value', 38) ||
      isTrue(s, 'comorbidity.infection_active'),
    payload: () => ({ kind: 'clearance', specialty: 'physician', label: 'Source identification (clinician)' }),
    reason: () => 'Active infection or fever > 38°C — source identification required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.infection.cultures',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Infection row',
    trigger: (s) =>
      valueGt(s, 'vital.temperature_c.value', 38) ||
      isTrue(s, 'comorbidity.infection_active'),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.cultures', label: 'Blood cultures + appropriate samples' }),
    reason: () => 'Active infection or fever > 38°C — cultures required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.infection.antibiotic_plan',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.3 Infection row',
    trigger: (s) =>
      valueGt(s, 'vital.temperature_c.value', 38) ||
      isTrue(s, 'comorbidity.infection_active'),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.antibiotic',
      label: 'Antibiotic plan documented',
    }),
    reason: () => 'Active infection — antibiotic plan required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.infection.recent_resolved_asa2',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'asa_review',
    sopReference: '§6.3 Infection row',
    trigger: (s) => isTrue(s, 'history.recent_fever_resolved_within_week'),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 2,
      reasonText: 'Recent fever (resolved > 1 week ago) — ASA 2.',
    }),
    reason: () => 'Recent resolved fever — ASA 2 review (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.infection.ongoing_asa3_defer',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: '§6.3 Infection row',
    trigger: (s) => isTrue(s, 'vital.fever_ongoing'),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'Ongoing fever — ASA 3, may defer.',
    }),
    reason: () => 'Ongoing fever — ASA 3 review (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.infection.elective_defer_48h',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: '§6.3 Infection row',
    trigger: (s) =>
      inSet(s, 'surgery.urgency', ['elective']) && isTrue(s, 'vital.fever_ongoing'),
    payload: () => ({
      kind: 'info_only',
      message: 'Elective surgery: defer until afebrile for 48 hours (SOP §6.3).',
    }),
    reason: () => 'Elective surgery + ongoing fever — defer 48h (SOP §6.3).',
  }),
];

// =============================================================================
// Anticoagulant / Antiplatelet therapy (6 rules)
// =============================================================================

const ANTICOAG: PacRule[] = [
  defineRule({
    id: 'sop.6.3.anticoag.haematology_guidance',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Anticoagulant row',
    trigger: (s) => regexMatch(s, 'medication.notes', ANTICOAG_REGEX),
    payload: () => ({
      kind: 'clearance',
      specialty: 'haematology',
      label: 'Haematology / Physician guidance on bridging/cessation',
    }),
    reason: () => 'Anticoagulant / antiplatelet therapy detected — haematology guidance required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anticoag.inr_documented',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Anticoagulant row',
    trigger: (s) => regexMatch(s, 'medication.notes', ANTICOAG_REGEX),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.inr_pt', label: 'INR / PT' }),
    reason: () => 'Anticoagulant therapy — INR/PT documentation required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anticoag.neuraxial_safety',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Anticoagulant row',
    trigger: (s) =>
      regexMatch(s, 'medication.notes', ANTICOAG_REGEX) &&
      isTrue(s, 'surgery.requires_neuraxial'),
    payload: () => ({
      kind: 'clearance',
      specialty: 'anaesthesia',
      label: 'Neuraxial safety assessment',
    }),
    reason: () => 'Anticoagulant + neuraxial planned — anaesthetist safety assessment required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anticoag.inr_1_5_major_defer',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: '§6.3 Anticoagulant row',
    trigger: (s) =>
      valueGt(s, 'lab.inr.value', 1.5) && isTrue(s, 'surgery.is_major'),
    payload: () => ({
      kind: 'info_only',
      message: 'INR > 1.5 + major surgery — defer (SOP §6.3).',
    }),
    reason: () => 'INR > 1.5 + major surgery — defer (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anticoag.inr_1_4_neuraxial_defer',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: '§6.3 Anticoagulant row',
    trigger: (s) =>
      valueGt(s, 'lab.inr.value', 1.4) &&
      isTrue(s, 'surgery.requires_neuraxial'),
    payload: () => ({
      kind: 'info_only',
      message: 'INR > 1.4 + neuraxial planned — defer neuraxial (SOP §6.3).',
    }),
    reason: () => 'INR > 1.4 + neuraxial planned — defer (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.anticoag.not_stopped_asa3',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: '§6.3 Anticoagulant row',
    trigger: (s) =>
      regexMatch(s, 'medication.notes', /anticoagulant/i) &&
      s.facts['habit_stopped.anticoagulant']?.value === false,
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'Anticoagulant not stopped — ASA 3, defer until compliant.',
    }),
    reason: () => 'Anticoagulant not stopped per protocol — ASA 3 review (SOP §6.3).',
  }),
];

// =============================================================================
// Smoking / Alcohol (3 rules)
// =============================================================================

const SMOKING: PacRule[] = [
  defineRule({
    id: 'sop.6.3.smoking.cessation_status',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.3 Smoking / Alcohol row',
    trigger: (s) => hasAnyHabit(s),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.cessation_counsel',
      label: 'Document cessation status; counsel on perioperative risk',
    }),
    reason: () => 'Habits flagged — document cessation status and counsel (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.smoking.stopped_3d_asa2',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'asa_review',
    sopReference: '§6.3 Smoking / Alcohol row',
    trigger: (s) =>
      hasAnyHabit(s) && inSet(s, 'habit_stopped._global', ['yes']),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 2,
      reasonText: 'Cessation ≥ 3 days — ASA 2.',
    }),
    reason: () => 'Habits stopped 3+ days — ASA 2 review (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.smoking.not_stopped_asa3',
    version: 1,
    layer: 2,
    severity: 'info',
    routesTo: 'asa_review',
    sopReference: '§6.3 Smoking / Alcohol row',
    trigger: (s) =>
      hasAnyHabit(s) && inSet(s, 'habit_stopped._global', ['no']),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'Habits not stopped — ASA 3.',
    }),
    reason: () => 'Habits not stopped — ASA 3 review (SOP §6.3).',
  }),
];

// =============================================================================
// Coagulopathy (5 rules)
// =============================================================================

const COAGULOPATHY: PacRule[] = [
  defineRule({
    id: 'sop.6.3.coag.haematology_consult',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.3 Coagulopathy row',
    trigger: (s) => isTrue(s, 'comorbidity.coagulopathy'),
    payload: () => ({ kind: 'clearance', specialty: 'haematology', label: 'Haematology referral' }),
    reason: () => 'Coagulopathy flagged — haematology referral required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.coag.detailed_workup',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.3 Coagulopathy row',
    trigger: (s) => isTrue(s, 'comorbidity.coagulopathy'),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.coag_workup', label: 'Detailed coagulation workup' }),
    reason: () => 'Coagulopathy flagged — detailed coag workup required (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.coag.factor_replacement_plan',
    version: 1,
    layer: 2,
    severity: 'recommended',
    routesTo: 'order',
    sopReference: '§6.3 Coagulopathy row',
    trigger: (s) => isTrue(s, 'comorbidity.coagulopathy'),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.factor_replacement',
      label: 'Factor replacement plan (if needed)',
    }),
    reason: () => 'Coagulopathy flagged — factor replacement plan recommended (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.coag.platelets_50_major_defer',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: '§6.3 Coagulopathy row',
    trigger: (s) => valueLt(s, 'lab.platelets.value', 50),
    payload: () => ({
      kind: 'info_only',
      message: 'Platelets < 50 × 10⁹/L — defer major surgery; transfuse (SOP §6.3).',
    }),
    reason: () => 'Platelets < 50 — defer major surgery; transfuse (SOP §6.3).',
  }),
  defineRule({
    id: 'sop.6.3.coag.platelets_80_epidural_defer',
    version: 1,
    layer: 2,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: '§6.3 Coagulopathy row',
    trigger: (s) =>
      valueLt(s, 'lab.platelets.value', 80) &&
      isTrue(s, 'surgery.requires_epidural'),
    payload: () => ({
      kind: 'info_only',
      message: 'Platelets < 80 × 10⁹/L + epidural planned — defer epidural (SOP §6.3).',
    }),
    reason: () => 'Platelets < 80 + epidural planned — defer (SOP §6.3).',
  }),
];

// =============================================================================
// Aggregate
// =============================================================================

export const LAYER2_RULES: PacRule[] = [
  ...DIABETES,
  ...HYPERTENSION,
  ...CARDIAC,
  ...RENAL,
  ...HYPOTHYROID,
  ...OBESITY,
  ...ANAEMIA,
  ...RESPIRATORY,
  ...INFECTION,
  ...ANTICOAG,
  ...SMOKING,
  ...COAGULOPATHY,
];

export {
  DIABETES,
  HYPERTENSION,
  CARDIAC,
  RENAL,
  HYPOTHYROID,
  OBESITY,
  ANAEMIA,
  RESPIRATORY,
  INFECTION,
  ANTICOAG,
  SMOKING,
  COAGULOPATHY,
};
