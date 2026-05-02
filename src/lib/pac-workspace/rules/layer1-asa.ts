// =============================================================================
// PAC Workspace v2 — Layer 1 ASA + anaesthesia baseline (PCW2.2a)
//
// PRD §6.1. These rules require BOTH `asa_grade` AND `surgery.anaesthesia_type`
// to be known. Inheritance pattern collapsed into single rules per test —
// e.g., one `cbc` rule fires for ASA 1, 2, 3 with any anaesthesia type
// rather than separate per-ASA rule_ids. Matches PRD §15.1's "11 REQUIRED
// diagnostic suggestions for an ASA 2 patient" expectation.
//
// CXR is the only test with anaesthesia-type sensitivity (ASA 1 + GA only;
// ASA 2-3 always). Cardiology consult + dobutamine stress are conditional
// on ECG/echo abnormality (and is_major for the ASA 3 dobutamine case).
// =============================================================================

import { defineRule } from '../engine-types';
import type { PacRule } from '../engine-types';
import {
  getAnaesthesiaCategory,
  isTrue,
  layer1Eligible,
} from '../fact-helpers';

const REC_180D = 180;

/** Reusable trigger: in-bounds ASA (1-3) AND anaesthesia known. */
function asaInBaseline(grade: 1 | 2 | 3 | 4 | 5 | null): grade is 1 | 2 | 3 {
  return grade === 1 || grade === 2 || grade === 3;
}

