// =============================================================================
// PAC Workspace v2 — Layer 3 results + NPO + Transfer + Pre-op checklist
// (PCW2.2c)
//
// PRD §6.3 (Appendix A result-driven, 19 rules), §6.4 NPO (5), §6.5 Transfer
// (3), §6.6 Pre-op verification checklist (10) = 37 rules.
//
// Layer 3 rules fire AFTER a result is entered (PCW2.5 result-entry modal
// triggers re-evaluation). Until then, lab.* / vital.* / score.* / history.*
// facts are absent and these rules sit dormant per Q3 conservative lock.
//
// NPO and Transfer rules gate on `surgery.is_surgical_case=true` (otherwise
// non-surgical patients would see pointless suggestions).
//
// Pre-op checklist routes_to='order' for v1; PCW2.3 persistence layer
// special-cases orderType='checklist.*' to write into
// pac_workspace_progress.checklist_state instead of pac_orders.
// =============================================================================

import { defineRule } from '../engine-types';
import type { PacRule } from '../engine-types';
import {
  inSet,
  isTrue,
  regexMatch,
  valueGt,
  valueLt,
} from '../fact-helpers';

// =============================================================================
// Layer 3 — Result-driven flags (Appendix A — 19 rules)
// =============================================================================

const LAYER3: PacRule[] = [
  defineRule({
    id: 'appx.bp.180_110_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — BP cutoff (AAGBI 2016, ESC/ESA 2022)',
    trigger: (s) =>
      valueGt(s, 'lab.bp_systolic.value', 180) ||
      valueGt(s, 'lab.bp_diastolic.value', 110),
    payload: () => ({
      kind: 'info_only',
      message: 'BP > 180/110 — defer elective surgery (AAGBI 2016, ESC/ESA 2022).',
    }),
    reason: () => 'BP exceeds 180/110 — defer per Appx A.',
  }),
  defineRule({
    id: 'appx.bp.160_100_target',
    version: 1,
    layer: 3,
    severity: 'info',
    routesTo: 'info_only',
    sopReference: 'Appx A — BP target reached',
    trigger: (s) =>
      valueLt(s, 'lab.bp_systolic.value', 160) &&
      valueLt(s, 'lab.bp_diastolic.value', 100),
    payload: () => ({
      kind: 'info_only',
      message: 'BP target met before listing (< 160/100).',
    }),
    reason: () => 'BP target met per Appx A.',
  }),
  defineRule({
    id: 'appx.hba1c.8_5_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: 'Appx A — HbA1c (JBDS 2015, AAGBI 2015, CPOC 2022)',
    trigger: (s) => valueGt(s, 'lab.hba1c.value', 8.5),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'HbA1c > 8.5% — defer elective; optimise (Appx A).',
    }),
    reason: () => 'HbA1c > 8.5% exceeds optimisation threshold (Appx A).',
  }),
  defineRule({
    id: 'appx.glucose.periop_range',
    version: 1,
    layer: 3,
    severity: 'recommended',
    routesTo: 'order',
    sopReference: 'Appx A — perioperative glucose range',
    trigger: (s) =>
      valueLt(s, 'lab.rbs.value', 6) || valueGt(s, 'lab.rbs.value', 10),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.insulin_adjust',
      label: 'Adjust insulin / sliding scale',
    }),
    reason: () => 'Perioperative glucose outside 6–10 mmol/L target (Appx A).',
  }),
  defineRule({
    id: 'appx.glucose.day_of_vriii',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'order',
    sopReference: 'Appx A — VRIII threshold (CPOC 2022)',
    trigger: (s) => valueGt(s, 'lab.rbs.value', 12),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.vriii',
      label: 'Initiate VRIII; escalate (CPOC 2022)',
    }),
    reason: () => 'RBS > 12 mmol/L (~216 mg/dL) — initiate VRIII (Appx A).',
  }),
  defineRule({
    id: 'appx.spo2.94_invest',
    version: 1,
    layer: 3,
    severity: 'recommended',
    routesTo: 'diagnostic',
    sopReference: 'Appx A — SpO2 < 94 (BTS 2017)',
    trigger: (s) => valueLt(s, 'vital.spo2.value', 94),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'plan.further_respiratory_invest',
      label: 'Further respiratory investigation',
    }),
    reason: () => 'SpO₂ < 94% — further investigation (Appx A, BTS 2017).',
  }),
  defineRule({
    id: 'appx.spo2.90_abg',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: 'Appx A — SpO2 < 90 (ESAIC, BTS)',
    trigger: (s) => valueLt(s, 'vital.spo2.value', 90),
    payload: () => ({ kind: 'diagnostic', orderType: 'lab.abg', label: 'ABG (urgent)' }),
    reason: () => 'SpO₂ < 90% — ABG MANDATORY; consider deferral (Appx A).',
  }),
  defineRule({
    id: 'appx.inr.1_5_major_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — INR > 1.5 + major',
    trigger: (s) =>
      valueGt(s, 'lab.inr.value', 1.5) && isTrue(s, 'surgery.is_major'),
    payload: () => ({
      kind: 'info_only',
      message: 'INR > 1.5 + major surgery — defer (Appx A).',
    }),
    reason: () => 'INR > 1.5 + major surgery — defer per Appx A.',
  }),
  defineRule({
    id: 'appx.inr.1_4_neuraxial_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — INR > 1.4 + neuraxial (ASRA)',
    trigger: (s) =>
      valueGt(s, 'lab.inr.value', 1.4) &&
      isTrue(s, 'surgery.requires_neuraxial'),
    payload: () => ({
      kind: 'info_only',
      message: 'INR > 1.4 + neuraxial planned — defer neuraxial (ASRA).',
    }),
    reason: () => 'INR > 1.4 + neuraxial planned — defer per Appx A (ASRA).',
  }),
  defineRule({
    id: 'appx.platelets.50_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — platelets < 50 (BSH 2017, AABB)',
    trigger: (s) => valueLt(s, 'lab.platelets.value', 50),
    payload: () => ({
      kind: 'info_only',
      message: 'Platelets < 50 × 10⁹/L — defer major; transfuse (Appx A).',
    }),
    reason: () => 'Platelets < 50 × 10⁹/L — defer per Appx A.',
  }),
  defineRule({
    id: 'appx.platelets.80_epidural_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — platelets < 80 + epidural (BSH 2017)',
    trigger: (s) =>
      valueLt(s, 'lab.platelets.value', 80) &&
      isTrue(s, 'surgery.requires_epidural'),
    payload: () => ({
      kind: 'info_only',
      message: 'Platelets < 80 × 10⁹/L + epidural planned — defer epidural (Appx A).',
    }),
    reason: () => 'Platelets < 80 × 10⁹/L + epidural — defer per Appx A.',
  }),
  defineRule({
    id: 'appx.hb.8_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'asa_review',
    sopReference: 'Appx A — Hb < 8',
    trigger: (s) => valueLt(s, 'lab.hb.value', 8),
    payload: () => ({
      kind: 'asa_review',
      suggestedGrade: 3,
      reasonText: 'Hb < 8 g/dL — ASA 3, defer elective; optimise / transfuse.',
    }),
    reason: () => 'Hb < 8 g/dL — defer + optimise (Appx A).',
  }),
  defineRule({
    id: 'appx.egfr.30_nephro',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'clearance',
    sopReference: 'Appx A — eGFR < 30 (NICE NG203, KDIGO)',
    trigger: (s) => valueLt(s, 'lab.egfr.value', 30),
    payload: () => ({
      kind: 'clearance',
      specialty: 'nephrology',
      label: 'Mandatory nephrology referral',
    }),
    reason: () => 'eGFR < 30 — mandatory nephrology referral (Appx A).',
  }),
  defineRule({
    id: 'appx.egfr.60_flag',
    version: 1,
    layer: 3,
    severity: 'info',
    routesTo: 'info_only',
    sopReference: 'Appx A — eGFR < 60',
    trigger: (s) => valueLt(s, 'lab.egfr.value', 60),
    payload: () => ({
      kind: 'info_only',
      message: 'eGFR < 60 — flag increased perioperative risk.',
    }),
    reason: () => 'eGFR < 60 — flag increased perioperative risk (Appx A).',
  }),
  defineRule({
    id: 'appx.k.6_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — K+ > 6 (Lema et al. 2019)',
    trigger: (s) => valueGt(s, 'lab.potassium.value', 6),
    payload: () => ({
      kind: 'info_only',
      message: 'K⁺ > 6.0 mmol/L — defer elective surgery (Appx A).',
    }),
    reason: () => 'K⁺ > 6.0 mmol/L — defer (Appx A).',
  }),
  defineRule({
    id: 'appx.k.3_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — K+ < 3',
    trigger: (s) => valueLt(s, 'lab.potassium.value', 3),
    payload: () => ({
      kind: 'info_only',
      message: 'K⁺ < 3.0 mmol/L — defer elective surgery (Appx A).',
    }),
    reason: () => 'K⁺ < 3.0 mmol/L — defer (Appx A).',
  }),
  defineRule({
    id: 'appx.dasi.34_cardiac_risk',
    version: 1,
    layer: 3,
    severity: 'recommended',
    routesTo: 'diagnostic',
    sopReference: 'Appx A — DASI < 34 (ESC/ESA 2022)',
    trigger: (s) => valueLt(s, 'score.dasi.value', 34),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'imaging.stress_test',
      label: 'Cardiac stress testing',
    }),
    reason: () => 'DASI < 34 — increased cardiac risk; consider stress testing (Appx A).',
  }),
  defineRule({
    id: 'appx.pci.6mo_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — PCI within 6 months (ESC/ESA 2022)',
    trigger: (s) =>
      isTrue(s, 'history.pci_within_6_months') &&
      inSet(s, 'surgery.urgency', ['elective']),
    payload: () => ({
      kind: 'info_only',
      message: 'PCI within 6 months + elective surgery — defer (Appx A, ESC/ESA 2022).',
    }),
    reason: () => 'PCI within 6 months — defer elective non-cardiac surgery.',
  }),
  defineRule({
    id: 'appx.acs.12mo_defer',
    version: 1,
    layer: 3,
    severity: 'required',
    routesTo: 'info_only',
    sopReference: 'Appx A — ACS within 12 months (ESC/ESA 2022)',
    trigger: (s) =>
      isTrue(s, 'history.acs_within_12_months') &&
      inSet(s, 'surgery.urgency', ['elective']),
    payload: () => ({
      kind: 'info_only',
      message: 'ACS within 12 months + elective surgery — defer (Appx A, ESC/ESA 2022).',
    }),
    reason: () => 'ACS within 12 months — defer elective non-cardiac surgery.',
  }),
];

