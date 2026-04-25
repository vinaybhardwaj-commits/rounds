// =============================================================================
// src/lib/form-prefill-mapping.ts
//
// Cross-form prefill mappings. Used by /forms/new to merge fields from a
// "source" form's most recent submission into a "target" form's initial
// data when no prior version of the target form exists for the patient.
//
// Precedence rule (set 25 Apr 2026 with V):
//   - Latest target-form submission wins per-field.
//   - Source-form mapping fills any field that is still blank in the target.
//
// Currently wired:
//   consolidated_marketing_handoff  →  financial_counseling
//
// Add new mappings by extending CROSS_FORM_PREFILLS below.
// =============================================================================

/**
 * One field mapping from a source form's form_data into a target form's
 * form_data.
 *
 * `source` is the source field key (or array — first non-empty wins).
 * `target` is the destination field key.
 * `transform` (optional) lets us coerce values (e.g. insurance_status='insured'
 * → payment_mode='insurance').
 */
export interface FieldMapping {
  source: string | string[];
  target: string;
  transform?: (value: unknown, sourceData: Record<string, unknown>) => unknown;
}

const insuranceStatusToPaymentMode = (v: unknown): unknown => {
  if (v === 'insured') return 'insurance';
  if (v === 'uninsured') return 'cash';
  // 'unknown' or any other value → leave blank, let the user pick.
  return undefined;
};

/**
 * Mapping from `consolidated_marketing_handoff` → `financial_counseling`.
 * Field keys come from form-registry.ts; keep this in sync if those rename.
 */
export const MH_TO_FC_MAPPING: FieldMapping[] = [
  // Admitting consultant: prefer the resolved display name (target_opd_doctor)
  // over the picker id (admitting_doctor_id) since FC's field is free-text.
  // FormRenderer auto-fills target_opd_doctor when a doctor is picked, so
  // either path is covered.
  { source: 'target_opd_doctor', target: 'admitting_consultant' },

  // Admission date.
  { source: 'preferred_admission_date', target: 'admission_date' },

  // Surgery date — only present in MH when surgery_planned=true (Section C).
  { source: 'preferred_surgery_date', target: 'surgery_date' },

  // Diagnosis / procedure: prefer the explicit procedure (surgical), fall
  // back to the clinical summary (non-surgical or surgery-not-planned cases).
  // The free-text proposed_procedure key holds the typed value when not
  // package-driven; clinical_summary is always populated.
  {
    source: ['proposed_procedure', 'clinical_summary'],
    target: 'diagnosis_procedure',
  },

  // Payer mode. insurance_status values: insured | uninsured | unknown.
  // Map: insured → 'insurance', uninsured → 'cash', unknown → leave blank.
  // FC also has 'insurance_cash' / 'corporate' / 'credit' which require
  // explicit user choice — we don't infer those.
  {
    source: 'insurance_status',
    target: 'payment_mode',
    transform: insuranceStatusToPaymentMode,
  },
];

/**
 * Registry: target form_type → { sourceFormType, mapping }.
 */
export const CROSS_FORM_PREFILLS: Record<
  string,
  { sourceFormType: string; mapping: FieldMapping[] }
> = {
  financial_counseling: {
    sourceFormType: 'consolidated_marketing_handoff',
    mapping: MH_TO_FC_MAPPING,
  },
};

/**
 * Apply a mapping to source form_data and return an object containing only the
 * target keys that resolved to a non-empty value. Caller spreads this into the
 * prefill (with target form's own values overriding).
 */
export function applyCrossFormMapping(
  sourceData: Record<string, unknown> | null | undefined,
  mapping: FieldMapping[]
): Record<string, unknown> {
  if (!sourceData) return {};
  const out: Record<string, unknown> = {};

  for (const m of mapping) {
    const sourceKeys = Array.isArray(m.source) ? m.source : [m.source];
    let raw: unknown = undefined;
    for (const k of sourceKeys) {
      const v = sourceData[k];
      if (v !== undefined && v !== null && v !== '') {
        raw = v;
        break;
      }
    }
    if (raw === undefined) continue;

    const transformed = m.transform ? m.transform(raw, sourceData) : raw;
    if (transformed === undefined || transformed === null || transformed === '') continue;
    out[m.target] = transformed;
  }

  return out;
}
