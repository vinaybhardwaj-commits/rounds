// =============================================================================
// PAC Coordinator Workspace v1 — Marketing Handoff intake pre-fill
// PRD Q5: V chose pre-fill comorbidities + allergies + current medications.
//
// Reads the latest consolidated_marketing_handoff form_submission for a given
// patient_thread, normalises the field names (MH stores `current_medication`
// singular but PAC convention is plural), and returns a typed PacPatientContext.
//
// Comorbidity normalisation: known_comorbidities is a free-form array of strings
// captured from the Marketing form. We snake_case + lowercase each entry and
// map common aliases to the taxonomy used by pac_clearance_specialties.sop_trigger_comorbidities
// so the SOP §6.3 auto-suggest engine fires correctly without the IPC having
// to manually re-tag in PCW.2's clearance modal.
// =============================================================================

import { queryOne } from '@/lib/db';
import type { PacPatientContext } from './types';

interface MhFormRow {
  id: string;
  form_data: Record<string, unknown>;
  created_at: string;
}

// Common aliases → canonical snake_case flag. Liberal: better to over-flag and
// have the IPC dismiss in the picker than miss a relevant clearance.
const COMORBIDITY_ALIAS_MAP: Record<string, string> = {
  // Cardiac
  'hypertension': 'hypertension_uncontrolled',
  'high_blood_pressure': 'hypertension_uncontrolled',
  'htn': 'hypertension_uncontrolled',
  'cad': 'cardiac_disease',
  'coronary_artery_disease': 'cardiac_disease',
  'ihd': 'cardiac_disease',
  'heart_disease': 'cardiac_disease',
  'mi_history': 'cardiac_disease',
  'old_mi': 'cardiac_disease',
  'recent_mi': 'recent_mi',
  'angina': 'angina',
  'arrhythmia': 'arrhythmia',
  'af': 'arrhythmia',
  'atrial_fibrillation': 'arrhythmia',
  'heart_failure': 'heart_failure',
  'ccf': 'heart_failure',
  'chf': 'heart_failure',
  'valvular_disease': 'valvular_disease',
  // Respiratory
  'asthma': 'asthma',
  'copd': 'copd',
  'chronic_obstructive_pulmonary_disease': 'copd',
  'osa': 'osa',
  'sleep_apnea': 'osa',
  'sleep_apnoea': 'osa',
  // Endocrine
  'diabetes': 'diabetes_uncontrolled',
  'dm': 'diabetes_uncontrolled',
  'type_2_diabetes': 'diabetes_uncontrolled',
  'hyperthyroid': 'thyroid_uncontrolled',
  'hypothyroid': 'thyroid_uncontrolled',
  'thyroid': 'thyroid_uncontrolled',
  // Renal
  'ckd': 'ckd',
  'chronic_kidney_disease': 'ckd',
  'esrd': 'esrd',
  'dialysis': 'dialysis',
  // Neuro
  'cva': 'recent_cva',
  'stroke': 'recent_cva',
  'recent_cva': 'recent_cva',
  'seizure': 'seizure_disorder',
  'epilepsy': 'seizure_disorder',
  // GI / hepatic
  'cirrhosis': 'cirrhosis',
  'liver_disease': 'liver_disease',
  // Haem
  'anaemia': 'anaemia_severe',
  'anemia': 'anaemia_severe',
  'coagulopathy': 'coagulopathy',
  'thrombocytopenia': 'thrombocytopenia',
  'on_warfarin': 'anticoagulant_active',
  'on_anticoagulant': 'anticoagulant_active',
};

function toSnake(s: string): string {
  return s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function normaliseComorbidities(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string' && raw.trim().length > 0) {
      // Sometimes MH stores it as a comma-separated string instead of array.
      raw = raw.split(',');
    } else {
      return [];
    }
  }
  const out = new Set<string>();
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const snake = toSnake(entry);
    if (!snake) continue;
    // Direct hit → keep snake-cased value (e.g. 'asthma').
    out.add(COMORBIDITY_ALIAS_MAP[snake] ?? snake);
  }
  return Array.from(out);
}

export async function loadIntakeContext(
  patientThreadId: string | null,
): Promise<PacPatientContext | null> {
  if (!patientThreadId) return null;

  // Latest non-draft Marketing Handoff for this patient thread.
  const row = await queryOne<MhFormRow>(
    `SELECT id::text AS id, form_data, created_at::text AS created_at
       FROM form_submissions
      WHERE patient_thread_id = $1::uuid
        AND form_type = 'consolidated_marketing_handoff'
        AND status <> 'draft'
      ORDER BY created_at DESC
      LIMIT 1`,
    [patientThreadId],
  );
  if (!row) return null;

  const fd = row.form_data || {};
  const comorbidities = normaliseComorbidities(fd['known_comorbidities']);
  const allergiesRaw = fd['allergies'];
  const medsRaw = fd['current_medication'] ?? fd['current_medications'];
  const ctrlRaw = fd['comorbidities_controlled'];

  return {
    comorbidities,
    allergies: typeof allergiesRaw === 'string' && allergiesRaw.trim() ? allergiesRaw.trim() : null,
    current_medications: typeof medsRaw === 'string' && medsRaw.trim() ? medsRaw.trim() : null,
    comorbidities_controlled: typeof ctrlRaw === 'string' && ctrlRaw.trim() ? ctrlRaw.trim() : null,
    source_form_submission_id: row.id,
    source_submitted_at: row.created_at,
  };
}

export interface ChecklistAutoTickHints {
  hasAllergies: boolean;
  hasMedications: boolean;
}

export function autoTickChecklist(
  items: Array<{ id: string; state: string; actor_name?: string | null; ticked_at?: string | null; notes?: string | null }>,
  hints: ChecklistAutoTickHints,
  actorId: string,
  actorName: string,
): typeof items {
  const nowIso = new Date().toISOString();
  return items.map((item) => {
    if (item.state !== 'pending') return item;
    let pre = '';
    if (item.id === 'allergy_history' && hints.hasAllergies) pre = 'Pre-filled from intake form.';
    else if (item.id === 'allergies_verbal' && hints.hasAllergies) pre = 'Pre-filled from intake form.';
    else if (item.id === 'allergies_verified' && hints.hasAllergies) pre = 'Pre-filled from intake form.';
    else if (item.id === 'current_medications' && hints.hasMedications) pre = 'Pre-filled from intake form.';
    else if (item.id === 'medications_verbal' && hints.hasMedications) pre = 'Pre-filled from intake form.';
    else if (item.id === 'medications_verified' && hints.hasMedications) pre = 'Pre-filled from intake form.';

    if (!pre) return item;
    return {
      ...item,
      state: 'done',
      actor_id: actorId,
      actor_name: actorName,
      ticked_at: nowIso,
      notes: pre,
    };
  });
}