// =============================================================================
// §6.4 NPO + day-of orders (5 rules)
// =============================================================================

const NPO: PacRule[] = [
  defineRule({
    id: 'sop.6.4.npo.fatty_meals',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.4 NPO — fatty meals',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.npo_fatty',
      label: 'Fatty meals: 8–10 hours NPO before surgery',
    }),
    reason: () => 'NPO 8–10 hours for fatty meals (SOP §6.4).',
  }),
  defineRule({
    id: 'sop.6.4.npo.glp1_users',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.4 NPO — GLP-1 users',
    trigger: (s) =>
      regexMatch(s, 'medication.notes', /(GLP-1|ozempic|mounjaro|semaglutide|tirzepatide)/i),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.npo_glp1',
      label: 'GLP-1 user: 8–10 hours NPO regardless of meal type',
    }),
    reason: () => 'GLP-1 agonist user — 8–10 hours NPO (SOP §6.4).',
  }),
  defineRule({
    id: 'sop.6.4.npo.light_meals',
    version: 1,
    layer: 1,
    severity: 'info',
    routesTo: 'order',
    sopReference: '§6.4 NPO — light meals',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.npo_light',
      label: 'Light meals / coffee / milk / tea / pulpy juices: 6 hours',
    }),
    reason: () => 'NPO 6 hours for light meals (SOP §6.4).',
  }),
  defineRule({
    id: 'sop.6.4.npo.water',
    version: 1,
    layer: 1,
    severity: 'info',
    routesTo: 'order',
    sopReference: '§6.4 NPO — water',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.npo_water',
      label: 'Water / tender coconut water: 3 hours',
    }),
    reason: () => 'NPO 3 hours for clear fluids (SOP §6.4).',
  }),
  defineRule({
    id: 'sop.6.4.npo.emergency',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§6.4 NPO — emergency / urgent',
    trigger: (s) => inSet(s, 'surgery.urgency', ['urgent', 'emergency']),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.emergency_aspiration_protocol',
      label: 'Aspiration risk acknowledged; ventilator readiness confirmed',
    }),
    reason: () =>
      'Emergency / urgent — proceed under aspiration risk; document acknowledgment + ventilator readiness (SOP §6.4).',
  }),
];

