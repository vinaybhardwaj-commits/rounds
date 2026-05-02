// =============================================================================
// PAC Workspace v2 — Layer 3 + NPO + Transfer + Pre-op checklist tests
// (PCW2.2c)
//
// 37 rules × 3 tests = 111 tests per PRD §5.2 spec.
// Run: npx vitest run tests/unit/pac-workspace/rules-layer3-sections.test.ts
// =============================================================================

import { describe, expect, it } from 'vitest';
import { evaluate } from '@/lib/pac-workspace/engine';
import {
  LAYER3_AND_SECTIONS_RULES,
  LAYER3_RULES,
  NPO_RULES,
  TRANSFER_RULES,
  PREOP_CHECKLIST_RULES,
} from '@/lib/pac-workspace/rules/layer3-and-sections';
import {
  makeSnapshot,
  merge,
  withFlag,
  withMedication,
  withSurgicalCase,
  withUrgency,
  withVital,
} from './_fixtures';

function fired(facts: ReturnType<typeof makeSnapshot>, ruleId: string): boolean {
  return evaluate(facts, LAYER3_AND_SECTIONS_RULES).some((s) => s.ruleId === ruleId);
}

// =============================================================================
// Layer 3 — Result-driven (19 rules)
// =============================================================================

describe('appx.bp.180_110_defer', () => {
  it('positive: bp_systolic = 185 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.bp_systolic.value', 185, 'mmHg') }), 'appx.bp.180_110_defer')).toBe(true);
  });
  it('positive2: bp_diastolic = 115 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.bp_diastolic.value', 115, 'mmHg') }), 'appx.bp.180_110_defer')).toBe(true);
  });
  it('negative: bp 140/85 → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.bp_systolic.value', 140, 'mmHg'), withVital('lab.bp_diastolic.value', 85, 'mmHg')) });
    expect(fired(snap, 'appx.bp.180_110_defer')).toBe(false);
  });
});

describe('appx.bp.160_100_target', () => {
  it('positive: bp 130/80 → INFO fires (target met)', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.bp_systolic.value', 130, 'mmHg'), withVital('lab.bp_diastolic.value', 80, 'mmHg')) });
    expect(fired(snap, 'appx.bp.160_100_target')).toBe(true);
  });
  it('negative: only systolic set, diastolic missing → does NOT fire (need both)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.bp_systolic.value', 130, 'mmHg') }), 'appx.bp.160_100_target')).toBe(false);
  });
  it('edge: bp 165/95 → does NOT fire (above target)', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.bp_systolic.value', 165, 'mmHg'), withVital('lab.bp_diastolic.value', 95, 'mmHg')) });
    expect(fired(snap, 'appx.bp.160_100_target')).toBe(false);
  });
});

describe('appx.hba1c.8_5_defer', () => {
  it('positive: hba1c 9.5 → REQ asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hba1c.value', 9.5, '%') }), 'appx.hba1c.8_5_defer')).toBe(true);
  });
  it('negative: hba1c 7.2 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hba1c.value', 7.2, '%') }), 'appx.hba1c.8_5_defer')).toBe(false);
  });
  it('edge: hba1c 8.5 → does NOT fire (strict >)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hba1c.value', 8.5, '%') }), 'appx.hba1c.8_5_defer')).toBe(false);
  });
});

describe('appx.glucose.periop_range', () => {
  it('positive: rbs 5.5 mmol/L (below 6) → REC fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.rbs.value', 5.5, 'mmol/L') }), 'appx.glucose.periop_range')).toBe(true);
  });
  it('positive2: rbs 11 mmol/L (above 10) → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.rbs.value', 11, 'mmol/L') }), 'appx.glucose.periop_range')).toBe(true);
  });
  it('negative: rbs 8 mmol/L (in range) → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.rbs.value', 8, 'mmol/L') }), 'appx.glucose.periop_range')).toBe(false);
  });
});

describe('appx.glucose.day_of_vriii', () => {
  it('positive: rbs 14 mmol/L → REQ fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.rbs.value', 14, 'mmol/L') }), 'appx.glucose.day_of_vriii')).toBe(true);
  });
  it('negative: rbs 11 mmol/L → does NOT fire (rule fires above 12)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.rbs.value', 11, 'mmol/L') }), 'appx.glucose.day_of_vriii')).toBe(false);
  });
  it('edge: rbs 12 mmol/L → does NOT fire (strict >)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.rbs.value', 12, 'mmol/L') }), 'appx.glucose.day_of_vriii')).toBe(false);
  });
});

