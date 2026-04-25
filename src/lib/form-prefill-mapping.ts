// =============================================================================
// src/lib/form-prefill-mapping.ts
//
// Cross-form prefill registry. Used by /forms/new to merge fields from
// upstream forms into a target form's initial data.
//
// Design rules (set 25 Apr 2026 with V):
//   1. Latest target-form submission wins per-field. Source chain only fills
//      fields the target form has left blank.
//   2. Source chain: each target lists upstream forms in priority order (most
//      authoritative first). The chain is processed lowest-priority first, so
//      higher-priority sources override on a per-field basis.
//   3. Auto-match-by-key: any field with the SAME key in source's form_data
//      and target's schema gets carried over automatically. No need to list
//      common keys (surgeon_name, proposed_procedure, etc.).
//   4. Overrides: explicit FieldMapping entries handle key renames + value
//      transforms (e.g., insurance_status='insured' → payment_mode='insurance').
//   5. excludeKeys: keys present in both forms but semantically different
//      (rare).
//
// Currently wired:
//   consolidated_marketing_handoff  →  financial_counseling   (commit b4ad78f)
//   consolidated_marketing_handoff  →  surgery_booking        (this commit)
//
// Add a new mapping by extending CROSS_FORM_PREFILLS below.
// =============================================================================

export interface FieldMapping {
  /** Source field key (or array — first non-empty wins) in source form_data. */
  source: string | string[];
  /** Target field key in target form_data. */
  target: string;
  /** Optional value coercion. */
  transform?: (value: unknown, sourceData: Record<string, unknown>) => unknown;
}

export interface SourceSpec {
  /** Source form_type to pull from. */
  formType: string;
  /**
   * If true (default), any field with the same key in source form_data and
   * target form schema is carried over automatically. Disable for forms where
   * key collisions are semantically different.
   */
  autoMatch?: boolean;
  /**
   * Explicit overrides for renames (different keys for the same concept) and
   * value transforms (e.g., enum slug normalization). Override values take
   * precedence over auto-matched values for the same target key.
   */
  overrides?: FieldMapping[];
  /** Keys to NEVER carry over even when auto-match would pick them up. */
  excludeKeys?: string[];
}

export interface CrossFormPrefillSpec {
  /** Source forms in priority order (highest first). */
  sources: SourceSpec[];
}

// -----------------------------------------------------------------------------
// Value transforms
// -----------------------------------------------------------------------------

const surgeryPlannedToAdmissionType = (v: unknown): unknown => {
  // F1.B transform: MH.surgery_planned (boolean) → AA.admission_type enum.
  // true → 'surgical', false → 'medical'.
  if (v === true) return 'surgical';
  if (v === false) return 'medical';
  return undefined;
};

/**
 * Convert an MH multiselect array (e.g., ['diabetes','hypertension']) to a
 * comma-separated, title-cased string for forms whose comorbidity field is
 * a textarea. Maps known enum values to nicer labels.
 */
const COMORBIDITY_LABELS: Record<string, string> = {
  diabetes: 'Diabetes',
  cardiac_disease: 'Cardiac Disease',
  renal_disease: 'Renal Disease',
  respiratory_disease: 'Respiratory Disease',
  hypertension: 'Hypertension',
  thyroid: 'Thyroid',
  obesity: 'Obesity (BMI > 35)',
  anaemia: 'Anaemia',
  thrombocytopenia: 'Thrombocytopenia',
  none: 'None',
};
const comorbiditiesArrayToText = (v: unknown): unknown => {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return v.map(x => COMORBIDITY_LABELS[String(x)] || String(x)).join(', ');
};

/**
 * F2.B transform: FC.preauth_initiated (boolean) → OTBC.insurance_preauth_status (enum).
 * true → 'submitted' (we initiated; awaiting insurer)
 * false → 'not_started'
 */
const preauthInitiatedToStatus = (v: unknown): unknown => {
  if (v === true) return 'submitted';
  if (v === false) return 'not_started';
  return undefined;
};

