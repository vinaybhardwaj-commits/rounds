// =============================================================================
// PAC Workspace v2 — Result-to-fact mapping registry (PCW2.5)
//
// When a coordinator enters a diagnostic result (HbA1c 9.5%, BP 185/115, etc.)
// the order_type → (input shape, fact_keys) registry tells the result-entry
// API and the modal:
//   1. What input UI to render (numeric / numeric+unit / BP-pair / abnormality
//      flag / free-text / date-only)
//   2. How to validate the input
//   3. What pac_facts rows to derive from the input value
//   4. How to render the result preview on the diagnostic row
//
// Layer 3 rules from PCW2.2 then fire on the new facts at the next recompute.
// e.g. lab.hba1c.value > 8.5 → appx.hba1c.8_5_defer (REQUIRED, ASA review).
//
// Coverage policy (Q5 from PCW2.2): every order_type the engine knows about
// has at least a free-text fallback so the coordinator can always record SOMETHING.
// =============================================================================

import type { ExtractedFact } from './facts';

export type ResultInputShape =
  | 'numeric'         // single number + unit (e.g. HbA1c %, eGFR, K+)
  | 'numeric_pair'    // {systolic, diastolic} for BP
  | 'abnormality'     // boolean — was the test abnormal?
  | 'free_text'       // unstructured (catch-all)
  | 'free_text_with_abnormality'; // text findings + abnormality flag

export interface ResultMapping {
  /** Coordinator-facing label (e.g. 'HbA1c'). */
  label: string;
  /** Drives the input field shape in the modal. */
  inputShape: ResultInputShape;
  /** Unit suffix shown next to numeric input (e.g. '%', 'mmol/L'). */
  unit?: string;
  /**
   * Convert the form-submitted value into pac_facts rows. Called server-side
   * by the result-entry API. Returning [] is acceptable — the order row still
   * captures result_value, but no derived facts fire.
   */
  facts: (input: ResultInput) => ExtractedFact[];
  /** Short helper hint shown below the input. */
  helper?: string;
}

/** Discriminated union for the value submitted via the modal. */
export type ResultInput =
  | { shape: 'numeric'; value: number }
  | { shape: 'numeric_pair'; systolic: number; diastolic: number }
  | { shape: 'abnormality'; abnormal: boolean; findings?: string }
  | { shape: 'free_text'; text: string }
  | { shape: 'free_text_with_abnormality'; text?: string; abnormal: boolean };