describe('appx.spo2.94_invest', () => {
  it('positive: spo2 92 → REC fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 92, '%') }), 'appx.spo2.94_invest')).toBe(true);
  });
  it('negative: spo2 98 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 98, '%') }), 'appx.spo2.94_invest')).toBe(false);
  });
  it('edge: spo2 unset → does NOT fire (conservative)', () => {
    expect(fired(makeSnapshot(), 'appx.spo2.94_invest')).toBe(false);
  });
});

describe('appx.spo2.90_abg', () => {
  it('positive: spo2 88 → REQ fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 88, '%') }), 'appx.spo2.90_abg')).toBe(true);
  });
  it('negative: spo2 92 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 92, '%') }), 'appx.spo2.90_abg')).toBe(false);
  });
  it('edge: spo2 90 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('vital.spo2.value', 90, '%') }), 'appx.spo2.90_abg')).toBe(false);
  });
});

describe('appx.inr.1_5_major_defer', () => {
  it('positive: inr 1.6 + is_major → fires', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.6), withFlag('surgery.is_major')) });
    expect(fired(snap, 'appx.inr.1_5_major_defer')).toBe(true);
  });
  it('negative: inr 1.6 without is_major → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.inr.value', 1.6) }), 'appx.inr.1_5_major_defer')).toBe(false);
  });
  it('edge: inr 1.5 + is_major → does NOT fire (strict >)', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.5), withFlag('surgery.is_major')) });
    expect(fired(snap, 'appx.inr.1_5_major_defer')).toBe(false);
  });
});

describe('appx.inr.1_4_neuraxial_defer', () => {
  it('positive: inr 1.45 + requires_neuraxial → fires', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.45), withFlag('surgery.requires_neuraxial')) });
    expect(fired(snap, 'appx.inr.1_4_neuraxial_defer')).toBe(true);
  });
  it('negative: inr 1.45 alone → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.inr.value', 1.45) }), 'appx.inr.1_4_neuraxial_defer')).toBe(false);
  });
  it('edge: inr 1.4 + neuraxial → does NOT fire (strict >)', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.inr.value', 1.4), withFlag('surgery.requires_neuraxial')) });
    expect(fired(snap, 'appx.inr.1_4_neuraxial_defer')).toBe(false);
  });
});

describe('appx.platelets.50_defer', () => {
  it('positive: platelets 35 → fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 35, 'x10^9/L') }), 'appx.platelets.50_defer')).toBe(true);
  });
  it('negative: platelets 100 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 100, 'x10^9/L') }), 'appx.platelets.50_defer')).toBe(false);
  });
  it('edge: platelets 50 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 50, 'x10^9/L') }), 'appx.platelets.50_defer')).toBe(false);
  });
});

describe('appx.platelets.80_epidural_defer', () => {
  it('positive: platelets 70 + requires_epidural → fires', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.platelets.value', 70, 'x10^9/L'), withFlag('surgery.requires_epidural')) });
    expect(fired(snap, 'appx.platelets.80_epidural_defer')).toBe(true);
  });
  it('negative: platelets 70 alone → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.platelets.value', 70, 'x10^9/L') }), 'appx.platelets.80_epidural_defer')).toBe(false);
  });
  it('edge: platelets 90 + requires_epidural → does NOT fire (above threshold)', () => {
    const snap = makeSnapshot({ facts: merge(withVital('lab.platelets.value', 90, 'x10^9/L'), withFlag('surgery.requires_epidural')) });
    expect(fired(snap, 'appx.platelets.80_epidural_defer')).toBe(false);
  });
});

describe('appx.hb.8_defer', () => {
  it('positive: hb 7.5 → REQ asa_review fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 7.5, 'g/dL') }), 'appx.hb.8_defer')).toBe(true);
  });
  it('negative: hb 9 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 9, 'g/dL') }), 'appx.hb.8_defer')).toBe(false);
  });
  it('edge: hb 8 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.hb.value', 8, 'g/dL') }), 'appx.hb.8_defer')).toBe(false);
  });
});