const insuranceStatusToPaymentMode = (v: unknown): unknown => {
  if (v === 'insured') return 'insurance';
  if (v === 'uninsured') return 'cash';
  return undefined; // unknown / other → leave blank, user picks
};

// -----------------------------------------------------------------------------
// Mapping definitions
// -----------------------------------------------------------------------------

/**
 * Marketing Handoff → Financial Counseling.
 * MH is the only source for FC.
 */
const FC_SPEC: CrossFormPrefillSpec = {
  sources: [
    {
      formType: 'consolidated_marketing_handoff',
      autoMatch: true,
      overrides: [
        // FC's admitting_consultant is text; MH's resolved name lives in target_opd_doctor.
        { source: 'target_opd_doctor', target: 'admitting_consultant' },
        // MH's preferred_admission_date → FC's admission_date.
        { source: 'preferred_admission_date', target: 'admission_date' },
        // FC's diagnosis_procedure: prefer MH's free-text procedure (surgical),
        // fall back to clinical_summary (non-surgical).
        {
          source: ['proposed_procedure', 'clinical_summary'],
          target: 'diagnosis_procedure',
        },
        // FC's payment_mode: derive from MH's insurance_status.
        {
          source: 'insurance_status',
          target: 'payment_mode',
          transform: insuranceStatusToPaymentMode,
        },
      ],
    },
  ],
};

/**
 * Marketing Handoff → Surgery Booking.
 * Most field keys line up (auto-match handles them); two need overrides.
 */
const SB_SPEC: CrossFormPrefillSpec = {
  sources: [
    {
      formType: 'consolidated_marketing_handoff',
      autoMatch: true,
      overrides: [
        // EC1 cleanup 25 Apr 2026: removed bogus { surgery_urgency → urgency }
        // override. SB's actual key is `surgery_urgency` (not `urgency`),
        // so auto-match handles it natively. Leaving the comment so future
        // readers don't re-add it.
        // Auto-matched keys (kept as documentation):
        //   surgeon_name           (Section C)
        //   proposed_procedure     (Section C, free text)
        //   laterality             (Section C)
        //   clinical_justification (Section C)
        //   known_comorbidities    (Section C, multiselect — values share enum)
        //   comorbidities_controlled (Section C)
        //   habits                 (Section C)
        //   habits_stopped         (Section C)
        //   current_medication     (Section C)
        //   surgical_specialty     (Section C — same enum after the SB enum fix)
        //   preferred_surgery_date (Section C → SB's preferred_surgery_date)
      ],
      excludeKeys: [
        // MH's clinical_summary should not auto-fill SB.clinical_summary if SB
        // ever adds one — clinical_justification is the SB equivalent. Defensive.
      ],
    },
  ],
};

// F1 — Admission Advice ← Marketing Handoff
const AA_SPEC: CrossFormPrefillSpec = {
  sources: [
    {
      formType: 'consolidated_marketing_handoff',
      autoMatch: false, // AA's vocabulary differs entirely; do explicit-only.
      overrides: [
        // F1.B locked transforms.
        { source: 'clinical_summary', target: 'reason_for_admission' },
        {
          source: ['proposed_procedure', 'clinical_summary'],
          target: 'diagnosis',
        },
        { source: 'preferred_admission_date', target: 'preferred_date' },
        {
          source: 'known_comorbidities',
          target: 'comorbidities',
          transform: comorbiditiesArrayToText,
        },
        // MH key is current_medication; AA expects current_medications (s).
        { source: 'current_medication', target: 'current_medications' },
        {
          source: 'surgery_planned',
          target: 'admission_type',
          transform: surgeryPlannedToAdmissionType,
        },
      ],
    },
  ],
};

