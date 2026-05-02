// =============================================================================
// PAC Workspace v2 — Fact extraction layer (PCW2.1)
//
// Extracts patient-relevant facts from form submissions and writes them to
// pac_facts. The rule engine (PCW2.2+) reads via `WHERE superseded_at IS NULL`
// and triggers per PRD §6.
//
// Per PRD §5.1: deterministic, idempotent, non-fatal.
// Per PCW2.1 carryover Q4: skip-with-warn when no case found.
// Per PCW2.1 Q3: free-text facts use {value: "<text>"} JSONB shape.
// Per PCW2.1 Q2: form values are already canonical lowercase snake_case;
//   the only special-case is the literal `'none'` sentinel in multiselect
//   arrays, which we skip (engine logic relies on absence of
//   `comorbidity.diabetes`, not presence of `comorbidity.none`).
// =============================================================================

import { query as sqlQuery, queryOne } from '@/lib/db';

export type FactSourceFormType =
  | 'consolidated_marketing_handoff'
  | 'surgery_booking'
  | 'ot_booking';

export interface ExtractedFact {
  fact_key: string;
  fact_value: Record<string, unknown>;
}

const SENTINEL_NONE = 'none';

type FormData = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : v;
  }
  return String(v);
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v == null) return null;
  if (typeof v === 'string') {
    if (v === 'true' || v === 'yes') return true;
    if (v === 'false' || v === 'no') return false;
    if (v === '') return null;
  }
  return null;
}

function pushIfText(out: ExtractedFact[], key: string, raw: unknown): void {
  const s = asString(raw);
  if (s == null) return;
  out.push({ fact_key: key, fact_value: { value: s } });
}

function pushIfPresent(out: ExtractedFact[], key: string, raw: unknown): void {
  if (raw == null || raw === '') return;
  out.push({ fact_key: key, fact_value: { value: raw } });
}

function pushBool(out: ExtractedFact[], key: string, raw: unknown): void {
  const b = asBool(raw);
  if (b == null) return;
  out.push({ fact_key: key, fact_value: { value: b } });
}

function extractMultiselect(out: ExtractedFact[], keyPrefix: string, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    const s = asString(item);
    if (s == null) continue;
    if (s === SENTINEL_NONE) continue;
    out.push({ fact_key: `${keyPrefix}.${s}`, fact_value: { present: true } });
  }
}

/**
 * Extract surgery + comorbidity + habit + medication facts from
 * Section C of consolidated_marketing_handoff and from surgery_booking
 * standalone (which mirrors Section C). Both share the same shape.
 */
function extractSurgeryFamilyFacts(out: ExtractedFact[], data: FormData): void {
  // Gate on surgery_planned. consolidated_marketing_handoff has the field;
  // standalone surgery_booking is implicitly a surgery (no surgery_planned
  // field), so we treat absence as true.
  const surgeryPlannedRaw = data.surgery_planned;
  const isSurgical =
    surgeryPlannedRaw === undefined || asBool(surgeryPlannedRaw) === true;
  if (!isSurgical) return;

  out.push({ fact_key: 'surgery.is_surgical_case', fact_value: { value: true } });

  // proposed_procedure has two field shapes: id (charge-master pick) and
  // free-text fallback. Prefer the free-text (it renders the actual name)
  // when both are present.
  const procedure =
    asString(data.proposed_procedure) || asString(data.proposed_procedure_id);
  if (procedure) {
    out.push({ fact_key: 'surgery.procedure_name', fact_value: { value: procedure } });
  }

  pushIfText(out, 'surgery.specialty', data.surgical_specialty);
  pushIfText(out, 'surgery.urgency', data.surgery_urgency);
  pushIfText(out, 'surgery.laterality', data.laterality);
  pushIfText(out, 'surgery.target_date', data.preferred_surgery_date);
  pushIfText(out, 'surgery.target_time_pref', data.preferred_surgery_time);
  pushIfText(out, 'surgery.indication', data.clinical_justification);

  extractMultiselect(out, 'comorbidity', data.known_comorbidities);
  pushIfText(out, 'comorbidity_control._global', data.comorbidities_controlled);

  extractMultiselect(out, 'habit', data.habits);
  pushIfText(out, 'habit_stopped._global', data.habits_stopped);

  pushIfText(out, 'medication.notes', data.current_medication);
  pushIfText(out, 'pac.coordinator_initial_status', data.pac_status);

  pushIfText(out, 'surgery.support_requirements', data.support_requirements);
  pushIfText(out, 'surgery.special_requirements', data.special_requirements);
}