describe('appx.egfr.30_nephro', () => {
  it('positive: egfr 25 → REQ clearance fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 25) }), 'appx.egfr.30_nephro')).toBe(true);
  });
  it('negative: egfr 50 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 50) }), 'appx.egfr.30_nephro')).toBe(false);
  });
  it('edge: egfr 30 → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 30) }), 'appx.egfr.30_nephro')).toBe(false);
  });
});

describe('appx.egfr.60_flag', () => {
  it('positive: egfr 50 → INFO fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 50) }), 'appx.egfr.60_flag')).toBe(true);
  });
  it('negative: egfr 80 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.egfr.value', 80) }), 'appx.egfr.60_flag')).toBe(false);
  });
  it('edge: egfr unset → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'appx.egfr.60_flag')).toBe(false);
  });
});

describe('appx.k.6_defer', () => {
  it('positive: K 6.5 → REQ fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 6.5, 'mmol/L') }), 'appx.k.6_defer')).toBe(true);
  });
  it('negative: K 4 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 4, 'mmol/L') }), 'appx.k.6_defer')).toBe(false);
  });
  it('edge: K 6 exactly → does NOT fire (strict >)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 6, 'mmol/L') }), 'appx.k.6_defer')).toBe(false);
  });
});

describe('appx.k.3_defer', () => {
  it('positive: K 2.7 → REQ fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 2.7, 'mmol/L') }), 'appx.k.3_defer')).toBe(true);
  });
  it('negative: K 4 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 4, 'mmol/L') }), 'appx.k.3_defer')).toBe(false);
  });
  it('edge: K 3 exactly → does NOT fire (strict <)', () => {
    expect(fired(makeSnapshot({ facts: withVital('lab.potassium.value', 3, 'mmol/L') }), 'appx.k.3_defer')).toBe(false);
  });
});

describe('appx.dasi.34_cardiac_risk', () => {
  it('positive: DASI 28 → REC fires', () => {
    expect(fired(makeSnapshot({ facts: withVital('score.dasi.value', 28) }), 'appx.dasi.34_cardiac_risk')).toBe(true);
  });
  it('negative: DASI 50 → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withVital('score.dasi.value', 50) }), 'appx.dasi.34_cardiac_risk')).toBe(false);
  });
  it('edge: DASI unset → does NOT fire (conservative)', () => {
    expect(fired(makeSnapshot(), 'appx.dasi.34_cardiac_risk')).toBe(false);
  });
});

describe('appx.pci.6mo_defer', () => {
  it('positive: pci_within_6_months + elective → REQ fires', () => {
    const snap = makeSnapshot({ facts: merge(withFlag('history.pci_within_6_months'), withUrgency('elective')) });
    expect(fired(snap, 'appx.pci.6mo_defer')).toBe(true);
  });
  it('negative: pci_within_6_months + emergency → does NOT fire (rule is elective-only)', () => {
    const snap = makeSnapshot({ facts: merge(withFlag('history.pci_within_6_months'), withUrgency('emergency')) });
    expect(fired(snap, 'appx.pci.6mo_defer')).toBe(false);
  });
  it('edge: elective without flag → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withUrgency('elective') }), 'appx.pci.6mo_defer')).toBe(false);
  });
});

describe('appx.acs.12mo_defer', () => {
  it('positive: acs_within_12_months + elective → REQ fires', () => {
    const snap = makeSnapshot({ facts: merge(withFlag('history.acs_within_12_months'), withUrgency('elective')) });
    expect(fired(snap, 'appx.acs.12mo_defer')).toBe(true);
  });
  it('negative: acs_within_12_months + urgent → does NOT fire', () => {
    const snap = makeSnapshot({ facts: merge(withFlag('history.acs_within_12_months'), withUrgency('urgent')) });
    expect(fired(snap, 'appx.acs.12mo_defer')).toBe(false);
  });
  it('edge: no acs flag → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withUrgency('elective') }), 'appx.acs.12mo_defer')).toBe(false);
  });
});

// =============================================================================
// §6.4 NPO (5 rules)
// =============================================================================