// F2 — OT Billing Clearance ← Financial Counseling > Marketing Handoff
const OTBC_SPEC: CrossFormPrefillSpec = {
  sources: [
    {
      // Highest priority: FC has the actual cost estimate + deposits + preauth state.
      formType: 'financial_counseling',
      autoMatch: true,
      // Auto-match catches: cost_breakdown
      overrides: [
        { source: 'estimated_cost', target: 'total_estimate' },
        { source: 'deposit_collected_amount', target: 'deposit_received' },
        { source: 'deposit_amount', target: 'advance_received' },
        // F2.B locked transform: boolean → enum.
        {
          source: 'preauth_initiated',
          target: 'insurance_preauth_status',
          transform: preauthInitiatedToStatus,
        },
        // FC.is_package ('package' | 'non_package') maps cleanly to OTBC.package_type.
        { source: 'is_package', target: 'package_type' },
      ],
    },
    {
      // Fallback: MH if FC didn't fill specific fields.
      formType: 'consolidated_marketing_handoff',
      autoMatch: true,
      overrides: [
        { source: 'estimated_total_cost', target: 'total_estimate' },
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export const CROSS_FORM_PREFILLS: Record<string, CrossFormPrefillSpec> = {
  financial_counseling: FC_SPEC,
  surgery_booking: SB_SPEC,
  admission_advice: AA_SPEC,
  ot_billing_clearance: OTBC_SPEC,
};

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

/**
 * Apply a SourceSpec to a single source form's form_data. Returns an object
 * keyed by target field, containing only fields that resolved to a non-empty
 * value.
 *
 * `targetSchemaKeys` is the set of keys defined on the target form's schema,
 * used to filter auto-matched keys (we don't want to inject keys the target
 * form doesn't even know about, since FormRenderer would ignore them).
 *
 * Behavior:
 *   1. Compute auto-match: for each key in sourceData that is also in
 *      targetSchemaKeys (and not in excludeKeys), carry the value over.
 *   2. Apply overrides on top — they can rename keys, combine multiple source
 *      keys, or transform values.
 */
export function applySourceSpec(
  sourceData: Record<string, unknown> | null | undefined,
  spec: SourceSpec,
  targetSchemaKeys: ReadonlySet<string>
): Record<string, unknown> {
  if (!sourceData) return {};
  const out: Record<string, unknown> = {};
  const exclude = new Set(spec.excludeKeys || []);

  // 1. Auto-match
  if (spec.autoMatch !== false) {
    for (const [k, v] of Object.entries(sourceData)) {
      if (exclude.has(k)) continue;
      if (!targetSchemaKeys.has(k)) continue;
      // 25 Apr 2026 (EC3 convention): keys starting with underscore are
      // computed metadata flags managed by FormRenderer (e.g.,
      // _is_surgical_case). They must NEVER be carried over via prefill —
      // FormRenderer recomputes them on every render. Authors of new forms
      // should follow the same _underscore convention for ANY computed flag.
      if (k.startsWith('_')) continue;
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
  }

  // 2. Overrides (override auto-matched values)
  for (const m of spec.overrides || []) {
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

/**
 * Walk the source chain (lowest priority first → highest), with each higher
 * priority overlaying the previous. Returns a flat object of fields to use as
 * prefill alongside the target form's own latest submission.
 */
export function buildPrefillFromChain(
  spec: CrossFormPrefillSpec,
  sourceFormDataByType: Record<string, Record<string, unknown> | null | undefined>,
  targetSchemaKeys: ReadonlySet<string>
): Record<string, unknown> {
  // Process in REVERSE priority (lowest first) so higher priorities overlay.
  const ordered = [...spec.sources].reverse();
  let merged: Record<string, unknown> = {};
  for (const src of ordered) {
    const data = sourceFormDataByType[src.formType];
    if (!data) continue;
    const slice = applySourceSpec(data, src, targetSchemaKeys);
    merged = { ...merged, ...slice };
  }
  return merged;
}

/**
 * Extract all field keys from a FormSchema's sections.
 * Defensive: handles nested sections if any.
 */
export function extractSchemaKeys(schema: {
  sections?: Array<{ fields?: Array<{ key: string }> }>;
}): Set<string> {
  const keys = new Set<string>();
  for (const sec of schema.sections || []) {
    for (const f of sec.fields || []) {
      if (f.key) keys.add(f.key);
    }
  }
  return keys;
}