/** Registry. Keys match `pac_orders.order_type` written by accept/already-done. */
export const RESULT_MAPPING: Record<string, ResultMapping> = {
  // ──────────────────────────────────────────────────────────────────────
  // Numeric labs — Layer 3 Appendix A rules trigger on these values.
  // ──────────────────────────────────────────────────────────────────────
  'lab.hba1c': {
    label: 'HbA1c',
    inputShape: 'numeric',
    unit: '%',
    helper: 'Optimisation threshold ≤ 8.5% per Appendix A; > 8.5 fires defer.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.hba1c.value', fact_value: { value: i.value, unit: '%' } }]
        : [],
  },
  'lab.rbs': {
    label: 'RBS / Glucose',
    inputShape: 'numeric',
    unit: 'mmol/L',
    helper: 'Periop range 6–10; > 12 fires VRIII per CPOC 2022.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.rbs.value', fact_value: { value: i.value, unit: 'mmol/L' } }]
        : [],
  },
  'lab.glucose': {
    label: 'RBS / HbA1c',
    inputShape: 'numeric',
    unit: 'mmol/L',
    helper: 'Use HbA1c (%) for stable diabetics; RBS (mmol/L) for fresh sample.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.rbs.value', fact_value: { value: i.value, unit: 'mmol/L' } }]
        : [],
  },
  'lab.tsh': {
    label: 'TSH',
    inputShape: 'numeric',
    unit: 'mIU/L',
    helper: '> 5 + thyroid history fires physician review.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.tsh.value', fact_value: { value: i.value, unit: 'mIU/L' } }]
        : [],
  },
  'lab.tft': {
    label: 'TFT',
    inputShape: 'numeric',
    unit: 'mIU/L',
    helper: 'Capture TSH value for Layer 3 evaluation.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.tsh.value', fact_value: { value: i.value, unit: 'mIU/L' } }]
        : [],
  },
  'lab.coag': {
    label: 'PT / aPTT / INR',
    inputShape: 'numeric',
    unit: 'INR',
    helper: 'Capture INR; > 1.5 + major / > 1.4 + neuraxial fires defer.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.inr.value', fact_value: { value: i.value, unit: 'INR' } }]
        : [],
  },
  'lab.inr_pt': {
    label: 'INR / PT',
    inputShape: 'numeric',
    unit: 'INR',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.inr.value', fact_value: { value: i.value, unit: 'INR' } }]
        : [],
  },
  // CBC / Hb/platelets composite — coordinator picks one main number; we
  // support Hb here. RFT eGFR + K+ are separate entries below.
  'lab.cbc': {
    label: 'CBC (Hb)',
    inputShape: 'numeric',
    unit: 'g/dL',
    helper: 'Capture Hb; < 8 fires ASA 3 + defer; < 7 fires transfuse.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.hb.value', fact_value: { value: i.value, unit: 'g/dL' } }]
        : [],
  },
  'lab.rft': {
    label: 'RFT (eGFR)',
    inputShape: 'numeric',
    unit: 'mL/min/1.73m²',
    helper: 'Capture eGFR; < 30 fires nephrology; < 15 fires ESRD ASA 3.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.egfr.value', fact_value: { value: i.value, unit: 'mL/min/1.73m2' } }]
        : [],
  },
  // K+ as a standalone numeric (typical lab panel splits this from CBC)
  'lab.potassium': {
    label: 'Serum K+',
    inputShape: 'numeric',
    unit: 'mmol/L',
    helper: '< 3 or > 6 fires correction + elective defer.',
    facts: (i) =>
      i.shape === 'numeric'
        ? [{ fact_key: 'lab.potassium.value', fact_value: { value: i.value, unit: 'mmol/L' } }]
        : [],
  },
  'lab.abg': {
    label: 'ABG',
    inputShape: 'free_text_with_abnormality',
    helper: 'Capture summary findings + flag if any value out of perioperative range.',
    facts: (i) => {
      if (i.shape !== 'free_text_with_abnormality') return [];
      const out: ExtractedFact[] = [];
      if (i.text) out.push({ fact_key: 'lab.abg.findings', fact_value: { value: i.text } });
      if (i.abnormal !== undefined) {
        out.push({ fact_key: 'lab.abg.abnormality', fact_value: { value: i.abnormal } });
      }
      return out;
    },
  },
  'lab.iron_studies': {
    label: 'Iron studies',
    inputShape: 'free_text',
    facts: (i) =>
      i.shape === 'free_text'
        ? [{ fact_key: 'lab.iron_studies.findings', fact_value: { value: i.text } }]
        : [],
  },
  'lab.serology': {
    label: 'Serology (HBsAg, anti-HCV, HIV)',
    inputShape: 'free_text_with_abnormality',
    helper: 'Flag any reactive panel.',
    facts: (i) => {
      if (i.shape !== 'free_text_with_abnormality') return [];
      const out: ExtractedFact[] = [];
      if (i.text) out.push({ fact_key: 'lab.serology.findings', fact_value: { value: i.text } });
      out.push({ fact_key: 'lab.serology.abnormality', fact_value: { value: i.abnormal } });
      return out;
    },
  },
  'lab.urine_rm': {
    label: 'Urine R/M',
    inputShape: 'free_text_with_abnormality',
    facts: (i) =>
      i.shape === 'free_text_with_abnormality'
        ? [
            ...(i.text ? [{ fact_key: 'lab.urine_rm.findings' as string, fact_value: { value: i.text } }] : []),
            { fact_key: 'lab.urine_rm.abnormality', fact_value: { value: i.abnormal } },
          ]
        : [],
  },
  'lab.lipid': {
    label: 'Lipid profile',
    inputShape: 'free_text',
    facts: (i) =>
      i.shape === 'free_text'
        ? [{ fact_key: 'lab.lipid.findings', fact_value: { value: i.text } }]
        : [],
  },
  'lab.cultures': {
    label: 'Cultures',
    inputShape: 'free_text_with_abnormality',
    helper: 'Flag if positive.',
    facts: (i) =>
      i.shape === 'free_text_with_abnormality'
        ? [
            ...(i.text ? [{ fact_key: 'lab.cultures.findings' as string, fact_value: { value: i.text } }] : []),
            { fact_key: 'lab.cultures.positive', fact_value: { value: i.abnormal } },
          ]
        : [],
  },
  'lab.coag_workup': {
    label: 'Detailed coagulation workup',
    inputShape: 'free_text',
    facts: (i) =>
      i.shape === 'free_text'
        ? [{ fact_key: 'lab.coag_workup.findings', fact_value: { value: i.text } }]
        : [],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Blood pressure — pair input fires the bp Layer 3 rules.
  // ──────────────────────────────────────────────────────────────────────
  'lab.bp': {
    label: 'Blood Pressure',
    inputShape: 'numeric_pair',
    unit: 'mmHg',
    helper: '> 180/110 fires defer; < 160/100 marks target met.',
    facts: (i) => {
      if (i.shape !== 'numeric_pair') return [];
      return [
        { fact_key: 'lab.bp_systolic.value', fact_value: { value: i.systolic, unit: 'mmHg' } },
        { fact_key: 'lab.bp_diastolic.value', fact_value: { value: i.diastolic, unit: 'mmHg' } },
      ];
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Imaging — abnormality flag drives Layer 1 conditional rules
  // (cardiology consult, dobutamine stress).
  // ──────────────────────────────────────────────────────────────────────
  'imaging.ecg': {
    label: 'ECG',
    inputShape: 'free_text_with_abnormality',
    helper: 'Flag abnormality to fire cardiology consult + stress test.',
    facts: (i) => {
      if (i.shape !== 'free_text_with_abnormality') return [];
      const out: ExtractedFact[] = [
        { fact_key: 'imaging.ecg.abnormality', fact_value: { value: i.abnormal } },
      ];
      if (i.text) out.push({ fact_key: 'imaging.ecg.findings', fact_value: { value: i.text } });
      return out;
    },
  },
  'imaging.echo': {
    label: '2D Echo',
    inputShape: 'free_text_with_abnormality',
    helper: 'Flag abnormality + capture EF if known.',
    facts: (i) => {
      if (i.shape !== 'free_text_with_abnormality') return [];
      const out: ExtractedFact[] = [
        { fact_key: 'imaging.echo.abnormality', fact_value: { value: i.abnormal } },
      ];
      if (i.text) out.push({ fact_key: 'imaging.echo.findings', fact_value: { value: i.text } });
      return out;
    },
  },
  'imaging.cxr': {
    label: 'Chest X-Ray',
    inputShape: 'free_text_with_abnormality',
    facts: (i) =>
      i.shape === 'free_text_with_abnormality'
        ? [
            { fact_key: 'imaging.cxr.abnormality', fact_value: { value: i.abnormal } },
            ...(i.text ? [{ fact_key: 'imaging.cxr.findings' as string, fact_value: { value: i.text } }] : []),
          ]
        : [],
  },
  'imaging.dobutamine_stress_echo': {
    label: 'Dobutamine stress echo',
    inputShape: 'free_text_with_abnormality',
    facts: (i) =>
      i.shape === 'free_text_with_abnormality'
        ? [
            { fact_key: 'imaging.dobutamine_stress.abnormality', fact_value: { value: i.abnormal } },
            ...(i.text ? [{ fact_key: 'imaging.dobutamine_stress.findings' as string, fact_value: { value: i.text } }] : []),
          ]
        : [],
  },
  'imaging.ct_thorax_plain': {
    label: 'CT Thorax (plain)',
    inputShape: 'free_text_with_abnormality',
    facts: (i) =>
      i.shape === 'free_text_with_abnormality'
        ? [
            { fact_key: 'imaging.ct_thorax.abnormality', fact_value: { value: i.abnormal } },
            ...(i.text ? [{ fact_key: 'imaging.ct_thorax.findings' as string, fact_value: { value: i.text } }] : []),
          ]
        : [],
  },
  'imaging.stress_test': {
    label: 'Cardiac stress testing',
    inputShape: 'free_text_with_abnormality',
    facts: (i) =>
      i.shape === 'free_text_with_abnormality'
        ? [
            { fact_key: 'cardiac.stress_test.abnormality', fact_value: { value: i.abnormal } },
            ...(i.text ? [{ fact_key: 'cardiac.stress_test.findings' as string, fact_value: { value: i.text } }] : []),
          ]
        : [],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Catch-all for plan-style "orders" and unrecognized order_types.
  // The result-entry endpoint will fall back to free-text storage in
  // pac_orders.result_value with no derived facts.
  // ──────────────────────────────────────────────────────────────────────
};

/** Look up a mapping; returns undefined if order_type is not in the registry. */
export function getResultMapping(orderType: string): ResultMapping | undefined {
  return RESULT_MAPPING[orderType];
}

/** Free-text fallback for any order_type not in the registry. */
export const FREE_TEXT_FALLBACK: ResultMapping = {
  label: 'Result',
  inputShape: 'free_text',
  helper: 'Free-text result storage. Type-specific entry not configured.',
  facts: () => [],
};