describe('sop.6.4.npo.fatty_meals', () => {
  it('positive: surgical case → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withSurgicalCase() }), 'sop.6.4.npo.fatty_meals')).toBe(true);
  });
  it('negative: no surgical case → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.4.npo.fatty_meals')).toBe(false);
  });
  it('edge: surgery.is_surgical_case=false → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: { 'surgery.is_surgical_case': { value: false } } }), 'sop.6.4.npo.fatty_meals')).toBe(false);
  });
});

describe('sop.6.4.npo.glp1_users', () => {
  it('positive: medication mentions Ozempic → fires', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Ozempic 0.5mg weekly') }), 'sop.6.4.npo.glp1_users')).toBe(true);
  });
  it('negative: medication empty → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.4.npo.glp1_users')).toBe(false);
  });
  it('edge: medication mentions tirzepatide → fires', () => {
    expect(fired(makeSnapshot({ facts: withMedication('Tirzepatide weekly') }), 'sop.6.4.npo.glp1_users')).toBe(true);
  });
});

describe('sop.6.4.npo.light_meals', () => {
  it('positive: surgical case → INFO fires', () => {
    expect(fired(makeSnapshot({ facts: withSurgicalCase() }), 'sop.6.4.npo.light_meals')).toBe(true);
  });
  it('negative: no surgical case → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.4.npo.light_meals')).toBe(false);
  });
  it('edge: only ASA grade set, no surgical case fact → does NOT fire', () => {
    expect(fired(makeSnapshot({ asaGrade: 2 }), 'sop.6.4.npo.light_meals')).toBe(false);
  });
});

describe('sop.6.4.npo.water', () => {
  it('positive: surgical case → INFO fires', () => {
    expect(fired(makeSnapshot({ facts: withSurgicalCase() }), 'sop.6.4.npo.water')).toBe(true);
  });
  it('negative: empty snapshot → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.6.4.npo.water')).toBe(false);
  });
  it('edge: surgical case + asa=4 → still fires', () => {
    expect(fired(makeSnapshot({ asaGrade: 4, facts: withSurgicalCase() }), 'sop.6.4.npo.water')).toBe(true);
  });
});

describe('sop.6.4.npo.emergency', () => {
  it('positive: urgency=urgent → REQ fires', () => {
    expect(fired(makeSnapshot({ facts: withUrgency('urgent') }), 'sop.6.4.npo.emergency')).toBe(true);
  });
  it('positive2: urgency=emergency → fires', () => {
    expect(fired(makeSnapshot({ facts: withUrgency('emergency') }), 'sop.6.4.npo.emergency')).toBe(true);
  });
  it('negative: urgency=elective → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withUrgency('elective') }), 'sop.6.4.npo.emergency')).toBe(false);
  });
});

// =============================================================================
// §7 Transfer (3 rules)
// =============================================================================

describe('sop.7.transfer.blood_group_reverify', () => {
  it('positive: is_transfer_patient=true → REQ diag fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('surgery.is_transfer_patient') }), 'sop.7.transfer.blood_group_reverify')).toBe(true);
  });
  it('negative: not a transfer patient → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withSurgicalCase() }), 'sop.7.transfer.blood_group_reverify')).toBe(false);
  });
  it('edge: empty snapshot → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.7.transfer.blood_group_reverify')).toBe(false);
  });
});

describe('sop.7.transfer.full_handover', () => {
  it('positive: is_transfer_patient → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('surgery.is_transfer_patient') }), 'sop.7.transfer.full_handover')).toBe(true);
  });
  it('negative: not a transfer → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withSurgicalCase() }), 'sop.7.transfer.full_handover')).toBe(false);
  });
  it('edge: transfer + asa 5 → still fires (Layer-1-style numbering, no eligibility gate)', () => {
    const snap = makeSnapshot({ asaGrade: 5, facts: withFlag('surgery.is_transfer_patient') });
    expect(fired(snap, 'sop.7.transfer.full_handover')).toBe(true);
  });
});