// =============================================================================
// §6.5 Transfer protocol (3 rules)
// =============================================================================

const TRANSFER: PacRule[] = [
  defineRule({
    id: 'sop.7.transfer.blood_group_reverify',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'diagnostic',
    sopReference: '§7 Transfer — independent blood group',
    trigger: (s) => isTrue(s, 'surgery.is_transfer_patient'),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'lab.blood_group_reverify',
      label: 'INDEPENDENT blood group verification at EHRC',
    }),
    reason: () => 'Transfer patient — independent EHRC blood group verification required (no exceptions per §7).',
  }),
  defineRule({
    id: 'sop.7.transfer.full_handover',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§7 Transfer — anaesthetist handover',
    trigger: (s) => isTrue(s, 'surgery.is_transfer_patient'),
    payload: () => ({
      kind: 'order',
      orderType: 'plan.transfer_handover',
      label: 'Anaesthetist receives complete handover BEFORE PAC',
    }),
    reason: () =>
      'Transfer patient — anaesthetist must receive complete handover (reason, treatments, results, discrepancies) before PAC (§7).',
  }),
  defineRule({
    id: 'sop.7.transfer.repeat_critical_invest',
    version: 1,
    layer: 1,
    severity: 'recommended',
    routesTo: 'diagnostic',
    sopReference: '§7 Transfer — repeat critical investigations',
    trigger: (s) => isTrue(s, 'surgery.is_transfer_patient'),
    payload: () => ({
      kind: 'diagnostic',
      orderType: 'plan.repeat_critical_invest',
      label: 'Repeat critical investigations',
    }),
    reason: () => 'Transfer patient — repeat critical investigations (external reports are reference only) per §7.',
  }),
];

