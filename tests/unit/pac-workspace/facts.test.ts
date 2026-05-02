// =============================================================================
// PAC Workspace v2 — Fact extraction unit tests (PCW2.1)
//
// Tests the pure extractFacts() function only. The DB persistence in
// writePacFacts() is covered by integration tests (PCW2.3 onwards) once
// the engine wraps the full evaluate-and-persist pipeline.
//
// Run: npx vitest run tests/unit/pac-workspace/facts.test.ts
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  extractFacts,
  type ExtractedFact,
} from '@/lib/pac-workspace/facts';

function findFact(
  facts: ExtractedFact[],
  key: string
): ExtractedFact | undefined {
  return facts.find((f) => f.fact_key === key);
}

function keysOf(facts: ExtractedFact[]): string[] {
  return facts.map((f) => f.fact_key).sort();
}

describe('extractFacts — consolidated_marketing_handoff', () => {
  const handoff = {
    surgery_planned: true,
    surgical_specialty: 'orthopaedics',
    proposed_procedure: 'Total Knee Replacement',
    surgery_urgency: 'elective',
    laterality: 'right',
    preferred_surgery_date: '2026-05-15',
    preferred_surgery_time: 'morning',
    clinical_justification: 'Severe osteoarthritis, conservative therapy failed',
    known_comorbidities: ['diabetes', 'hypertension'],
    comorbidities_controlled: 'yes',
    habits: ['smoking'],
    habits_stopped: 'no',
    current_medication: 'Metformin 500mg BD, Telmisartan 40mg OD',
    pac_status: 'not_done',
    support_requirements: 'Bilateral assistance for transfer',
    special_requirements: 'Cemented prosthesis, size 6',
  };

  it('emits surgery + comorbidity + habit + medication facts', () => {
    const facts = extractFacts('consolidated_marketing_handoff', handoff);
    const keys = keysOf(facts);
    // Sanity check the high-value keys are all present
    expect(keys).toContain('surgery.is_surgical_case');
    expect(keys).toContain('surgery.procedure_name');
    expect(keys).toContain('surgery.specialty');
    expect(keys).toContain('surgery.urgency');
    expect(keys).toContain('surgery.laterality');
    expect(keys).toContain('surgery.target_date');
    expect(keys).toContain('surgery.target_time_pref');
    expect(keys).toContain('surgery.indication');
    expect(keys).toContain('comorbidity.diabetes');
    expect(keys).toContain('comorbidity.hypertension');
    expect(keys).toContain('comorbidity_control._global');
    expect(keys).toContain('habit.smoking');
    expect(keys).toContain('habit_stopped._global');
    expect(keys).toContain('medication.notes');
    expect(keys).toContain('pac.coordinator_initial_status');
    expect(keys).toContain('surgery.support_requirements');
    expect(keys).toContain('surgery.special_requirements');
  });

  it('uses {value: ...} JSONB shape for free-text and {present: true} for multiselect items', () => {
    const facts = extractFacts('consolidated_marketing_handoff', handoff);
    expect(findFact(facts, 'surgery.procedure_name')?.fact_value).toEqual({
      value: 'Total Knee Replacement',
    });
    expect(findFact(facts, 'medication.notes')?.fact_value).toEqual({
      value: 'Metformin 500mg BD, Telmisartan 40mg OD',
    });
    expect(findFact(facts, 'comorbidity.diabetes')?.fact_value).toEqual({
      present: true,
    });
    expect(findFact(facts, 'habit.smoking')?.fact_value).toEqual({
      present: true,
    });
  });

  it('PRD §15.1 acceptance: ≥6 facts on a 2-comorbidity + 1-habit handoff', () => {
    // PRD §15.1 line 1490: "pac_facts populated within 2 seconds of submit"
    // and ≥6 rows expected (surgery facts + 2 comorbidities + 1 control +
    // 1 habit + 1 habit_stopped, etc.). We're well above that with this
    // fixture, but the lower bound is the regression we care about.
    const facts = extractFacts('consolidated_marketing_handoff', handoff);
    expect(facts.length).toBeGreaterThanOrEqual(6);
  });

  it('emits no facts when surgery_planned=false', () => {
    const facts = extractFacts('consolidated_marketing_handoff', {
      ...handoff,
      surgery_planned: false,
    });
    expect(facts).toEqual([]);
  });

  it('skips the "none" sentinel in known_comorbidities and habits', () => {
    const facts = extractFacts('consolidated_marketing_handoff', {
      surgery_planned: true,
      known_comorbidities: ['diabetes', 'none'],
      habits: ['none'],
    });
    const keys = keysOf(facts);
    expect(keys).toContain('comorbidity.diabetes');
    expect(keys).not.toContain('comorbidity.none');
    expect(keys).not.toContain('habit.none');
    // No habit.* facts at all from a habits=['none'] input
    expect(keys.filter((k) => k.startsWith('habit.'))).toEqual([]);
  });

  it('skips empty / null fields (no row written for unset values)', () => {
    const facts = extractFacts('consolidated_marketing_handoff', {
      surgery_planned: true,
      surgical_specialty: 'orthopaedics',
      proposed_procedure: '',
      preferred_surgery_date: null,
      clinical_justification: '   ', // whitespace-only
      known_comorbidities: [],
      habits: undefined,
    });
    const keys = keysOf(facts);
    expect(keys).toContain('surgery.is_surgical_case');
    expect(keys).toContain('surgery.specialty');
    expect(keys).not.toContain('surgery.procedure_name');
    expect(keys).not.toContain('surgery.target_date');
    expect(keys).not.toContain('surgery.indication');
    // No comorbidity.* or habit.* from empty/undefined arrays
    expect(keys.filter((k) => k.startsWith('comorbidity.'))).toEqual([]);
    expect(keys.filter((k) => k.startsWith('habit.'))).toEqual([]);
  });

  it('falls back to proposed_procedure_id when proposed_procedure is empty', () => {
    const facts = extractFacts('consolidated_marketing_handoff', {
      surgery_planned: true,
      proposed_procedure: '',
      proposed_procedure_id: 'CHG-TKR-CEMENTED',
    });
    expect(findFact(facts, 'surgery.procedure_name')?.fact_value).toEqual({
      value: 'CHG-TKR-CEMENTED',
    });
  });
});