describe('sop.7.transfer.repeat_critical_invest', () => {
  it('positive: is_transfer_patient → REC diag fires', () => {
    expect(fired(makeSnapshot({ facts: withFlag('surgery.is_transfer_patient') }), 'sop.7.transfer.repeat_critical_invest')).toBe(true);
  });
  it('negative: not a transfer → does NOT fire', () => {
    expect(fired(makeSnapshot(), 'sop.7.transfer.repeat_critical_invest')).toBe(false);
  });
  it('edge: severity is recommended', () => {
    const snap = makeSnapshot({ facts: withFlag('surgery.is_transfer_patient') });
    const out = evaluate(snap, LAYER3_AND_SECTIONS_RULES).find(s => s.ruleId === 'sop.7.transfer.repeat_critical_invest');
    expect(out?.severity).toBe('recommended');
  });
});

// =============================================================================
// §9 Pre-op verification checklist (10 rules)
// =============================================================================

describe.each([
  ['sop.9.preop.identity', 'identity'],
  ['sop.9.preop.procedure', 'procedure'],
  ['sop.9.preop.site_marking', 'site_marking'],
  ['sop.9.preop.consents', 'consents'],
  ['sop.9.preop.pac_clearance', 'pac_clearance'],
  ['sop.9.preop.investigations_complete', 'investigations_complete'],
  ['sop.9.preop.specialist_clearances', 'specialist_clearances'],
  ['sop.9.preop.npo_confirmed', 'npo_confirmed'],
])('%s — universal pre-op check', (ruleId, _tag) => {
  it('positive: surgical case → REQ order fires', () => {
    expect(fired(makeSnapshot({ facts: withSurgicalCase() }), ruleId)).toBe(true);
  });
  it('negative: no surgical case → does NOT fire', () => {
    expect(fired(makeSnapshot(), ruleId)).toBe(false);
  });
  it('edge: surgery.is_surgical_case=false → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: { 'surgery.is_surgical_case': { value: false } } }), ruleId)).toBe(false);
  });
});

describe('sop.9.preop.high_risk_consent', () => {
  it('positive: surgical case + ASA 3 → REQ fires', () => {
    expect(fired(makeSnapshot({ asaGrade: 3, facts: withSurgicalCase() }), 'sop.9.preop.high_risk_consent')).toBe(true);
  });
  it('negative: surgical case + ASA 1 → does NOT fire', () => {
    expect(fired(makeSnapshot({ asaGrade: 1, facts: withSurgicalCase() }), 'sop.9.preop.high_risk_consent')).toBe(false);
  });
  it('edge: surgical case + ASA 5 → fires (rule covers ASA 3-5)', () => {
    expect(fired(makeSnapshot({ asaGrade: 5, facts: withSurgicalCase() }), 'sop.9.preop.high_risk_consent')).toBe(true);
  });
});

describe('sop.9.preop.iv_cannula_18g', () => {
  it('positive: surgical case + is_major → REQ fires', () => {
    const snap = makeSnapshot({ facts: merge(withSurgicalCase(), withFlag('surgery.is_major')) });
    expect(fired(snap, 'sop.9.preop.iv_cannula_18g')).toBe(true);
  });
  it('negative: surgical case without is_major → does NOT fire (Q4 default-false)', () => {
    expect(fired(makeSnapshot({ facts: withSurgicalCase() }), 'sop.9.preop.iv_cannula_18g')).toBe(false);
  });
  it('edge: is_major without surgical case → does NOT fire', () => {
    expect(fired(makeSnapshot({ facts: withFlag('surgery.is_major') }), 'sop.9.preop.iv_cannula_18g')).toBe(false);
  });
});

// =============================================================================
// Catalogue coverage — all 37 rules accounted for
// =============================================================================

describe('Layer 3 + sections catalogue coverage', () => {
  it('LAYER3_RULES has 19 rules', () => {
    expect(LAYER3_RULES).toHaveLength(19);
  });
  it('NPO_RULES has 5 rules', () => {
    expect(NPO_RULES).toHaveLength(5);
  });
  it('TRANSFER_RULES has 3 rules', () => {
    expect(TRANSFER_RULES).toHaveLength(3);
  });
  it('PREOP_CHECKLIST_RULES has 10 rules', () => {
    expect(PREOP_CHECKLIST_RULES).toHaveLength(10);
  });
  it('combined LAYER3_AND_SECTIONS_RULES has 37 rules', () => {
    expect(LAYER3_AND_SECTIONS_RULES).toHaveLength(37);
  });
  it('every rule has a unique id', () => {
    const ids = LAYER3_AND_SECTIONS_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