// =============================================================================
// §6.6 Pre-op verification checklist (10 rules)
//
// Per PRD §6.6: routes to checklist_state on pac_workspace_progress instead of
// pac_orders / pac_clearances. We use kind:'order' with orderType:'checklist.*'
// as a tag so the persistence layer (PCW2.3) can route accordingly.
// =============================================================================

const PREOP_CHECKLIST: PacRule[] = [
  defineRule({
    id: 'sop.9.preop.identity',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({ kind: 'order', orderType: 'checklist.identity', label: 'Patient identity verified' }),
    reason: () => 'Pre-op verification (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.procedure',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({ kind: 'order', orderType: 'checklist.procedure', label: 'Procedure verified' }),
    reason: () => 'Pre-op verification (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.site_marking',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification — WHO surgical safety',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({ kind: 'order', orderType: 'checklist.site_marking', label: 'Site marked (WHO surgical safety)' }),
    reason: () => 'Pre-op site marking per WHO surgical safety (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.consents',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({ kind: 'order', orderType: 'checklist.consents', label: 'Surgical + anaesthesia consents signed' }),
    reason: () => 'Both surgical + anaesthesia consents required (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.high_risk_consent',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification — high-risk',
    trigger: (s) =>
      isTrue(s, 'surgery.is_surgical_case') &&
      (s.asaGrade === 3 || s.asaGrade === 4 || s.asaGrade === 5),
    payload: () => ({
      kind: 'order',
      orderType: 'checklist.high_risk_consent',
      label: 'High-risk consent signed',
    }),
    reason: (s) => `ASA ${s.asaGrade} — high-risk consent required (§9).`,
  }),
  defineRule({
    id: 'sop.9.preop.pac_clearance',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({ kind: 'order', orderType: 'checklist.pac_clearance', label: 'PAC clearance documented' }),
    reason: () => 'Pre-op PAC clearance must be documented (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.investigations_complete',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({
      kind: 'order',
      orderType: 'checklist.investigations_complete',
      label: 'All investigations reviewed',
    }),
    reason: () => 'All ordered investigations must be reviewed (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.specialist_clearances',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification — specialist clearances',
    // Per PRD §6.6: REQ if any clearance was REQUIRED. Engine has no DB
    // context; PCW2.3 persistence layer suppresses this rule when no
    // clearance suggestions exist on the case. Engine fires whenever
    // surgery is planned; PCW2.3 reconciliation handles the "any clearance"
    // condition.
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({
      kind: 'order',
      orderType: 'checklist.specialist_clearances',
      label: 'All specialist clearances received',
    }),
    reason: () => 'All triggered specialist clearances must be received (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.npo_confirmed',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification',
    trigger: (s) => isTrue(s, 'surgery.is_surgical_case'),
    payload: () => ({ kind: 'order', orderType: 'checklist.npo_confirmed', label: 'NPO time confirmed' }),
    reason: () => 'NPO time must be confirmed pre-op (§9).',
  }),
  defineRule({
    id: 'sop.9.preop.iv_cannula_18g',
    version: 1,
    layer: 1,
    severity: 'required',
    routesTo: 'order',
    sopReference: '§9 Pre-op verification — major surgery',
    trigger: (s) =>
      isTrue(s, 'surgery.is_surgical_case') && isTrue(s, 'surgery.is_major'),
    payload: () => ({
      kind: 'order',
      orderType: 'checklist.iv_cannula_18g',
      label: 'IV cannula 18G placed',
    }),
    reason: () => 'Major surgery — 18G IV cannula required pre-op (§9).',
  }),
];

// =============================================================================
// Aggregate exports
// =============================================================================

export const LAYER3_RULES: PacRule[] = LAYER3;
export const NPO_RULES: PacRule[] = NPO;
export const TRANSFER_RULES: PacRule[] = TRANSFER;
export const PREOP_CHECKLIST_RULES: PacRule[] = PREOP_CHECKLIST;

export const LAYER3_AND_SECTIONS_RULES: PacRule[] = [
  ...LAYER3,
  ...NPO,
  ...TRANSFER,
  ...PREOP_CHECKLIST,
];