describe('extractFacts — surgery_booking (standalone)', () => {
  const standaloneBooking = {
    // Standalone surgery_booking has no surgery_planned field — extractor
    // treats absence as implicit-true.
    surgical_specialty: 'orthopaedics',
    proposed_procedure: 'Total Hip Replacement',
    surgery_urgency: 'urgent',
    laterality: 'left',
    known_comorbidities: ['cardiac_disease'],
    comorbidities_controlled: 'unknown',
    habits: ['alcohol', 'tobacco_chewing'],
    habits_stopped: 'yes',
    current_medication: 'Aspirin 75mg OD',
    preferred_surgery_date: '2026-05-20',
  };

  it('mirrors consolidated_marketing_handoff shape (idempotent with consolidated)', () => {
    const facts = extractFacts('surgery_booking', standaloneBooking);
    const keys = keysOf(facts);
    expect(keys).toContain('surgery.is_surgical_case');
    expect(keys).toContain('surgery.procedure_name');
    expect(keys).toContain('surgery.specialty');
    expect(keys).toContain('surgery.urgency');
    expect(keys).toContain('comorbidity.cardiac_disease');
    expect(keys).toContain('habit.alcohol');
    expect(keys).toContain('habit.tobacco_chewing');
    expect(keys).toContain('habit_stopped._global');
    expect(keys).toContain('medication.notes');
  });

  it('emits surgery.is_surgical_case=true even without explicit surgery_planned', () => {
    const facts = extractFacts('surgery_booking', standaloneBooking);
    expect(findFact(facts, 'surgery.is_surgical_case')?.fact_value).toEqual({
      value: true,
    });
  });
});

describe('extractFacts — ot_booking', () => {
  it('emits surgery.* facts at the case level', () => {
    const facts = extractFacts('ot_booking', {
      anae_type: 'GA',
      equipment_status: 'Ready',
      consumables_status: 'Sourcing',
      planned_surgery_date: '2026-05-22',
      ot_room: 3,
      is_high_risk: true,
    });
    const keys = keysOf(facts);
    expect(keys).toContain('surgery.anaesthesia_type');
    expect(keys).toContain('surgery.equipment_status');
    expect(keys).toContain('surgery.consumables_status');
    expect(keys).toContain('surgery.target_date');
    expect(keys).toContain('surgery.ot_room');
    expect(keys).toContain('risk.flagged_high_risk');

    expect(findFact(facts, 'surgery.anaesthesia_type')?.fact_value).toEqual({
      value: 'GA',
    });
    expect(findFact(facts, 'surgery.ot_room')?.fact_value).toEqual({ value: 3 });
    expect(findFact(facts, 'risk.flagged_high_risk')?.fact_value).toEqual({
      value: true,
    });
  });

  it('reads anaesthesia_type (PRD name) when anae_type (route name) is absent', () => {
    const facts = extractFacts('ot_booking', { anaesthesia_type: 'SA' });
    expect(findFact(facts, 'surgery.anaesthesia_type')?.fact_value).toEqual({
      value: 'SA',
    });
  });

  it('emits no risk.flagged_high_risk when is_high_risk is missing', () => {
    const facts = extractFacts('ot_booking', { anae_type: 'LA' });
    const keys = keysOf(facts);
    expect(keys).not.toContain('risk.flagged_high_risk');
  });

  it('returns empty array on completely empty ot_booking submission', () => {
    expect(extractFacts('ot_booking', {})).toEqual([]);
  });
});