/**
 * Extract OT-booking case-level facts. Per PRD §5.1 ot_booking row.
 *
 * Field-name reconciliation between PRD and the existing route:
 *   - `anaesthesia_type` (PRD) / `anae_type` (route).
 *   - `planned_surgery_date` (both).
 *   - `is_high_risk` is reserved in PRD ("computed by booking step") but
 *     not yet emitted by the current ot_booking route. Pass-through if
 *     present; never blocks.
 */
function extractOtBookingFacts(out: ExtractedFact[], data: FormData): void {
  const anaesthesia =
    asString(data.anaesthesia_type) || asString(data.anae_type);
  if (anaesthesia) {
    out.push({ fact_key: 'surgery.anaesthesia_type', fact_value: { value: anaesthesia } });
  }

  pushIfText(out, 'surgery.equipment_status', data.equipment_status);
  pushIfText(out, 'surgery.consumables_status', data.consumables_status);
  pushIfText(out, 'surgery.target_date', data.planned_surgery_date);
  pushIfPresent(out, 'surgery.ot_room', data.ot_room);
  pushBool(out, 'risk.flagged_high_risk', data.is_high_risk);
}

export function extractFacts(
  formType: FactSourceFormType,
  formData: FormData
): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  switch (formType) {
    case 'consolidated_marketing_handoff':
    case 'surgery_booking':
      extractSurgeryFamilyFacts(out, formData);
      break;
    case 'ot_booking':
      extractOtBookingFacts(out, formData);
      break;
  }
  return out;
}

/**
 * Persist facts for a case. Per PRD §5.1:
 * - Mark previously-live rows for the same (case_id, fact_key) as superseded.
 * - Insert one new row per fact.
 * - "Latest non-null wins" is enforced by the supersede-first step.
 *
 * source_form_submission_id is nullable in the schema. ot_booking writes
 * with NULL since the route is not a form_submission.
 *
 * Non-fatal contract: callers wrap this in try/catch and never let it tear
 * down the underlying form/booking submit.
 */
export async function writePacFacts(args: {
  caseId: string;
  sourceFormType: FactSourceFormType;
  sourceFormSubmissionId: string | null;
  formData: FormData;
  capturedAt?: Date;
}): Promise<{ written: number }> {
  const { caseId, sourceFormType, sourceFormSubmissionId, formData } = args;
  const captured = (args.capturedAt ?? new Date()).toISOString();
  const facts = extractFacts(sourceFormType, formData);
  if (facts.length === 0) return { written: 0 };

  const keys = facts.map((f) => f.fact_key);

  // Step 1: supersede prior live rows for the keys we're about to overwrite.
  await sqlQuery(
    `UPDATE pac_facts
        SET superseded_at = NOW()
      WHERE case_id = $1
        AND fact_key = ANY($2::text[])
        AND superseded_at IS NULL`,
    [caseId, keys]
  );

  // Step 2: insert new rows. ON CONFLICT DO NOTHING is a backstop for the
  // rare same-form_submission replay — since the unique index includes the
  // nullable source_form_submission_id, NULL inputs (ot_booking) won't
  // conflict and supersede-first is the actual idempotency guard.
  for (const f of facts) {
    await sqlQuery(
      `INSERT INTO pac_facts
         (case_id, fact_key, fact_value, source_form_type,
          source_form_submission_id, captured_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::timestamptz)
       ON CONFLICT (case_id, fact_key, source_form_submission_id) DO NOTHING`,
      [
        caseId,
        f.fact_key,
        JSON.stringify(f.fact_value),
        sourceFormType,
        sourceFormSubmissionId,
        captured,
      ]
    );
  }
  return { written: facts.length };
}

/**
 * Look up the live case for a patient. Returns null when no case exists —
 * callers should warn-log and continue (per PCW2.1 carryover Q4).
 *
 * Latest non-cancelled case wins. Marketing handoff is the only auto-create
 * path; surgery_booking and ot_booking presume the case lifecycle started
 * elsewhere.
 */
export async function lookupCaseForPatient(
  patientThreadId: string
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id
       FROM surgical_cases
      WHERE patient_thread_id = $1
        AND state != 'cancelled'
        AND archived_at IS NULL
   ORDER BY created_at DESC
      LIMIT 1`,
    [patientThreadId]
  );
  return row?.id ?? null;
}