export const LAYER1_RULES: PacRule[] = [
  // ─────────────────────────────────────────────────────────────────────
  // Baseline diagnostics (CBC, RFT, TSH, Glucose, Coag, Serology, ECG)
  // Fire for ASA 1-3, any anaesthesia type.
  // ─────────────────────────────────────────────────────────────────────
  defineRule({
    id: 'sop.6.2.layer1.cbc',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1–3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => layer1Eligible(s) && asaInBaseline(s.asaGrade),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.cbc', label: 'CBC' }),
    reason: () =>
      'Required baseline lab for any pre-operative case (SOP §6.2 ASA 1–3 baseline).',
  }),
  defineRule({
    id: 'sop.6.2.layer1.rft',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1–3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => layer1Eligible(s) && asaInBaseline(s.asaGrade),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.rft', label: 'RFT' }),
    reason: () => 'Required baseline lab (SOP §6.2 ASA 1–3 baseline).',
  }),
  defineRule({
    id: 'sop.6.2.layer1.tsh',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1–3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => layer1Eligible(s) && asaInBaseline(s.asaGrade),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.tsh', label: 'TSH' }),
    reason: () => 'Required baseline lab (SOP §6.2 ASA 1–3 baseline).',
  }),
  defineRule({
    id: 'sop.6.2.layer1.glucose',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1–3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => layer1Eligible(s) && asaInBaseline(s.asaGrade),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'lab.glucose',
      label: 'RBS / HbA1c',
    }),
    reason: () =>
      'Required baseline glucose screen — RBS or HbA1c (SOP §6.2 ASA 1–3 baseline).',
  }),
  defineRule({
    id: 'sop.6.2.layer1.coag',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1–3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => layer1Eligible(s) && asaInBaseline(s.asaGrade),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'lab.coag',
      label: 'PT / aPTT / INR',
    }),
    reason: () =>
      'Required coagulation panel (SOP §6.2 ASA 1–3 baseline).',
  }),
  defineRule({
    id: 'sop.6.2.layer1.serology',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1–3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => layer1Eligible(s) && asaInBaseline(s.asaGrade),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'lab.serology',
      label: 'Serology (HBsAg, anti-HCV, HIV)',
    }),
    reason: () =>
      'Required serology panel (SOP §6.2 ASA 1–3 baseline).',
  }),
  defineRule({
    id: 'sop.6.2.layer1.ecg',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1–3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => layer1Eligible(s) && asaInBaseline(s.asaGrade),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'imaging.ecg',
      label: 'ECG',
    }),
    reason: () => 'Required ECG (SOP §6.2 ASA 1–3 baseline).',
  }),

  // ─────────────────────────────────────────────────────────────────────
  // CXR — anaesthesia-type sensitive.
  //   ASA 1: only when general anaesthesia.
  //   ASA 2-3: always (any anaesthesia type).
  // ─────────────────────────────────────────────────────────────────────
  defineRule({
    id: 'sop.6.2.layer1.cxr',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 1 GA / ASA 2-3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) => {
      if (!layer1Eligible(s)) return false;
      const cat = getAnaesthesiaCategory(s);
      if (s.asaGrade === 1) return cat === 'general';
      return s.asaGrade === 2 || s.asaGrade === 3;
    },
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'imaging.cxr',
      label: 'Chest X-Ray (PA view)',
    }),
    reason: (s) => {
      if (s.asaGrade === 1) {
        return 'Required for ASA 1 under general anaesthesia (SOP §6.2).';
      }
      return `Required ASA ${s.asaGrade} baseline (SOP §6.2).`;
    },
  }),

  // ─────────────────────────────────────────────────────────────────────
  // ASA 2 additions (Lipid, Urine R/M, 2D Echo) — also fire for ASA 3.
  // ─────────────────────────────────────────────────────────────────────
  defineRule({
    id: 'sop.6.2.asa2.lipid',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 2 / ASA 3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) =>
      layer1Eligible(s) && (s.asaGrade === 2 || s.asaGrade === 3),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'lab.lipid',
      label: 'Lipid profile',
    }),
    reason: () => 'Required for ASA 2+ baseline (SOP §6.2).',
  }),
  defineRule({
    id: 'sop.6.2.asa2.urine_rm',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 2 / ASA 3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) =>
      layer1Eligible(s) && (s.asaGrade === 2 || s.asaGrade === 3),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'lab.urine_rm',
      label: 'Urine R/M',
    }),
    reason: () => 'Required for ASA 2+ baseline (SOP §6.2).',
  }),
  defineRule({
    id: 'sop.6.2.asa2.echo',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 2 / ASA 3 baseline',
    recencyWindowDays: REC_180D,
    trigger: (s) =>
      layer1Eligible(s) && (s.asaGrade === 2 || s.asaGrade === 3),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'imaging.echo',
      label: '2D ECHO',
    }),
    reason: () =>
      'Required for ASA 2+ baseline; recency 180 days (SOP §6.2).',
  }),

  // ─────────────────────────────────────────────────────────────────────
  // ASA 2 / ASA 3 conditional — ECG/echo abnormality drives extra workup.
  // ─────────────────────────────────────────────────────────────────────
  defineRule({
    id: 'sop.6.2.layer1.cardiology_consult',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: '§6.2 ASA 2 / ASA 3 conditional',
    trigger: (s) =>
      layer1Eligible(s) &&
      (s.asaGrade === 2 || s.asaGrade === 3) &&
      (isTrue(s, 'imaging.ecg.abnormality') ||
        isTrue(s, 'imaging.echo.abnormality')),
    payload: () => ({
      kind: 'clearance',
      specialty: 'cardiology',
      label: 'Cardiology consultation',
    }),
    reason: (s) => {
      const ecgAbn = isTrue(s, 'imaging.ecg.abnormality');
      const echoAbn = isTrue(s, 'imaging.echo.abnormality');
      const what =
        ecgAbn && echoAbn
          ? 'ECG and 2D Echo'
          : ecgAbn
            ? 'ECG'
            : '2D Echo';
      return `${what} abnormality flagged — cardiology clearance required (SOP §6.2 conditional).`;
    },
  }),
  defineRule({
    id: 'sop.6.2.layer1.dobutamine_stress',
    version: 1,
    layer: 1,
    severity: 'recommended',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 2-3 conditional / ASA 3 major-surgery',
    trigger: (s) => {
      if (!layer1Eligible(s)) return false;
      const ecgOrEchoAbn =
        isTrue(s, 'imaging.ecg.abnormality') ||
        isTrue(s, 'imaging.echo.abnormality');
      if (s.asaGrade === 2) return ecgOrEchoAbn;
      if (s.asaGrade === 3) {
        return ecgOrEchoAbn || isTrue(s, 'surgery.is_major');
      }
      return false;
    },
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'imaging.dobutamine_stress_echo',
      label: 'Dobutamine stress echo',
    }),
    reason: (s) => {
      if (
        s.asaGrade === 3 &&
        isTrue(s, 'surgery.is_major') &&
        !isTrue(s, 'imaging.ecg.abnormality') &&
        !isTrue(s, 'imaging.echo.abnormality')
      ) {
        return 'ASA 3 major surgery — stress test recommended (SOP §6.2).';
      }
      return 'ECG / echo abnormality plus elevated ASA — stress test recommended (SOP §6.2).';
    },
  }),

  // ─────────────────────────────────────────────────────────────────────
  // ASA 3 additions (ABG) + ASA 3 conditional CT thorax.
  // ─────────────────────────────────────────────────────────────────────
  defineRule({
    id: 'sop.6.2.asa3.abg',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 3 baseline',
    trigger: (s) => layer1Eligible(s) && s.asaGrade === 3,
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'lab.abg',
      label: 'ABG',
    }),
    reason: () => 'Required for ASA 3 baseline (SOP §6.2).',
  }),
  defineRule({
    id: 'sop.6.2.asa3.ct_thorax',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§6.2 ASA 3 conditional',
    trigger: (s) =>
      layer1Eligible(s) &&
      s.asaGrade === 3 &&
      isTrue(s, 'comorbidity.respiratory_disease') &&
      (isTrue(s, 'history.recent_pneumonia') ||
        isTrue(s, 'vital.wheeze_active')),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'imaging.ct_thorax_plain',
      label: 'CT Thorax (plain)',
    }),
    reason: (s) => {
      const why = isTrue(s, 'history.recent_pneumonia')
        ? 'recent pneumonia'
        : 'active wheeze';
      return `Respiratory disease + ${why} on ASA 3 — CT thorax required (SOP §6.2).`;
    },
  }),

  // ─────────────────────────────────────────────────────────────────────
  // ASA 4/5 — direct ICU. Single INFO rule blocks workspace order auto-
  // populate; ICU team handles workup.
  // ─────────────────────────────────────────────────────────────────────
  defineRule({
    id: 'sop.6.2.asa4_5.direct_icu',
    version: 1,
    layer: 1,
    severity: 'info',
    routesTo: 'info_only',
    sopReference: '§6.2 ASA 4 / ASA 5 — direct ICU',
    trigger: (s) => s.asaGrade === 4 || s.asaGrade === 5,
    payload: (s) => ({
      kind: 'info_only',
      message: `ASA ${s.asaGrade} — patient requires direct ICU admission per §6.2. Workspace orders not auto-populated; ICU team handles workup.`,
    }),
    reason: (s) =>
      `ASA ${s.asaGrade} short-circuits to ICU per SOP §6.2. No baseline workup is auto-suggested.`,
  }),
];
