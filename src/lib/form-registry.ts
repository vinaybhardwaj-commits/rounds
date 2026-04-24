// ============================================
// Rounds — Form Engine Registry (Step 4.1)
// Declarative schema definitions for all 13
// form types. Each schema defines fields,
// validation, sections, and readiness items.
// ============================================

import type { FormType, UserRole } from '@/types';

// ============================================
// SCHEMA TYPES
// ============================================

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'multiselect'
  | 'checkbox'    // single boolean
  | 'radio'
  | 'phone'
  | 'email'
  | 'file';       // multi-file upload via Vercel Blob (Sprint 1 Day 3)

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldValidation {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;         // regex string
  patternMessage?: string;  // user-friendly error for pattern
  requiredIf?: {            // conditional required
    field: string;
    operator: 'eq' | 'neq' | 'in' | 'truthy';
    value?: unknown;
  };
}

export interface ReadinessItemDef {
  /** The readiness item name (shown in tracker) */
  itemName: string;
  /** Category for grouping: consent, investigation, clearance, billing, nursing, logistics */
  category: string;
  /** Which role is responsible for confirming this */
  responsibleRole: UserRole | string;
  /** Hours from form submission until this is overdue */
  slaHours?: number;
  /** Optional description shown in readiness tracker */
  description?: string;
}

export interface FormField {
  /** Unique key within the form (used as form_data key) */
  key: string;
  /** Display label */
  label: string;
  /** Field input type */
  type: FieldType;
  /** Placeholder text */
  placeholder?: string;
  /** Help text shown below the field */
  helpText?: string;
  /** Options for select/multiselect/radio */
  options?: SelectOption[];
  /** Validation rules */
  validation?: FieldValidation;
  /** Default value */
  defaultValue?: unknown;
  /** If this field is a readiness checkpoint, define it here */
  readinessItem?: ReadinessItemDef;
  /** Show this field only when condition is met */
  visibleWhen?: {
    field: string;
    operator: 'eq' | 'neq' | 'in' | 'truthy';
    value?: unknown;
  };
  /** Width hint: 'full' (default), 'half', 'third' */
  width?: 'full' | 'half' | 'third';
  /** Render as read-only input (user cannot edit). Value comes from defaultValue or initialData. */
  readonly?: boolean;
}

export interface FormSection {
  /** Section ID */
  id: string;
  /** Section heading */
  title: string;
  /** Optional section description */
  description?: string;
  /** Fields in this section */
  fields: FormField[];
}

export interface FormSchema {
  /** Must match the FormType union */
  formType: FormType;
  /** Human-readable form title */
  title: string;
  /** Short description of when/why to use this form */
  description: string;
  /** Schema version (increment when fields change) */
  version: number;
  /** Which patient journey stage(s) this form applies to */
  stages: string[];
  /** Who typically fills out this form */
  submitterRoles: (UserRole | string)[];
  /** Whether this form requires a patient thread to be linked */
  requiresPatient: boolean;
  /** Sections containing the form fields */
  sections: FormSection[];
}

// ============================================
// HELPER: Extract all fields from a schema
// ============================================

export function getAllFields(schema: FormSchema): FormField[] {
  return schema.sections.flatMap((s) => s.fields);
}

// ============================================
// HELPER: Extract readiness items from schema
// ============================================

export function getReadinessItemDefs(schema: FormSchema): (ReadinessItemDef & { fieldKey: string })[] {
  return getAllFields(schema)
    .filter((f) => f.readinessItem)
    .map((f) => ({ ...f.readinessItem!, fieldKey: f.key }));
}

// ============================================
// HELPER: Validate form data against schema
// ============================================

export interface ValidationError {
  field: string;
  message: string;
}

export function validateFormData(
  schema: FormSchema,
  data: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const allFields = getAllFields(schema);

  for (const field of allFields) {
    const value = data[field.key];
    const v = field.validation;
    if (!v) continue;

    // Check visibility condition — skip validation if field is hidden
    if (field.visibleWhen) {
      const condValue = data[field.visibleWhen.field];
      const met = evaluateCondition(condValue, field.visibleWhen.operator, field.visibleWhen.value);
      if (!met) continue;
    }

    // Required check — checkboxes must be true when required (isEmpty returns false for false).
    const isRequired = v.required || evaluateRequiredIf(v.requiredIf, data);
    if (isRequired) {
      const isUnsetOrFalse = isEmpty(value) || (field.type === 'checkbox' && value !== true);
      if (isUnsetOrFalse) {
        const msg = field.type === 'checkbox'
          ? `You must confirm: ${field.label}`
          : `${field.label} is required`;
        errors.push({ field: field.key, message: msg });
        continue;
      }
    }

    // Skip further checks if empty and not required
    if (isEmpty(value)) continue;

    // Number range
    if (field.type === 'number' && typeof value === 'number') {
      if (v.min !== undefined && value < v.min) {
        errors.push({ field: field.key, message: `${field.label} must be at least ${v.min}` });
      }
      if (v.max !== undefined && value > v.max) {
        errors.push({ field: field.key, message: `${field.label} must be at most ${v.max}` });
      }
    }

    // String length
    if (typeof value === 'string') {
      if (v.minLength !== undefined && value.length < v.minLength) {
        errors.push({ field: field.key, message: `${field.label} must be at least ${v.minLength} characters` });
      }
      if (v.maxLength !== undefined && value.length > v.maxLength) {
        errors.push({ field: field.key, message: `${field.label} must be at most ${v.maxLength} characters` });
      }
      if (v.pattern) {
        const re = new RegExp(v.pattern);
        if (!re.test(value)) {
          errors.push({ field: field.key, message: v.patternMessage || `${field.label} format is invalid` });
        }
      }
    }
  }

  return errors;
}

// ============================================
// HELPER: Compute completion score
// ============================================

export function computeCompletionScore(
  schema: FormSchema,
  data: Record<string, unknown>
): number {
  const allFields = getAllFields(schema);
  // Only count fields that have validation.required or readinessItem
  const scorableFields = allFields.filter(
    (f) => f.validation?.required || f.readinessItem
  );
  if (scorableFields.length === 0) return 1.0;

  let filled = 0;
  for (const field of scorableFields) {
    if (!isEmpty(data[field.key])) filled++;
  }
  return Math.round((filled / scorableFields.length) * 100) / 100;
}

// ============================================
// INTERNAL HELPERS
// ============================================

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function evaluateCondition(
  fieldValue: unknown,
  operator: 'eq' | 'neq' | 'in' | 'truthy',
  compareValue?: unknown
): boolean {
  switch (operator) {
    case 'eq': return fieldValue === compareValue;
    case 'neq': return fieldValue !== compareValue;
    case 'in': return Array.isArray(compareValue) && compareValue.includes(fieldValue);
    case 'truthy': return !!fieldValue;
    default: return false;
  }
}

function evaluateRequiredIf(
  condition: FieldValidation['requiredIf'],
  data: Record<string, unknown>
): boolean {
  if (!condition) return false;
  const fieldValue = data[condition.field];
  return evaluateCondition(fieldValue, condition.operator, condition.value);
}

// ============================================
// FORM SCHEMAS — 2 PRIORITY FORMS FIRST
// (remaining 11 have skeleton schemas)
// ============================================

// -------------------------------------------
// 1. MARKETING → CUSTOMER CARE HANDOFF
// The first handoff in the patient journey.
// Consolidated Marketing Handoff (R.2a)
// Three-section form: Clinical Handoff + Financial Counseling (first pass) + Surgery Booking
// Routes intelligently to patient thread, CC dept channel, and OT dept channel.
// -------------------------------------------

export const CONSOLIDATED_MARKETING_HANDOFF: FormSchema = {
  formType: 'consolidated_marketing_handoff',
  title: 'Marketing Handoff',
  description: 'Hand off a patient lead from Marketing to Customer Care for admission coordination.',
  version: 2,
  stages: ['opd', 'pre_admission'],
  submitterRoles: ['marketing_executive', 'marketing', 'super_admin'],
  requiresPatient: true,
  sections: [
    // ── Section A: Clinical Handoff ──
    {
      id: 'clinical_handoff',
      title: 'Section A — Clinical Handoff',
      description: 'Clinical summary, triage level, and patient context for the care team.',
      fields: [
        // Sprint 1 Day 3 — target_hospital drives multi-hospital routing (Decision M7, Picker B).
        // Options are placeholder; FormRenderer populates dynamically from active hospitals.
        { key: 'target_hospital', label: 'Target Hospital', type: 'select', validation: { required: true }, options: [
          { value: 'ehrc', label: 'EHRC — Race Course Road' },
          { value: 'ehbr', label: 'EHBR — Brookefield' },
          { value: 'ehin', label: 'EHIN — Indiranagar' },
        ], helpText: 'Which hospital should this patient be routed to? (Auto-fills based on admitting doctor.)', width: 'half' },
        { key: 'clinical_summary', label: 'Clinical Summary', type: 'textarea', validation: { required: true, maxLength: 2000 }, helpText: '2–3 sentence clinical context for downstream teams', placeholder: 'Brief clinical context: what the patient needs, history, current status' },
        // Sprint 1 Day 4 — admitting_doctor_id is the Picker B driver. Options are
        // populated dynamically by FormRenderer from /api/doctors. When a doctor is
        // picked, FormRenderer auto-fills target_opd_doctor (display name) and
        // target_hospital (primary affiliation) from /api/doctors/[id]/affiliations.
        // 24 Apr 2026 reorder: moved picker above priority so picker + manual-entry
        // (target_opd_doctor) render on the same row when 'Other' is selected. User
        // expectation from the 22 Apr demo: manual entry 'to the side' of the picker.
        { key: 'admitting_doctor_id', label: 'Admitting Doctor (picker)', type: 'select', validation: { required: true }, options: [], helpText: 'Pick a known doctor to auto-fill the name and hospital. Or leave blank and type manually below.', width: 'half' },
        // Sprint 1 Day 3: label changed from "Target OPD Doctor" to "Admitting Doctor (OPD or IPD)".
        // Field key unchanged for backward compatibility with historic submissions.
        // Sprint 1 Day 4: still required, but auto-filled by the picker above when used.
        // 24 Apr 2026: now paired with admitting_doctor_id on the same row; hidden by
        // FormRenderer when a real doctor is picked, visible when 'Other' or unset.
        { key: 'target_opd_doctor', label: 'Admitting Doctor (OPD or IPD)', type: 'text', validation: { required: true }, placeholder: 'Consulting doctor name', width: 'half' },
        { key: 'priority', label: 'Priority', type: 'select', validation: { required: true }, options: [
          { value: 'routine', label: 'Routine' },
          { value: 'urgent', label: 'Urgent' },
          { value: 'emergency', label: 'Emergency' },
        ], width: 'half' },
        { key: 'target_department', label: 'Target Department', type: 'text', validation: { required: true }, placeholder: 'e.g. Orthopaedics, General Surgery', width: 'half' },
        { key: 'insurance_status', label: 'Insurance Status', type: 'select', validation: { required: true }, options: [
          { value: 'insured', label: 'Insured' },
          { value: 'uninsured', label: 'Uninsured' },
          { value: 'unknown', label: 'Unknown' },
        ], width: 'half' },
        { key: 'patient_objections', label: 'Patient Objections / Concerns', type: 'textarea', placeholder: 'Hesitations, competitive concerns, family objections' },
        { key: 'preferred_admission_date', label: 'Preferred Admission Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'special_notes', label: 'Special Notes', type: 'textarea', placeholder: 'Anything else for the care team: VIP, language preference, accessibility needs' },
        // Sprint 1 Day 3 — multi-file upload. Stored in form_data as an array of {url, filename, size, contentType}.
        // FormRenderer posts each file to /api/files/upload (Vercel Blob) before form submit.
        { key: 'attachments', label: 'Attachments', type: 'file', helpText: 'Insurance card, prior reports, referral letters. PDFs, images, Office docs up to 50MB each.' },
      ],
    },

    // ── Section B: Financial Counseling (First Pass) ──
    {
      id: 'financial_counseling_first_pass',
      title: 'Section B — Financial Counseling (First Pass)',
      description: 'Marketing\'s initial financial assessment. Fields left blank will be flagged as "Pending — CC to complete."',
      fields: [
        // Sprint 1 Day 3 — room category fields (billed vs allocated, PRD §3.7).
        { key: 'billing_room_category', label: 'Billing Room Category', type: 'select', validation: { required: true }, options: [
          { value: 'general', label: 'General Ward' },
          { value: 'semi_private', label: 'Semi-Private' },
          { value: 'private', label: 'Private' },
          { value: 'suite', label: 'Suite' },
        ], helpText: 'Which room tier is being billed (insurance / package)', width: 'half' },
        { key: 'allocated_room_category', label: 'Allocated Room Category', type: 'select', validation: { required: true }, options: [
          { value: 'general', label: 'General Ward' },
          { value: 'semi_private', label: 'Semi-Private' },
          { value: 'private', label: 'Private' },
          { value: 'suite', label: 'Suite' },
        ], helpText: 'Actual room category allocated to the patient (may differ from billing)', width: 'half' },
        // Sprint 1 Day 3 — lead_source replaces implicit tracking in notes.
        // Practo has special handling: may imply flat-fee pricing (PRD §3.7).
        { key: 'lead_source', label: 'Lead Source', type: 'select', validation: { required: true }, options: [
          { value: 'lsq', label: 'LSQ / LeadSquared' },
          { value: 'practo', label: 'Practo' },
        ], helpText: 'Practo leads auto-apply the PRACTO300 coupon (Rs 300 flat discount).', width: 'half' },
        // Sprint 1 Day 3 — coupon / discount. discount_pct bounded 0–100; FormRenderer can auto-apply 100 for Practo.
        { key: 'coupon_code', label: 'Coupon Code', type: 'text', placeholder: 'e.g. PRACTO25, SUMMER10', width: 'half' },
        { key: 'discount_pct', label: 'Discount %', type: 'number', validation: { min: 0, max: 100 }, placeholder: '0–100', width: 'half' },
        { key: 'insurer_name', label: 'Insurer Name', type: 'text', visibleWhen: { field: 'insurance_status', operator: 'eq', value: 'insured' }, validation: { required: true }, placeholder: 'Insurance company name', width: 'half' },
        { key: 'policy_member_id', label: 'Policy / Member ID', type: 'text', visibleWhen: { field: 'insurance_status', operator: 'eq', value: 'insured' }, validation: { required: true }, placeholder: 'Policy number for TPA lookup', width: 'half' },
        { key: 'insurance_tpa_details', label: 'Insurance & TPA Details', type: 'textarea', visibleWhen: { field: 'insurance_status', operator: 'eq', value: 'insured' }, validation: { required: true }, placeholder: 'TPA name, network status, sub-limits, any known exclusions' },
        { key: 'package_name', label: 'Package Name', type: 'text', validation: { required: true }, placeholder: 'e.g. Appendicectomy with 3-night stay', width: 'half' },
        { key: 'estimated_total_cost', label: 'Estimated Total Cost (₹)', type: 'number', validation: { required: true }, placeholder: 'Total estimate in INR', width: 'half' },
        { key: 'insurance_coverage_amount', label: 'Insurance Coverage Amount (₹)', type: 'number', visibleWhen: { field: 'insurance_status', operator: 'eq', value: 'insured' }, validation: { required: true }, placeholder: 'Covered amount from policy', width: 'half' },
        { key: 'copay_patient_responsibility', label: 'Co-pay / Patient Responsibility (₹)', type: 'number', visibleWhen: { field: 'insurance_status', operator: 'eq', value: 'insured' }, validation: { required: true }, placeholder: 'Patient out-of-pocket amount', width: 'half' },
        { key: 'payment_mode', label: 'Payment Mode', type: 'select', validation: { required: true }, options: [
          { value: 'cash', label: 'Cash' },
          { value: 'insurance', label: 'Insurance' },
          { value: 'pdc', label: 'PDC (Post-Dated Cheque)' },
          { value: 'emi', label: 'EMI' },
          { value: 'mixed', label: 'Mixed' },
        ], width: 'half' },
        { key: 'deposit_required', label: 'Deposit Required (₹)', type: 'number', validation: { required: true }, placeholder: 'Amount to collect before admission', width: 'half' },
        { key: 'deposit_collected', label: 'Deposit Already Collected?', type: 'checkbox' },
        { key: 'deposit_collected_amount', label: 'Deposit Amount Collected (₹)', type: 'number', visibleWhen: { field: 'deposit_collected', operator: 'truthy' }, validation: { required: true }, placeholder: 'Actual deposit received', width: 'half' },
        // 24 Apr 2026 — when deposit already collected, marketing must upload proof (receipt/UPI screenshot/PDF).
        { key: 'deposit_receipt', label: 'Deposit Receipt', type: 'file', visibleWhen: { field: 'deposit_collected', operator: 'truthy' }, validation: { required: true }, helpText: 'Upload the receipt, UPI screenshot, or PDF proving the deposit was collected.' },
        { key: 'patient_family_acknowledged', label: 'Patient / family acknowledged costs', type: 'checkbox', validation: { required: true }, helpText: 'Timestamp is auto-logged on submission' },
        { key: 'counselor_notes', label: 'Counselor Notes', type: 'textarea', placeholder: 'Context from the financial discussion — concerns, negotiation, special arrangements' },
        // 24 Apr 2026 — who performed the counselling. Auto-filled from the logged-in user at form mount; read-only.
        { key: 'counsellor_name', label: 'Counsellor', type: 'text', readonly: true, validation: { required: true }, helpText: 'Auto-filled with your name from your login. If this is wrong, contact admin.' },
      ],
    },

    // ── Section C: Surgery Booking ──
    {
      id: 'surgery_booking',
      title: 'Section C — Surgery Booking',
      description: 'Surgical plan, clinical risk profile, and OT scheduling. Fields left blank are flagged "Pending — OT/Anaesthesia to complete."',
      fields: [
        // Sprint 1 Day 3 — surgery_planned drives draft auto-creation (Decision: Framing B).
        // If false, Section C is hidden and no surgical_cases row is created on submit.
        { key: 'surgery_planned', label: 'Surgery planned for this patient?', type: 'checkbox', defaultValue: true, helpText: 'Uncheck if this is an intake-only handoff (no surgery yet). Hides the surgical plan below.' },
        { key: 'surgeon_name', label: 'Surgeon Name', type: 'text', visibleWhen: { field: 'surgery_planned', operator: 'truthy' }, validation: { required: true }, placeholder: 'Who will operate (may differ from OPD doctor)', width: 'half' },
        { key: 'surgical_specialty', label: 'Surgical Specialty', type: 'select', validation: { required: true }, options: [
          { value: 'general_surgery', label: 'General Surgery' },
          { value: 'orthopaedics', label: 'Orthopaedics' },
          { value: 'ent', label: 'ENT' },
          { value: 'urology', label: 'Urology' },
          { value: 'gynaecology', label: 'Gynaecology' },
          { value: 'ophthalmology', label: 'Ophthalmology' },
          { value: 'neurosurgery', label: 'Neurosurgery' },
          { value: 'cardiothoracic', label: 'Cardiothoracic' },
          { value: 'plastic_surgery', label: 'Plastic Surgery' },
          { value: 'paediatric_surgery', label: 'Paediatric Surgery' },
          { value: 'vascular_surgery', label: 'Vascular Surgery' },
          { value: 'gastro_surgery', label: 'GI / Laparoscopic Surgery' },
          { value: 'other', label: 'Other' },
        ], width: 'half' },
        { key: 'proposed_procedure', label: 'Proposed Procedure', type: 'text', validation: { required: true }, placeholder: 'What surgery is planned' },
        { key: 'laterality', label: 'Laterality', type: 'select', validation: { required: true }, options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'bilateral', label: 'Bilateral' },
          { value: 'na', label: 'N/A' },
        ], width: 'half' },
        { key: 'surgery_urgency', label: 'Urgency', type: 'select', validation: { required: true }, options: [
          { value: 'elective', label: 'Elective' },
          { value: 'urgent', label: 'Urgent' },
          { value: 'emergency', label: 'Emergency' },
        ], width: 'half' },
        { key: 'clinical_justification', label: 'Clinical Justification', type: 'textarea', placeholder: 'Indication for surgery' },
        { key: 'known_comorbidities', label: 'Known Co-morbidities', type: 'multiselect', options: [
          { value: 'diabetes', label: 'Diabetes' },
          { value: 'cardiac_disease', label: 'Cardiac Disease' },
          { value: 'renal_disease', label: 'Renal Disease' },
          { value: 'respiratory_disease', label: 'Respiratory Disease' },
          { value: 'hypertension', label: 'Hypertension' },
          { value: 'thyroid', label: 'Thyroid' },
          { value: 'obesity', label: 'Obesity (BMI > 35)' },
          { value: 'anaemia', label: 'Anaemia' },
          { value: 'thrombocytopenia', label: 'Thrombocytopenia' },
          { value: 'none', label: 'None' },
        ] },
        { key: 'comorbidities_controlled', label: 'Are co-morbidities well controlled?', type: 'select', options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'unknown', label: 'Unknown' },
        ], helpText: 'Diabetes: HbA1c < 8, RBS < 180 · BP: < 150/100 on ≥2 readings · TSH: < 5 · Heart disease/CVD: cardiology clearance obtained · Renal: eGFR > 60 · BMI > 35: documented · Hb > 8 · Platelets > 80,000 · Respiratory: SpO2 > 94% on room air · Fever: resolved > 1 week ago', width: 'half' },
        { key: 'habits', label: 'Habits', type: 'multiselect', options: [
          { value: 'smoking', label: 'Smoking' },
          { value: 'alcohol', label: 'Alcohol' },
          { value: 'tobacco_chewing', label: 'Tobacco Chewing' },
          { value: 'none', label: 'None' },
        ], width: 'half' },
        { key: 'habits_stopped', label: 'Habits stopped 3+ days ago?', type: 'select', visibleWhen: { field: 'habits', operator: 'truthy' }, options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ], width: 'half' },
        { key: 'current_medication', label: 'Current Medication', type: 'textarea', placeholder: 'Active prescriptions, especially anticoagulants' },
        { key: 'pac_status', label: 'PAC Status', type: 'select', validation: { required: true }, options: [
          { value: 'not_done', label: 'Not Done' },
          { value: 'done_fit', label: 'Done — Fit' },
          { value: 'done_unfit', label: 'Done — Unfit' },
          { value: 'pending_review', label: 'Pending Review' },
        ], width: 'half' },
        { key: 'preferred_surgery_date', label: 'Preferred Surgery Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'preferred_surgery_time', label: 'Preferred Surgery Time', type: 'select', validation: { required: true }, options: [
          { value: 'morning', label: 'Morning' },
          { value: 'afternoon', label: 'Afternoon' },
          { value: 'no_preference', label: 'No Preference' },
        ], width: 'half' },
        { key: 'support_requirements', label: 'Support Requirements', type: 'textarea', placeholder: 'ICU bed, ventilator, blood products, etc.' },
        { key: 'special_requirements', label: 'Special Requirements', type: 'textarea', validation: { required: true }, placeholder: 'Implants, consumables, special equipment' },
      ],
    },

    // ── Handoff Confirmation ──
    {
      id: 'handoff_confirmation',
      title: 'Handoff Confirmation',
      description: 'Confirm before submitting. This will route information to the CC team and OT team automatically.',
      fields: [
        { key: 'check_contact_verified', label: 'Patient contact information verified', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Contact info verified', category: 'consent', responsibleRole: 'marketing_executive', slaHours: 1 } },
        { key: 'check_docs_collected', label: 'Relevant documents collected (insurance card, referral letter, reports)', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Documents collected', category: 'investigation', responsibleRole: 'marketing_executive', slaHours: 2 } },
        { key: 'check_cost_discussed', label: 'Approximate cost / package info shared with patient', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Cost estimate shared', category: 'billing', responsibleRole: 'marketing_executive', slaHours: 4 } },
      ],
    },
  ],
};

// -------------------------------------------
// 1b. MARKETING → CC HANDOFF (Legacy)
// Marketing team fills this when handing off
// a patient lead to Customer Care.
// -------------------------------------------

export const MARKETING_CC_HANDOFF: FormSchema = {
  formType: 'marketing_cc_handoff',
  title: 'Marketing → Customer Care Handoff',
  description: 'Hand off a patient lead from Marketing to Customer Care for admission coordination.',
  version: 1,
  stages: ['opd', 'pre_admission'],
  submitterRoles: ['marketing_executive', 'marketing', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'patient_info',
      title: 'Patient Information',
      fields: [
        { key: 'patient_name', label: 'Patient Name', type: 'text', validation: { required: true, maxLength: 200 }, width: 'half' },
        { key: 'patient_phone', label: 'Phone Number', type: 'phone', validation: { required: true, pattern: '^[6-9]\\d{9}$', patternMessage: 'Enter a valid 10-digit mobile number' }, width: 'half' },
        { key: 'patient_email', label: 'Email', type: 'email', width: 'half' },
        { key: 'patient_age', label: 'Age', type: 'number', validation: { min: 0, max: 120 }, width: 'third' },
        { key: 'patient_gender', label: 'Gender', type: 'select', options: [
          { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' },
        ], width: 'third' },
        { key: 'patient_city', label: 'City', type: 'text', width: 'third' },
      ],
    },
    {
      id: 'lead_info',
      title: 'Lead Source & Referral',
      fields: [
        { key: 'lead_source', label: 'Lead Source', type: 'select', validation: { required: true }, options: [
          { value: 'even_app', label: 'Even App' }, { value: 'practo', label: 'Practo' },
          { value: 'google', label: 'Google / SEO' }, { value: 'social_media', label: 'Social Media' },
          { value: 'referral_doctor', label: 'Doctor Referral' }, { value: 'referral_patient', label: 'Patient Referral' },
          { value: 'walk_in', label: 'Walk-in' }, { value: 'camp', label: 'Health Camp' },
          { value: 'corporate', label: 'Corporate Tie-up' }, { value: 'other', label: 'Other' },
        ], width: 'half' },
        { key: 'lead_source_detail', label: 'Source Details', type: 'text', placeholder: 'e.g. Referring doctor name, campaign name', width: 'half' },
        { key: 'even_member_id', label: 'Even Member ID', type: 'text', placeholder: 'If patient is an Even App member', width: 'half' },
        { key: 'uhid', label: 'UHID (if existing patient)', type: 'text', width: 'half' },
      ],
    },
    {
      id: 'clinical_info',
      title: 'Clinical Summary',
      fields: [
        { key: 'primary_complaint', label: 'Primary Complaint / Reason for Visit', type: 'textarea', validation: { required: true, maxLength: 1000 }, helpText: 'Brief description of what the patient needs' },
        { key: 'referred_department', label: 'Referred Department', type: 'text', validation: { required: true }, width: 'half' },
        { key: 'referred_consultant', label: 'Referred Consultant', type: 'text', width: 'half' },
        { key: 'has_insurance', label: 'Has Insurance?', type: 'radio', options: [
          { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' },
        ], width: 'half' },
        { key: 'insurance_provider', label: 'Insurance Provider', type: 'text', visibleWhen: { field: 'has_insurance', operator: 'eq', value: 'yes' }, width: 'half' },
        { key: 'insurance_id', label: 'Insurance / Policy Number', type: 'text', visibleWhen: { field: 'has_insurance', operator: 'eq', value: 'yes' }, width: 'half' },
      ],
    },
    {
      id: 'urgency',
      title: 'Priority & Notes',
      fields: [
        { key: 'urgency_level', label: 'Urgency', type: 'select', validation: { required: true }, options: [
          { value: 'routine', label: 'Routine' }, { value: 'soon', label: 'Soon (within 48h)' },
          { value: 'urgent', label: 'Urgent (within 24h)' }, { value: 'emergency', label: 'Emergency (immediate)' },
        ], width: 'half' },
        { key: 'preferred_date', label: 'Preferred Appointment Date', type: 'date', width: 'half' },
        { key: 'marketing_notes', label: 'Additional Notes for Customer Care', type: 'textarea', placeholder: 'Any special instructions, patient preferences, VIP notes, etc.', validation: { maxLength: 2000 } },
      ],
    },
    {
      id: 'handoff_checklist',
      title: 'Handoff Checklist',
      description: 'Confirm these items before handing off to Customer Care.',
      fields: [
        { key: 'check_contact_verified', label: 'Patient contact information verified', type: 'checkbox',
          readinessItem: { itemName: 'Contact info verified', category: 'consent', responsibleRole: 'marketing_executive', slaHours: 1 } },
        { key: 'check_docs_collected', label: 'Relevant documents collected (insurance card, referral letter, reports)', type: 'checkbox',
          readinessItem: { itemName: 'Documents collected', category: 'investigation', responsibleRole: 'marketing_executive', slaHours: 2 } },
        { key: 'check_appointment_discussed', label: 'Appointment timing discussed with patient', type: 'checkbox',
          readinessItem: { itemName: 'Appointment timing discussed', category: 'logistics', responsibleRole: 'marketing_executive', slaHours: 1 } },
        { key: 'check_cost_estimate_shared', label: 'Approximate cost / package info shared', type: 'checkbox',
          readinessItem: { itemName: 'Cost estimate shared', category: 'billing', responsibleRole: 'marketing_executive', slaHours: 4 } },
      ],
    },
  ],
};

// -------------------------------------------
// 2. SURGERY POSTING
// Consultant posts a patient for surgery.
// Generates 16 readiness items.
// -------------------------------------------

export const SURGERY_POSTING: FormSchema = {
  formType: 'surgery_posting',
  title: 'Surgery Posting',
  description: 'Post a patient for surgery. Generates a readiness checklist that must be confirmed before the OT slot is locked.',
  version: 1,
  stages: ['admitted', 'pre_op'],
  submitterRoles: ['clinical_care', 'department_head', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'surgery_details',
      title: 'Surgery Details',
      fields: [
        { key: 'surgery_name', label: 'Surgery / Procedure Name', type: 'text', validation: { required: true, maxLength: 300 } },
        { key: 'surgery_type', label: 'Surgery Type', type: 'select', validation: { required: true }, options: [
          { value: 'elective', label: 'Elective' }, { value: 'emergency', label: 'Emergency' },
          { value: 'daycare', label: 'Day Care' },
        ], width: 'half' },
        { key: 'laterality', label: 'Laterality', type: 'select', options: [
          { value: 'na', label: 'N/A' }, { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' }, { value: 'bilateral', label: 'Bilateral' },
        ], width: 'half' },
        { key: 'preferred_date', label: 'Preferred Surgery Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'preferred_time', label: 'Preferred Time Slot', type: 'select', options: [
          { value: 'morning_first', label: 'First Case (8 AM)' }, { value: 'morning', label: 'Morning (8–12)' },
          { value: 'afternoon', label: 'Afternoon (12–4)' }, { value: 'evening', label: 'Evening (4–8)' },
        ], width: 'half' },
        { key: 'estimated_duration_min', label: 'Estimated Duration (minutes)', type: 'number', validation: { min: 15, max: 720 }, width: 'half' },
        { key: 'ot_room_preference', label: 'OT Room Preference', type: 'text', placeholder: 'e.g. OT-1, OT-2', width: 'half' },
      ],
    },
    {
      id: 'clinical_team',
      title: 'Surgical Team',
      fields: [
        { key: 'primary_surgeon', label: 'Primary Surgeon', type: 'text', validation: { required: true }, width: 'half' },
        { key: 'assistant_surgeon', label: 'Assistant Surgeon', type: 'text', width: 'half' },
        { key: 'anesthesia_type', label: 'Anesthesia Type', type: 'select', validation: { required: true }, options: [
          { value: 'general', label: 'General Anesthesia' }, { value: 'spinal', label: 'Spinal Anesthesia' },
          { value: 'epidural', label: 'Epidural' }, { value: 'local', label: 'Local Anesthesia' },
          { value: 'regional_block', label: 'Regional Block' }, { value: 'sedation', label: 'IV Sedation' },
          { value: 'combined', label: 'Combined' },
        ], width: 'half' },
        { key: 'anesthetist', label: 'Preferred Anesthetist', type: 'text', width: 'half' },
        { key: 'special_equipment', label: 'Special Equipment / Implants Required', type: 'textarea', placeholder: 'List any special instruments, implants, or consumables' },
      ],
    },
    {
      id: 'patient_condition',
      title: 'Pre-Operative Patient Status',
      fields: [
        { key: 'primary_diagnosis', label: 'Primary Diagnosis', type: 'text', validation: { required: true } },
        { key: 'comorbidities', label: 'Comorbidities', type: 'textarea', placeholder: 'DM, HTN, Asthma, etc.' },
        { key: 'allergies', label: 'Known Allergies', type: 'textarea', placeholder: 'Drug / food / latex allergies' },
        { key: 'blood_group', label: 'Blood Group', type: 'select', options: [
          { value: 'a_pos', label: 'A+' }, { value: 'a_neg', label: 'A−' },
          { value: 'b_pos', label: 'B+' }, { value: 'b_neg', label: 'B−' },
          { value: 'ab_pos', label: 'AB+' }, { value: 'ab_neg', label: 'AB−' },
          { value: 'o_pos', label: 'O+' }, { value: 'o_neg', label: 'O−' },
        ], width: 'half' },
        { key: 'blood_units_required', label: 'Blood Units Required', type: 'number', validation: { min: 0, max: 20 }, width: 'half' },
        { key: 'asa_grade', label: 'ASA Physical Status', type: 'select', options: [
          { value: '1', label: 'ASA I — Healthy' }, { value: '2', label: 'ASA II — Mild systemic disease' },
          { value: '3', label: 'ASA III — Severe systemic disease' }, { value: '4', label: 'ASA IV — Life-threatening' },
          { value: '5', label: 'ASA V — Moribund' },
        ], width: 'half' },
        { key: 'npo_instructions', label: 'NPO Instructions', type: 'text', placeholder: 'e.g. NPO after midnight', width: 'half' },
      ],
    },
    {
      id: 'readiness_checklist',
      title: 'Surgery Readiness Checklist',
      description: 'Each item becomes a trackable readiness checkpoint. Responsible staff must confirm before OT slot is locked.',
      fields: [
        { key: 'ready_consent_signed', label: 'Informed consent signed', type: 'checkbox',
          readinessItem: { itemName: 'Informed consent signed', category: 'consent', responsibleRole: 'clinical_care', slaHours: 24 } },
        { key: 'ready_anesthesia_consent', label: 'Anesthesia consent signed', type: 'checkbox',
          readinessItem: { itemName: 'Anesthesia consent signed', category: 'consent', responsibleRole: 'anesthesiologist', slaHours: 24 } },
        { key: 'ready_blood_work', label: 'Blood investigations complete (CBC, coagulation, crossmatch)', type: 'checkbox',
          readinessItem: { itemName: 'Blood investigations complete', category: 'investigation', responsibleRole: 'nurse', slaHours: 12 } },
        { key: 'ready_imaging', label: 'Pre-op imaging reviewed', type: 'checkbox',
          readinessItem: { itemName: 'Pre-op imaging reviewed', category: 'investigation', responsibleRole: 'clinical_care', slaHours: 12 } },
        { key: 'ready_pac_clearance', label: 'PAC (Pre-Anesthetic Checkup) clearance', type: 'checkbox',
          readinessItem: { itemName: 'PAC clearance obtained', category: 'clearance', responsibleRole: 'anesthesiologist', slaHours: 24 } },
        { key: 'ready_cardiac_clearance', label: 'Cardiac clearance (if applicable)', type: 'checkbox',
          readinessItem: { itemName: 'Cardiac clearance', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 24 },
          visibleWhen: { field: 'comorbidities', operator: 'truthy' } },
        { key: 'ready_blood_reserved', label: 'Blood units reserved at blood bank', type: 'checkbox',
          readinessItem: { itemName: 'Blood units reserved', category: 'logistics', responsibleRole: 'nurse', slaHours: 12 },
          visibleWhen: { field: 'blood_units_required', operator: 'truthy' } },
        { key: 'ready_financial_clearance', label: 'Financial clearance / deposit collected', type: 'checkbox',
          readinessItem: { itemName: 'Financial clearance obtained', category: 'billing', responsibleRole: 'billing_executive', slaHours: 24 } },
        { key: 'ready_insurance_preauth', label: 'Insurance pre-authorization approved', type: 'checkbox',
          readinessItem: { itemName: 'Insurance pre-auth approved', category: 'billing', responsibleRole: 'insurance_coordinator', slaHours: 48 } },
        { key: 'ready_ot_slot_confirmed', label: 'OT slot confirmed with OT coordinator', type: 'checkbox',
          readinessItem: { itemName: 'OT slot confirmed', category: 'logistics', responsibleRole: 'ot_coordinator', slaHours: 12 } },
        { key: 'ready_equipment_available', label: 'Special equipment / implants available', type: 'checkbox',
          readinessItem: { itemName: 'Equipment & implants available', category: 'logistics', responsibleRole: 'ot_coordinator', slaHours: 12 },
          visibleWhen: { field: 'special_equipment', operator: 'truthy' } },
        { key: 'ready_npo_confirmed', label: 'NPO status confirmed', type: 'checkbox',
          readinessItem: { itemName: 'NPO status confirmed', category: 'nursing', responsibleRole: 'nurse', slaHours: 4 } },
        { key: 'ready_site_marking', label: 'Surgical site marking done', type: 'checkbox',
          readinessItem: { itemName: 'Surgical site marking done', category: 'consent', responsibleRole: 'clinical_care', slaHours: 4 } },
        { key: 'ready_premed_given', label: 'Pre-medication given as ordered', type: 'checkbox',
          readinessItem: { itemName: 'Pre-medication administered', category: 'nursing', responsibleRole: 'nurse', slaHours: 2 } },
        { key: 'ready_patient_id_band', label: 'Patient ID band verified', type: 'checkbox',
          readinessItem: { itemName: 'Patient ID band verified', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'ready_file_complete', label: 'Patient file complete with all reports', type: 'checkbox',
          readinessItem: { itemName: 'Patient file complete', category: 'investigation', responsibleRole: 'ip_coordinator', slaHours: 4 } },
      ],
    },
    {
      id: 'surgeon_notes',
      title: 'Surgeon Notes',
      fields: [
        { key: 'special_instructions', label: 'Special Instructions for OT', type: 'textarea', placeholder: 'Positioning, special prep, post-op plan, etc.' },
        { key: 'post_op_destination', label: 'Post-Op Destination', type: 'select', options: [
          { value: 'ward', label: 'Ward' }, { value: 'icu', label: 'ICU' },
          { value: 'hdu', label: 'HDU' }, { value: 'daycare_discharge', label: 'Day Care → Discharge' },
        ], width: 'half' },
        { key: 'estimated_los_days', label: 'Estimated Length of Stay (days)', type: 'number', validation: { min: 0, max: 90 }, width: 'half' },
      ],
    },
  ],
};


// -------------------------------------------
// 3–13. ENRICHED FORM SCHEMAS (Step 4.3)
// All 11 remaining forms fully specified with
// multi-section layouts, readiness items, and
// Indian hospital workflow fields.
// -------------------------------------------

// -------------------------------------------
// 3. ADMISSION_ADVICE (opd → pre_admission)
// Consultant advises admission.
// -------------------------------------------

export const ADMISSION_ADVICE: FormSchema = {
  formType: 'admission_advice',
  title: 'Admission Advice',
  description: 'Consultant advises admission for a patient. Kicks off the pre-admission workflow.',
  version: 1,
  stages: ['opd', 'pre_admission'],
  submitterRoles: ['clinical_care', 'department_head', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'admission_details',
      title: 'Admission Details',
      description: 'Core admission information and timeline.',
      fields: [
        { key: 'diagnosis', label: 'Primary Diagnosis', type: 'text', validation: { required: true, maxLength: 500 }, helpText: 'ICD-10 diagnosis if available' },
        { key: 'reason_for_admission', label: 'Reason for Admission', type: 'textarea', validation: { required: true, maxLength: 1000 }, helpText: 'Why is inpatient admission necessary?' },
        { key: 'admission_type', label: 'Admission Type', type: 'select', validation: { required: true }, options: [
          { value: 'elective', label: 'Elective' },
          { value: 'emergency', label: 'Emergency' },
          { value: 'daycare', label: 'Day Care' },
        ], width: 'half' },
        { key: 'preferred_date', label: 'Preferred Admission Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'expected_los', label: 'Expected Length of Stay (days)', type: 'number', validation: { required: true, min: 1, max: 90 }, width: 'half' },
        { key: 'room_preference', label: 'Room Category Preference', type: 'select', options: [
          { value: 'general', label: 'General Ward' },
          { value: 'semi_private', label: 'Semi-Private' },
          { value: 'private', label: 'Private' },
          { value: 'suite', label: 'Suite' },
        ], width: 'half' },
      ],
    },
    {
      id: 'clinical_context',
      title: 'Clinical Context',
      description: 'Relevant clinical history and current status.',
      fields: [
        { key: 'comorbidities', label: 'Comorbidities', type: 'textarea', placeholder: 'E.g. DM, HTN, IHD, Asthma', helpText: 'Existing medical conditions' },
        { key: 'allergies', label: 'Known Allergies', type: 'textarea', placeholder: 'Drug allergies, food, latex, etc.', helpText: 'Include severity and reaction type' },
        { key: 'current_medications', label: 'Current Medications', type: 'textarea', placeholder: 'List all medications patient is taking', helpText: 'Include doses and frequency' },
        { key: 'special_needs', label: 'Special Needs / Precautions', type: 'textarea', placeholder: 'E.g. mobility issues, isolation required, interpreter needed' },
      ],
    },
    {
      id: 'consultant_orders',
      title: 'Consultant Orders',
      description: 'Initial orders for admission management.',
      fields: [
        { key: 'diet_order', label: 'Diet Order', type: 'select', options: [
          { value: 'npo', label: 'NPO (Nil by mouth)' },
          { value: 'liquid', label: 'Clear Liquids' },
          { value: 'soft', label: 'Soft Diet' },
          { value: 'full', label: 'Full Diet' },
          { value: 'diabetic', label: 'Diabetic Diet' },
          { value: 'low_sodium', label: 'Low Sodium' },
          { value: 'other', label: 'Other (specify below)' },
        ], width: 'half' },
        { key: 'diet_other', label: 'Other Diet Details', type: 'text', visibleWhen: { field: 'diet_order', operator: 'eq', value: 'other' }, width: 'half' },
        { key: 'activity_level', label: 'Activity Level', type: 'select', options: [
          { value: 'bedrest', label: 'Bed Rest' },
          { value: 'bathroom_only', label: 'Bathroom Privileges Only' },
          { value: 'limited_mobility', label: 'Limited Mobility' },
          { value: 'ambulatory', label: 'Ambulatory' },
        ], width: 'half' },
        { key: 'monitoring_level', label: 'Monitoring Level', type: 'select', options: [
          { value: 'routine', label: 'Routine' },
          { value: 'high_dependency', label: 'High Dependency Unit (HDU)' },
          { value: 'icu', label: 'Intensive Care Unit (ICU)' },
        ], width: 'half' },
        { key: 'investigations_ordered', label: 'Investigations to be Done', type: 'textarea', placeholder: 'E.g. CBC, CT scan, ECG, blood culture', helpText: 'Pre-admission or on-admission investigations' },
      ],
    },
    {
      id: 'readiness_checklist',
      title: 'Pre-Admission Readiness',
      description: 'Items to confirm before admission is processed.',
      fields: [
        { key: 'insurance_verified', label: 'Insurance verification initiated', type: 'checkbox',
          readinessItem: { itemName: 'Insurance verification started', category: 'billing', responsibleRole: 'insurance_coordinator', slaHours: 12, description: 'Policy details checked and pre-auth process initiated if needed' } },
        { key: 'room_availability_confirmed', label: 'Room availability confirmed', type: 'checkbox',
          readinessItem: { itemName: 'Room availability confirmed', category: 'logistics', responsibleRole: 'ip_coordinator', slaHours: 4, description: 'Required room category is available on preferred date' } },
        { key: 'consultant_admission_confirmed', label: 'Consultant confirmed admission', type: 'checkbox',
          readinessItem: { itemName: 'Consultant confirmed admission', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 24, description: 'Admission is finalized and patient counseled' } },
      ],
    },
  ],
};

// -------------------------------------------
// 4. FINANCIAL_COUNSELING (pre_admission)
// Financial discussion before admission.
// -------------------------------------------

export const FINANCIAL_COUNSELING: FormSchema = {
  formType: 'financial_counseling',
  title: 'Financial Counseling',
  description: 'Capture financial discussion, insurance details, room rent eligibility, and patient consent before admission or when clinical circumstances change.',
  version: 4,
  stages: ['opd', 'pre_admission', 'admitted', 'pre_op', 'surgery', 'post_op'],
  submitterRoles: ['billing_executive', 'insurance_coordinator', 'customer_care', 'marketing_sales', 'super_admin'],
  requiresPatient: true,
  sections: [
    // §0 — Patient & Admission Info (auto-filled where possible)
    {
      id: 'patient_info',
      title: 'Patient & Admission Information',
      description: 'Basic patient demographics and admission context. Fields marked (auto) are pre-filled from the patient record.',
      fields: [
        { key: 'patient_contact', label: 'Patient Contact Number', type: 'phone', width: 'half',
          helpText: 'Auto-filled from patient record if available' },
        { key: 'patient_age', label: 'Patient Age', type: 'number', validation: { min: 0, max: 150 }, width: 'third' },
        { key: 'patient_sex', label: 'Sex', type: 'select', options: [
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: 'other', label: 'Other' },
        ], width: 'third' },
        { key: 'patient_uhid', label: 'Patient UHID', type: 'text', width: 'third',
          helpText: 'Auto-populated from Rounds — read only' },
        { key: 'admitting_consultant', label: 'Admitting Consultant', type: 'text', validation: { required: true }, width: 'half',
          helpText: 'Doctor who recommended admission/surgery' },
        { key: 'admission_date', label: 'Date of Admission', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'admission_to', label: 'Admission To', type: 'select', validation: { required: true }, options: [
          { value: 'ward', label: 'Ward' },
          { value: 'icu', label: 'ICU' },
          { value: 'daycare', label: 'Daycare' },
        ], width: 'half' },
        { key: 'bed_category', label: 'Bed Category', type: 'select', validation: { required: true }, options: [
          { value: 'single_private', label: 'Single Room / Private' },
          { value: 'twin_semi_private', label: 'Twin Sharing / Semi Private' },
          { value: 'suite', label: 'Suite Room' },
          { value: 'daycare_multbed', label: 'Daycare / Multi-bed' },
          { value: 'general_ward', label: 'General Ward' },
          { value: 'icu', label: 'ICU' },
        ], width: 'half' },
      ],
    },
    // §1 — Clinical Details
    {
      id: 'clinical_details',
      title: 'Clinical Details',
      description: 'Diagnosis, planned procedure, and expected stay duration.',
      fields: [
        { key: 'diagnosis_procedure', label: 'Diagnosis & Treatment / Surgery / Procedure Planned', type: 'textarea',
          validation: { required: true }, placeholder: 'E.g. B/L TKR, Appendectomy, Septoplasty',
          helpText: 'This feeds into the pre-authorization form later' },
        { key: 'surgery_date', label: 'Date of Surgery / Procedure', type: 'date', width: 'half' },
        { key: 'expected_los', label: 'Expected Length of Stay', type: 'text', width: 'half',
          placeholder: 'E.g. 2 days, 5 days, As per medical condition' },
      ],
    },
    // §2 — Payment Profile (existing, with Insurance+Cash combo added)
    {
      id: 'payment_profile',
      title: 'Payment Profile',
      description: 'Patient payment method and payer details.',
      fields: [
        { key: 'payment_mode', label: 'Payer', type: 'select', validation: { required: true }, options: [
          { value: 'cash', label: 'Cash / Self-Pay' },
          { value: 'insurance', label: 'Insurance' },
          { value: 'insurance_cash', label: 'Insurance + Cash (combined)' },
          { value: 'corporate', label: 'Corporate Tie-up' },
          { value: 'credit', label: 'Credit / EMI' },
        ], width: 'half' },
        { key: 'corporate_name', label: 'Corporate Name', type: 'text', visibleWhen: { field: 'payment_mode', operator: 'eq', value: 'corporate' }, width: 'half' },
        { key: 'corporate_employee_id', label: 'Employee ID', type: 'text', visibleWhen: { field: 'payment_mode', operator: 'eq', value: 'corporate' }, width: 'half' },
        { key: 'admission_type', label: 'Admission Type', type: 'select', options: [
          { value: 'package', label: 'Package' },
          { value: 'open_bill', label: 'Open Bill' },
        ], width: 'half' },
        { key: 'open_bill_charges', label: 'Open Bill Charge Details', type: 'textarea',
          visibleWhen: { field: 'admission_type', operator: 'eq', value: 'open_bill' },
          placeholder: 'Bed Charges / Nursing / RMO / Doctor Visit / MRD / Food / Insurance Processing / Other',
          helpText: 'Itemize the charges that will apply for open-bill admission' },
      ],
    },
    // §3 — Insurance Details (existing, visible for insurance or insurance+cash)
    {
      id: 'insurance_details',
      title: 'Insurance Details',
      description: 'Insurance card capture and TPA routing.',
      fields: [
        { key: 'insurance_details_text', label: 'Insurance Details', type: 'text', placeholder: 'E.g. Mediassist, Star Health; Oriental Insurance / Vidal TPA',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'full',
          helpText: 'Quick text entry: TPA name + Insurer name as shown on card' },
        { key: 'tpa_name', label: 'TPA Name', type: 'select', options: [
          { value: 'Medi Assist', label: 'Medi Assist' },
          { value: 'Vidal', label: 'Vidal Health' },
          { value: 'Paramount', label: 'Paramount Health' },
          { value: 'MDIndia', label: 'MD India' },
          { value: 'FHPL', label: 'FHPL' },
          { value: 'Health India', label: 'Health India TPA' },
          { value: 'Heritage', label: 'Heritage Health' },
          { value: 'Direct', label: 'Direct (no TPA)' },
          { value: 'Other', label: 'Other' },
        ], visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Select "Direct" if hospital deals with insurer directly without TPA' },
        { key: 'insurance_provider', label: 'Insurance Company', type: 'text', placeholder: 'E.g. Bajaj General, Star Health, HDFC Ergo, Oriental, ICICI Lombard',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half', validation: { required: true } },
        { key: 'policy_number', label: 'Policy Number', type: 'text',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half' },
        { key: 'insurance_id', label: 'Insurance Card ID', type: 'text',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half' },
        { key: 'card_valid_until', label: 'Card Valid Until', type: 'date',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Check expiry — expired cards are rejected by insurers' },
        { key: 'submission_channel', label: 'Submission Channel', type: 'select', options: [
          { value: 'tpa', label: 'Via TPA' },
          { value: 'direct', label: 'Direct to Insurer' },
        ], visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Auto-set based on TPA selection' },
        { key: 'portal_used', label: 'Portal / Submission Method', type: 'select', options: [
          { value: 'IHX', label: 'IHX Portal' },
          { value: 'Medi Assist Portal', label: 'Medi Assist Portal' },
          { value: 'Insurer Portal', label: 'Insurer Direct Portal' },
          { value: 'Email', label: 'Email Submission' },
          { value: 'Other', label: 'Other' },
        ], visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half' },
      ],
    },
    // §4 — Room Rent & Eligibility (existing)
    {
      id: 'room_rent_eligibility',
      title: 'Room Rent Eligibility Check',
      description: 'Calculate proportional deduction risk based on sum insured and room selection.',
      fields: [
        { key: 'sum_insured', label: 'Sum Insured (per patient) ₹', type: 'number', validation: { min: 0 },
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Ask patient — hospital cannot look this up. Critical for room rent calculation.' },
        { key: 'room_category', label: 'Room Category Selected', type: 'select', options: [
          { value: 'general', label: 'General Ward' },
          { value: 'semi_private', label: 'Semi-Private' },
          { value: 'private', label: 'Private' },
          { value: 'suite', label: 'Suite' },
          { value: 'icu', label: 'ICU' },
          { value: 'nicu', label: 'NICU' },
        ], visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half' },
        { key: 'actual_room_rent', label: 'Actual Room Rent (₹/day)', type: 'number', validation: { min: 0 },
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Hospital rate for the selected room category' },
        { key: 'has_room_rent_waiver', label: 'No room rent restriction (patient confirmed)', type: 'checkbox',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] },
          helpText: 'Some policies have no room rent sublimit — patient must confirm from policy document' },
        { key: 'co_pay_pct', label: 'Co-pay Percentage (%)', type: 'number', validation: { min: 0, max: 100 },
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Patient co-pay percentage from insurance policy (0 if none)' },
        { key: 'insurance_coverage_amount', label: 'Insurance Coverage Amount (₹)', type: 'number', validation: { min: 0 },
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Approved or expected coverage amount from insurer for this admission' },
        { key: 'copay_amount', label: 'Co-pay / Patient Responsibility (₹)', type: 'number', validation: { min: 0 },
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] }, width: 'half',
          helpText: 'Actual amount patient must pay out of pocket (auto-calculate: estimated cost − coverage if known)' },
      ],
    },
    // §5 — Cost Estimate (existing, with package amount from Google Form)
    {
      id: 'cost_estimate',
      title: 'Cost Estimate',
      description: 'Itemized cost breakdown for the admission.',
      fields: [
        { key: 'package_name', label: 'Package Name / Type', type: 'text', placeholder: 'E.g. Appendectomy Package, B/L TKR Package', width: 'half' },
        { key: 'is_package', label: 'Package or Non-Package?', type: 'select', options: [
          { value: 'package', label: 'Package' },
          { value: 'non_package', label: 'Non-Package (à la carte)' },
        ], width: 'half' },
        { key: 'package_amount', label: 'Package Amount (₹)', type: 'number', validation: { min: 0 }, width: 'half',
          visibleWhen: { field: 'is_package', operator: 'eq', value: 'package' },
          helpText: 'Base package cost before extras like implants' },
        { key: 'estimated_cost', label: 'Estimated Total Cost (₹)', type: 'number', validation: { required: true, min: 0 }, width: 'half',
          helpText: 'Total estimated cost including implants, extras, etc.' },
        { key: 'cost_breakdown', label: 'Cost Breakdown', type: 'textarea', placeholder: 'Room, surgery, investigations, implants, etc.', helpText: 'Itemized cost components' },
        { key: 'inclusions', label: 'Inclusions Summary', type: 'textarea', placeholder: 'What is covered: room, nursing, surgeon fee, anaesthesia, meals, etc.', helpText: 'What is included in the estimate — helps set patient expectations' },
        { key: 'exclusions', label: 'Exclusions / Caveats', type: 'textarea', placeholder: 'Items NOT covered: implants above ₹X, ICU beyond 2 days, etc.', helpText: 'What is NOT covered — patient is responsible for these beyond the estimate' },
      ],
    },
    // §6 — Deposit & Payment (existing)
    {
      id: 'deposit_payment',
      title: 'Deposit & Payment',
      description: 'Deposit collection and payment arrangement.',
      fields: [
        { key: 'deposit_amount', label: 'Advance to be Collected (₹)', type: 'number', validation: { required: true, min: 0 }, width: 'half' },
        { key: 'deposit_percentage', label: 'Deposit as % of estimate', type: 'number', validation: { min: 0, max: 100 }, width: 'half', helpText: 'E.g. 50% of ₹1,00,000 = ₹50,000' },
        { key: 'deposit_collected', label: 'Deposit Collected', type: 'checkbox',
          readinessItem: { itemName: 'Deposit collected', category: 'billing', responsibleRole: 'billing_executive', slaHours: 4, description: 'Full or partial deposit received in hospital account' } },
        { key: 'deposit_collected_amount', label: 'Actual Amount Collected (₹)', type: 'number', validation: { min: 0 }, width: 'half' },
        { key: 'balance_plan', label: 'Balance Payment Plan', type: 'select', options: [
          { value: 'at_discharge', label: 'At Discharge' },
          { value: 'post_discharge', label: 'Within 30 days of discharge' },
          { value: 'installments', label: 'Installments' },
          { value: 'insurance_claim', label: 'Insurance claim to settle' },
        ], width: 'half' },
        { key: 'credit_terms', label: 'Credit Terms (if applicable)', type: 'text', placeholder: 'E.g. 12 months, 15% interest', visibleWhen: { field: 'balance_plan', operator: 'eq', value: 'installments' } },
      ],
    },
    // §7 — Counsellor Sign-off & Consent (existing consent fields + Google Form metadata fields)
    {
      id: 'patient_consent',
      title: 'Counsellor Sign-off & Patient Consent',
      description: 'Patient acknowledgment of cost estimate, room rent risk, and payment terms.',
      fields: [
        { key: 'counselled_by', label: 'Counselled By (Name)', type: 'text', validation: { required: true }, width: 'half',
          helpText: 'Auto-filled from logged-in user' },
        { key: 'admission_done_by', label: 'Admission Done By (Name)', type: 'text', width: 'half',
          helpText: 'Person who processed the admission — may differ from counsellor' },
        { key: 'informed_proportional_deduction', label: 'Patient informed of proportional deduction risk', type: 'checkbox',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] },
          readinessItem: { itemName: 'Proportional deduction risk explained', category: 'consent', responsibleRole: 'billing_executive', slaHours: 2, description: 'Patient understands that room rent exceeding eligibility causes proportional deduction from entire bill' } },
        { key: 'informed_denial_responsibility', label: 'Patient informed: responsible for payment if claim denied', type: 'checkbox',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] },
          readinessItem: { itemName: 'Claim denial responsibility explained', category: 'consent', responsibleRole: 'billing_executive', slaHours: 2, description: 'Patient acknowledges financial responsibility if insurance claim is denied' } },
        { key: 'estimate_acknowledged', label: 'Patient / attendant acknowledged estimate', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Financial estimate acknowledged', category: 'consent', responsibleRole: 'billing_executive', slaHours: 2, description: 'Patient understands and accepts estimated cost' } },
        { key: 'payment_terms_agreed', label: 'Payment terms agreed', type: 'checkbox', validation: { required: true } },
        { key: 'consent_form_signed', label: 'Consent form signed', type: 'checkbox',
          readinessItem: { itemName: 'Financial consent form signed', category: 'consent', responsibleRole: 'billing_executive', slaHours: 4, description: 'Physical consent form signed by patient or attendant' } },
        { key: 'coverage_confirmed_with_agent', label: 'Patient confirmed coverage details with CRM/agent', type: 'checkbox',
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] } },
        { key: 'preauth_initiated', label: 'Insurance pre-authorization initiated', type: 'checkbox',
          readinessItem: { itemName: 'Pre-auth initiated', category: 'billing', responsibleRole: 'insurance_coordinator', slaHours: 24, description: 'Insurance pre-auth process started for claims coverage' },
          visibleWhen: { field: 'payment_mode', operator: 'in', value: ['insurance', 'insurance_cash'] } },
        { key: 'counseling_notes', label: 'Remarks / Counseling Notes', type: 'textarea', placeholder: 'Any special payment arrangements, exemptions, discounts, room rent waivers, etc.' },
      ],
    },
  ],
};

// -------------------------------------------
// 5. OT_BILLING_CLEARANCE (pre_op)
// Finance confirms billing before surgery.
// -------------------------------------------

export const OT_BILLING_CLEARANCE: FormSchema = {
  formType: 'ot_billing_clearance',
  title: 'OT Billing Clearance',
  description: 'Finance team confirms billing clearance before surgery can proceed.',
  version: 1,
  stages: ['pre_op'],
  submitterRoles: ['billing_executive', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'surgery_cost',
      title: 'Surgery Cost Summary',
      description: 'Final cost estimate for the surgical procedure.',
      fields: [
        { key: 'total_estimate', label: 'Total Surgery Estimate (₹)', type: 'number', validation: { required: true, min: 0 }, width: 'half' },
        { key: 'package_type', label: 'Package or Non-Package', type: 'select', validation: { required: true }, options: [
          { value: 'package', label: 'Package Surgery' },
          { value: 'non_package', label: 'Non-Package (à la carte)' },
        ], width: 'half' },
        { key: 'implant_cost', label: 'Implant Cost (₹)', type: 'number', validation: { min: 0 }, width: 'half', helpText: 'Prosthetics, stents, plates, etc.' },
        { key: 'implant_details', label: 'Implant Details', type: 'text', placeholder: 'E.g. Intramedullary nail, Titanium plate', visibleWhen: { field: 'implant_cost', operator: 'truthy' }, width: 'half' },
        { key: 'cost_breakdown', label: 'Cost Breakdown', type: 'textarea', placeholder: 'Surgeon fee, OR charges, anesthesia, consumables, etc.' },
      ],
    },
    {
      id: 'payment_status',
      title: 'Payment Status',
      description: 'Confirmation of deposits and outstanding balance.',
      fields: [
        { key: 'deposit_received', label: 'Deposit Received (₹)', type: 'number', validation: { required: true, min: 0 }, width: 'half' },
        { key: 'advance_received', label: 'Advance Received (₹)', type: 'number', validation: { min: 0 }, width: 'half' },
        { key: 'total_collected', label: 'Total Amount Collected (₹)', type: 'number', width: 'half' },
        { key: 'outstanding_balance', label: 'Outstanding Balance (₹)', type: 'number', width: 'half' },
        { key: 'insurance_preauth_status', label: 'Insurance Pre-Auth Status', type: 'select', options: [
          { value: 'not_applicable', label: 'Not Applicable' },
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'approved_partial', label: 'Partially Approved' },
          { value: 'rejected', label: 'Rejected' },
        ], width: 'half' },
        { key: 'preauth_approval_amount', label: 'Pre-Auth Approved Amount (₹)', type: 'number', validation: { min: 0 }, visibleWhen: { field: 'insurance_preauth_status', operator: 'in', value: ['approved', 'approved_partial'] } },
      ],
    },
    {
      id: 'clearance_decision',
      title: 'Clearance Decision',
      description: 'Final billing clearance status and approval.',
      fields: [
        { key: 'clearance_status', label: 'Clearance Status', type: 'select', validation: { required: true }, options: [
          { value: 'cleared', label: 'Cleared — Proceed with surgery' },
          { value: 'conditional', label: 'Conditional — Pending final payment' },
          { value: 'blocked', label: 'Blocked — Not cleared for surgery' },
        ], width: 'half' },
        { key: 'billing_cleared', label: 'Billing Clearance Confirmed', type: 'checkbox',
          readinessItem: { itemName: 'OT billing clearance confirmed', category: 'billing', responsibleRole: 'billing_executive', slaHours: 2, description: 'Surgery can proceed from a billing/financial standpoint' } },
        { key: 'clearance_conditions', label: 'Conditions for Clearance (if any)', type: 'textarea', placeholder: 'E.g. Additional deposit to be collected before anesthesia', visibleWhen: { field: 'clearance_status', operator: 'eq', value: 'conditional' } },
        { key: 'escalation_reason', label: 'Reason for Block / Escalation', type: 'textarea', placeholder: 'If status is Blocked, explain why', visibleWhen: { field: 'clearance_status', operator: 'eq', value: 'blocked' } },
        { key: 'cleared_by', label: 'Cleared By (Name)', type: 'text', validation: { required: true } },
        { key: 'cleared_date_time', label: 'Clearance Date & Time', type: 'datetime', validation: { required: true } },
      ],
    },
  ],
};

// -------------------------------------------
// 6. ADMISSION_CHECKLIST (admitted)
// IP Coordinator confirms all admission requirements.
// -------------------------------------------

export const ADMISSION_CHECKLIST: FormSchema = {
  formType: 'admission_checklist',
  title: 'Admission Checklist',
  description: 'IP Coordinator confirms all admission requirements are met.',
  version: 1,
  stages: ['admitted'],
  submitterRoles: ['ip_coordinator', 'nurse', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'identity_consent',
      title: 'Identity & Consent',
      description: 'Verify patient identity and collect admission consents.',
      fields: [
        { key: 'id_verified', label: 'Patient identity verified (Aadhaar / ID)', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Patient identity verified', category: 'consent', responsibleRole: 'ip_coordinator', slaHours: 1, description: 'Valid ID proof matched with admission record' } },
        { key: 'id_type', label: 'ID Type', type: 'select', options: [
          { value: 'aadhaar', label: 'Aadhaar' },
          { value: 'pan', label: 'PAN' },
          { value: 'passport', label: 'Passport' },
          { value: 'dl', label: 'Driving License' },
          { value: 'voter_id', label: 'Voter ID' },
          { value: 'other', label: 'Other' },
        ], width: 'half' },
        { key: 'id_number', label: 'ID Number', type: 'text', width: 'half' },
        { key: 'general_consent', label: 'General Consent for Treatment signed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'General consent signed', category: 'consent', responsibleRole: 'ip_coordinator', slaHours: 2, description: 'Patient has signed consent form for admission and treatment' } },
        { key: 'admission_form_signed', label: 'Admission Form signed', type: 'checkbox', validation: { required: true } },
      ],
    },
    {
      id: 'room_assignment',
      title: 'Room Assignment',
      description: 'Assign room and bed to patient.',
      fields: [
        { key: 'room_assigned', label: 'Room / Bed Assigned', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Room assigned', category: 'logistics', responsibleRole: 'ip_coordinator', slaHours: 1, description: 'Patient room and bed number finalized' } },
        { key: 'room_number', label: 'Room Number', type: 'text', visibleWhen: { field: 'room_assigned', operator: 'truthy' }, width: 'half' },
        { key: 'bed_number', label: 'Bed Number', type: 'text', visibleWhen: { field: 'room_assigned', operator: 'truthy' }, width: 'half' },
        { key: 'room_type', label: 'Room Type', type: 'select', options: [
          { value: 'general', label: 'General Ward' },
          { value: 'semi_private', label: 'Semi-Private' },
          { value: 'private', label: 'Private' },
          { value: 'suite', label: 'Suite' },
        ], width: 'half' },
      ],
    },
    {
      id: 'clinical_orders',
      title: 'Clinical Orders',
      description: 'Initialize clinical care orders on admission.',
      fields: [
        { key: 'vitals_recorded', label: 'Admission Vitals Recorded', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Admission vitals recorded', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'BP, HR, Temp, SpO2, RR documented' } },
        { key: 'medication_chart_started', label: 'Medication Chart Started', type: 'checkbox',
          readinessItem: { itemName: 'Medication chart started', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'Medication reconciliation done, chart initiated' } },
        { key: 'diet_ordered', label: 'Diet Order Placed', type: 'checkbox',
          readinessItem: { itemName: 'Diet order placed', category: 'nursing', responsibleRole: 'nurse', slaHours: 2, description: 'Dietary requirements communicated to kitchen' } },
        { key: 'diet_type', label: 'Diet Type', type: 'select', visibleWhen: { field: 'diet_ordered', operator: 'truthy' }, options: [
          { value: 'npo', label: 'NPO' },
          { value: 'liquid', label: 'Clear Liquids' },
          { value: 'soft', label: 'Soft Diet' },
          { value: 'full', label: 'Full Diet' },
        ], width: 'half' },
      ],
    },
    {
      id: 'notifications',
      title: 'Department Notifications',
      description: 'Notify all concerned departments of the admission.',
      fields: [
        { key: 'pharmacy_notified', label: 'Pharmacy Notified of Admission', type: 'checkbox',
          readinessItem: { itemName: 'Pharmacy notified', category: 'logistics', responsibleRole: 'pharmacist', slaHours: 1, description: 'Pharmacy aware of admission and medication requirements' } },
        { key: 'nursing_notified', label: 'Nursing Notified of Admission', type: 'checkbox',
          readinessItem: { itemName: 'Nursing notified', category: 'logistics', responsibleRole: 'nurse', slaHours: 1, description: 'Floor nurses informed of new admission' } },
        { key: 'consultant_informed', label: 'Consultant Informed of Admission', type: 'checkbox',
          readinessItem: { itemName: 'Consultant informed', category: 'logistics', responsibleRole: 'clinical_care', slaHours: 2, description: 'Primary consultant aware of patient arrival' } },
        { key: 'admission_notes', label: 'Admission Notes', type: 'textarea', placeholder: 'Any special notes about this admission' },
      ],
    },
  ],
};

// -------------------------------------------
// 7. PRE_OP_NURSING_CHECKLIST (pre_op)
// Nursing confirms patient ready for OT.
// -------------------------------------------

export const PRE_OP_NURSING_CHECKLIST: FormSchema = {
  formType: 'pre_op_nursing_checklist',
  title: 'Pre-Op Nursing Checklist',
  description: 'Nursing team confirms patient is ready to go to OT.',
  version: 1,
  stages: ['pre_op'],
  submitterRoles: ['nurse', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'patient_verification',
      title: 'Patient Verification',
      description: 'Confirm patient identity and consent for surgery.',
      fields: [
        { key: 'id_band_checked', label: 'ID Band Checked and Verified', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Patient ID verified', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'Wristband matches patient record' } },
        { key: 'consent_verified', label: 'Surgical Consent Verified', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Surgical consent verified', category: 'consent', responsibleRole: 'nurse', slaHours: 1, description: 'Signed consent form reviewed and authenticated' } },
        { key: 'allergy_band', label: 'Allergy Band on Patient', type: 'checkbox',
          readinessItem: { itemName: 'Allergy band on patient', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'Red band applied if allergies present' } },
        { key: 'allergies_documented', label: 'Allergies Documented on Chart', type: 'checkbox', validation: { required: true } },
      ],
    },
    {
      id: 'preparation',
      title: 'Patient Preparation',
      description: 'Confirm NPO status, site preparation, and attire.',
      fields: [
        { key: 'npo_verified', label: 'NPO Status Verified (Fasting)', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'NPO status verified', category: 'nursing', responsibleRole: 'nurse', slaHours: 2, description: 'Confirmed patient has not eaten/drunk as per orders' } },
        { key: 'npo_time', label: 'Last Oral Intake Time', type: 'time', width: 'half' },
        { key: 'site_prep_done', label: 'Surgical Site Prep Done', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Surgical site prepped', category: 'nursing', responsibleRole: 'nurse', slaHours: 2, description: 'Hair removal and skin antiseptic applied' } },
        { key: 'gown_on', label: 'Patient in OT Gown', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Patient in OT gown', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'Patient changed into sterile surgical gown' } },
        { key: 'jewelry_removed', label: 'Jewelry / Dentures / Prosthetics Removed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Personal items secured', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'All removable items stored safely' } },
        { key: 'valuables_logged', label: 'Patient Valuables Logged', type: 'checkbox' },
      ],
    },
    {
      id: 'clinical_checks',
      title: 'Clinical Checks',
      description: 'Final vital signs and line management.',
      fields: [
        { key: 'preop_vitals_recorded', label: 'Pre-Op Vitals Recorded', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Pre-op vitals recorded', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'BP, HR, Temp, SpO2 documented' } },
        { key: 'bp_systolic', label: 'BP (Systolic) mmHg', type: 'number', validation: { min: 60, max: 220 }, width: 'third' },
        { key: 'bp_diastolic', label: 'BP (Diastolic) mmHg', type: 'number', validation: { min: 40, max: 140 }, width: 'third' },
        { key: 'pulse', label: 'Pulse (bpm)', type: 'number', validation: { min: 40, max: 150 }, width: 'third' },
        { key: 'temperature', label: 'Temperature (°C)', type: 'number', validation: { min: 35, max: 40 }, width: 'third' },
        { key: 'spo2', label: 'SpO2 (%)', type: 'number', validation: { min: 70, max: 100 }, width: 'third' },
        { key: 'resp_rate', label: 'Respiratory Rate (/min)', type: 'number', validation: { min: 8, max: 40 }, width: 'third' },
        { key: 'iv_line_secured', label: 'IV Line Secured', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'IV line secured', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'IV cannula in place and patent' } },
        { key: 'catheter_if_needed', label: 'Foley Catheter Placed (if needed)', type: 'checkbox',
          readinessItem: { itemName: 'Catheter placed as ordered', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
      ],
    },
    {
      id: 'final_checks',
      title: 'Final Pre-Op Checks',
      description: 'Last-minute verifications before patient leaves ward.',
      fields: [
        { key: 'premed_given', label: 'Pre-Medication Given as Ordered', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Pre-medication administered', category: 'nursing', responsibleRole: 'nurse', slaHours: 1, description: 'Pre-op drugs (if any) administered at correct time' } },
        { key: 'premed_time', label: 'Pre-Med Given Time', type: 'time', visibleWhen: { field: 'premed_given', operator: 'truthy' }, width: 'half' },
        { key: 'file_complete', label: 'Patient File / Chart Complete', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Patient file complete', category: 'investigation', responsibleRole: 'nurse', slaHours: 1, description: 'All investigations, consents, and orders attached' } },
        { key: 'blood_arranged', label: 'Blood Units Arranged (if needed)', type: 'checkbox',
          readinessItem: { itemName: 'Blood arranged if needed', category: 'logistics', responsibleRole: 'nurse', slaHours: 4 } },
        { key: 'blood_units', label: 'Blood Units Count', type: 'number', validation: { min: 0 }, visibleWhen: { field: 'blood_arranged', operator: 'truthy' }, width: 'half' },
        { key: 'preop_notes', label: 'Pre-Op Nursing Notes', type: 'textarea', placeholder: 'Any special observations or concerns' },
      ],
    },
  ],
};

// -------------------------------------------
// 8. WHO_SAFETY_CHECKLIST (surgery)
// WHO-mandated 3-phase safety check.
// -------------------------------------------

export const WHO_SAFETY_CHECKLIST: FormSchema = {
  formType: 'who_safety_checklist',
  title: 'WHO Surgical Safety Checklist',
  description: 'WHO-mandated 3-phase safety check: Sign In, Time Out, Sign Out.',
  version: 1,
  stages: ['surgery'],
  submitterRoles: ['nurse', 'clinical_care', 'anesthesiologist', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'sign_in',
      title: 'Sign In (Before Anesthesia)',
      description: 'Pre-anesthesia verification and safety checks.',
      fields: [
        { key: 'si_identity_confirmed', label: 'Patient Identity Confirmed with Wristband', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign In: Identity verified', category: 'consent', responsibleRole: 'nurse', slaHours: 0.5, description: 'Name and ID number match OR-sent documentation' } },
        { key: 'si_site_marked', label: 'Surgical Site Marked / Not Applicable', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign In: Site marked', category: 'consent', responsibleRole: 'clinical_care', slaHours: 0.5, description: 'Correct site marked with surgeon\'s initials' } },
        { key: 'si_consent_confirmed', label: 'Informed Consent Confirmed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign In: Consent confirmed', category: 'consent', responsibleRole: 'nurse', slaHours: 0.5 } },
        { key: 'si_pulse_ox', label: 'Pulse Oximeter on Patient and Functioning', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign In: Pulse ox on', category: 'nursing', responsibleRole: 'anesthesiologist', slaHours: 0.5 } },
        { key: 'si_allergy_checked', label: 'Known Allergies Checked and Communicated', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign In: Allergies checked', category: 'consent', responsibleRole: 'nurse', slaHours: 0.5 } },
        { key: 'si_airway_assessed', label: 'Difficult Airway / Aspiration Risk Assessed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign In: Airway assessed', category: 'clearance', responsibleRole: 'anesthesiologist', slaHours: 0.5 } },
        { key: 'si_blood_loss_risk', label: 'Risk of >500ml Blood Loss? Planned For', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign In: Blood loss risk noted', category: 'logistics', responsibleRole: 'anesthesiologist', slaHours: 0.5 } },
      ],
    },
    {
      id: 'time_out',
      title: 'Time Out (Before Incision)',
      description: 'Pre-incision team briefing and final verification.',
      fields: [
        { key: 'to_team_introduced', label: 'All Team Members Introduced by Name and Role', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Time Out: Team introduced', category: 'nursing', responsibleRole: 'nurse', slaHours: 0.5, description: 'Verbal introduction of all staff in OT' } },
        { key: 'to_patient_confirmed', label: 'Patient Name, Procedure, Site Confirmed Aloud', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Time Out: Patient confirmed', category: 'consent', responsibleRole: 'clinical_care', slaHours: 0.5 } },
        { key: 'to_procedure_name', label: 'Procedure Name (confirm aloud)', type: 'text', width: 'half' },
        { key: 'to_site_confirmed', label: 'Surgical Site Confirmed Aloud', type: 'text', width: 'half' },
        { key: 'to_antibiotics_given', label: 'Prophylactic Antibiotic Given Within 60 Minutes', type: 'checkbox',
          readinessItem: { itemName: 'Time Out: Antibiotics given', category: 'nursing', responsibleRole: 'anesthesiologist', slaHours: 1 } },
        { key: 'to_imaging_displayed', label: 'Essential Imaging Displayed and Reviewed', type: 'checkbox',
          readinessItem: { itemName: 'Time Out: Imaging reviewed', category: 'investigation', responsibleRole: 'clinical_care', slaHours: 0.5 } },
        { key: 'to_critical_steps', label: 'Critical Steps and Equipment Concerns Discussed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Time Out: Critical steps discussed', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 0.5, description: 'Team briefing on procedure complexity and risks' } },
        { key: 'to_special_concerns', label: 'Special Concerns / Equipment Needs', type: 'textarea', placeholder: 'E.g. special positioning, nerve monitoring' },
      ],
    },
    {
      id: 'sign_out',
      title: 'Sign Out (Before Patient Leaves OT)',
      description: 'Post-procedure verification and documentation.',
      fields: [
        { key: 'so_procedure_recorded', label: 'Procedure Name and Key Interventions Recorded', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign Out: Procedure recorded', category: 'investigation', responsibleRole: 'nurse', slaHours: 0.5, description: 'OR notes documented' } },
        { key: 'so_counts_correct', label: 'Instrument, Sponge, Needle Counts Correct', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign Out: Counts verified', category: 'consent', responsibleRole: 'nurse', slaHours: 0.5, description: 'All instrument and sponge counts match' } },
        { key: 'so_specimen_labeled', label: 'Specimen Labeled Correctly (if any)', type: 'checkbox',
          readinessItem: { itemName: 'Sign Out: Specimen labeled', category: 'investigation', responsibleRole: 'nurse', slaHours: 0.5 } },
        { key: 'so_specimen_list', label: 'Specimen Description', type: 'text', placeholder: 'E.g. gallbladder, lymph nodes', visibleWhen: { field: 'so_specimen_labeled', operator: 'truthy' } },
        { key: 'so_equipment_issues', label: 'Equipment Problems Addressed / Logged', type: 'checkbox',
          readinessItem: { itemName: 'Sign Out: Equipment issues logged', category: 'logistics', responsibleRole: 'nurse', slaHours: 0.5 } },
        { key: 'so_equipment_problems', label: 'Equipment Problems Noted', type: 'textarea', placeholder: 'If any', visibleWhen: { field: 'so_equipment_issues', operator: 'truthy' } },
        { key: 'so_recovery_plan', label: 'Recovery and Post-Op Plan Communicated to Team', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Sign Out: Recovery plan communicated', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 0.5, description: 'Post-op destination, monitoring, medications confirmed' } },
        { key: 'so_post_destination', label: 'Post-Op Destination', type: 'select', options: [
          { value: 'ward', label: 'Ward' },
          { value: 'icu', label: 'ICU' },
          { value: 'hdu', label: 'HDU' },
          { value: 'recovery_room', label: 'Recovery Room' },
        ], width: 'half' },
      ],
    },
  ],
};

// -------------------------------------------
// 9. NURSING_SHIFT_HANDOFF (admitted/pre_op/post_op)
// Structured shift handoff.
// -------------------------------------------

export const NURSING_SHIFT_HANDOFF: FormSchema = {
  formType: 'nursing_shift_handoff',
  title: 'Nursing Shift Handoff',
  description: 'Structured handoff between nursing shifts for continuity of care.',
  version: 1,
  stages: ['admitted', 'pre_op', 'post_op'],
  submitterRoles: ['nurse', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'shift_info',
      title: 'Shift Information',
      description: 'Identify outgoing and incoming nursing staff.',
      fields: [
        { key: 'outgoing_shift', label: 'Outgoing Shift', type: 'select', validation: { required: true }, options: [
          { value: 'day', label: 'Day (8 AM – 2 PM)' },
          { value: 'evening', label: 'Evening (2 PM – 8 PM)' },
          { value: 'night', label: 'Night (8 PM – 8 AM)' },
        ], width: 'third' },
        { key: 'incoming_shift', label: 'Incoming Shift', type: 'select', validation: { required: true }, options: [
          { value: 'day', label: 'Day (8 AM – 2 PM)' },
          { value: 'evening', label: 'Evening (2 PM – 8 PM)' },
          { value: 'night', label: 'Night (8 PM – 8 AM)' },
        ], width: 'third' },
        { key: 'handoff_date_time', label: 'Handoff Date & Time', type: 'datetime', validation: { required: true }, width: 'third' },
        { key: 'outgoing_nurse_name', label: 'Outgoing Nurse Name', type: 'text', validation: { required: true }, width: 'half' },
        { key: 'incoming_nurse_name', label: 'Incoming Nurse Name', type: 'text', validation: { required: true }, width: 'half' },
      ],
    },
    {
      id: 'patient_status',
      title: 'Patient Status Summary',
      description: 'Overview of current clinical status.',
      fields: [
        { key: 'diagnosis', label: 'Primary Diagnosis / Reason for Admission', type: 'text', validation: { required: true } },
        { key: 'current_condition', label: 'Current Clinical Condition', type: 'select', validation: { required: true }, options: [
          { value: 'stable', label: 'Stable' },
          { value: 'improving', label: 'Improving' },
          { value: 'stable_concerns', label: 'Stable with some concerns' },
          { value: 'unstable', label: 'Unstable / Deteriorating' },
        ], width: 'half' },
        { key: 'consciousness_level', label: 'Consciousness Level', type: 'select', options: [
          { value: 'alert', label: 'Alert & Oriented' },
          { value: 'confused', label: 'Confused / Disoriented' },
          { value: 'drowsy', label: 'Drowsy but Arousable' },
          { value: 'unconscious', label: 'Unconscious' },
        ], width: 'half' },
        { key: 'mobility_status', label: 'Mobility Status', type: 'select', options: [
          { value: 'independent', label: 'Independent' },
          { value: 'assisted', label: 'Assisted with aid' },
          { value: 'bed_bound', label: 'Bed-bound' },
          { value: 'post_op', label: 'Post-Op — Limited mobility' },
        ], width: 'half' },
        { key: 'pain_score', label: 'Pain Score (0-10)', type: 'number', validation: { min: 0, max: 10 }, width: 'third' },
      ],
    },
    {
      id: 'current_vitals',
      title: 'Current Vitals',
      description: 'Latest vital signs from outgoing shift.',
      fields: [
        { key: 'vitals_time', label: 'Vitals Last Recorded Time', type: 'time', validation: { required: true }, width: 'half' },
        { key: 'bp_systolic', label: 'BP (Systolic) mmHg', type: 'number', validation: { required: true, min: 60, max: 220 }, width: 'third' },
        { key: 'bp_diastolic', label: 'BP (Diastolic) mmHg', type: 'number', validation: { required: true, min: 40, max: 140 }, width: 'third' },
        { key: 'pulse', label: 'Pulse (bpm)', type: 'number', validation: { required: true, min: 40, max: 150 }, width: 'third' },
        { key: 'temperature', label: 'Temperature (°C)', type: 'number', validation: { required: true, min: 35, max: 40 }, width: 'third' },
        { key: 'spo2', label: 'SpO2 (%)', type: 'number', validation: { required: true, min: 70, max: 100 }, width: 'third' },
        { key: 'resp_rate', label: 'Respiratory Rate (/min)', type: 'number', validation: { required: true, min: 8, max: 40 }, width: 'third' },
        { key: 'urine_output', label: 'Urine Output (ml/shift)', type: 'number', validation: { min: 0 }, width: 'half' },
        { key: 'fluid_intake', label: 'Fluid Intake (ml/shift)', type: 'number', validation: { min: 0 }, width: 'half' },
      ],
    },
    {
      id: 'active_orders',
      title: 'Active Orders & Medications',
      description: 'Current treatment plan and pending actions.',
      fields: [
        { key: 'current_iv_fluids', label: 'Current IV Fluids', type: 'textarea', placeholder: 'E.g. Normal Saline 500ml/8h', helpText: 'Type, rate, and any special requirements' },
        { key: 'medications_due', label: 'Medications Due in Next Shift', type: 'textarea', placeholder: 'List medication schedule for incoming shift', helpText: 'Include dosage and times' },
        { key: 'pending_investigations', label: 'Pending Investigations', type: 'textarea', placeholder: 'Blood tests, imaging, reports awaited' },
        { key: 'diet_restrictions', label: 'Diet Restrictions / Orders', type: 'select', options: [
          { value: 'npo', label: 'NPO' },
          { value: 'liquid', label: 'Clear Liquids' },
          { value: 'soft', label: 'Soft Diet' },
          { value: 'full', label: 'Full Diet' },
        ], width: 'half' },
      ],
    },
    {
      id: 'concerns_handoff',
      title: 'Concerns & Handoff Confirmation',
      description: 'Critical information and handoff acknowledgment.',
      fields: [
        { key: 'pending_tasks', label: 'Pending Tasks for Next Shift', type: 'textarea', placeholder: 'Dressing changes, catheter care, drain monitoring, etc.' },
        { key: 'fall_risk', label: 'Fall Risk Assessment', type: 'select', options: [
          { value: 'low', label: 'Low Risk' },
          { value: 'medium', label: 'Medium Risk' },
          { value: 'high', label: 'High Risk' },
        ], width: 'half' },
        { key: 'infection_alerts', label: 'Infection Alerts / Isolation', type: 'textarea', placeholder: 'E.g. MRSA, C.difficile, respiratory precautions' },
        { key: 'allergy_alerts', label: 'Allergy Alerts', type: 'textarea', placeholder: 'Drug allergies, food allergies, latex allergy' },
        { key: 'family_communication', label: 'Family Communication Notes', type: 'textarea', placeholder: 'Any family requests, update calls made, concerns raised' },
        { key: 'handoff_acknowledged', label: 'Incoming Nurse Acknowledges Handoff', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Shift handoff acknowledged', category: 'nursing', responsibleRole: 'nurse', slaHours: 0.25, description: 'Incoming nurse confirms understanding and readiness to care' } },
      ],
    },
  ],
};

// -------------------------------------------
// 10. DISCHARGE_READINESS (discharge)
// Multidisciplinary discharge checklist.
// -------------------------------------------

export const DISCHARGE_READINESS: FormSchema = {
  formType: 'discharge_readiness',
  title: 'Discharge Readiness',
  description: 'Multidisciplinary check that patient is ready for discharge.',
  version: 1,
  stages: ['discharge'],
  submitterRoles: ['clinical_care', 'ip_coordinator', 'nurse', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'clinical',
      title: 'Clinical Readiness',
      description: 'Consultant confirmation of clinical fitness for discharge.',
      fields: [
        { key: 'clinically_stable', label: 'Patient Clinically Stable', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Clinically stable for discharge', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 2, description: 'Vitals stable, no acute complications, wound healing normal' } },
        { key: 'discharge_summary_signed', label: 'Discharge Summary Prepared & Signed by Consultant', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Discharge summary signed', category: 'investigation', responsibleRole: 'clinical_care', slaHours: 4, description: 'Complete summary of hospital course, findings, and recommendations' } },
        { key: 'discharge_summary_date', label: 'Discharge Summary Date', type: 'date', visibleWhen: { field: 'discharge_summary_signed', operator: 'truthy' } },
        { key: 'discharge_medications', label: 'Discharge Medications Prescribed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Discharge medications prescribed', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 2, description: 'All medications written, doses, and duration specified' } },
        { key: 'followup_date_set', label: 'Follow-up Appointment Date Set', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Follow-up scheduled', category: 'logistics', responsibleRole: 'clinical_care', slaHours: 4, description: 'Return appointment booked with consultant' } },
        { key: 'followup_date', label: 'Follow-up Date', type: 'date', visibleWhen: { field: 'followup_date_set', operator: 'truthy' }, width: 'half' },
        { key: 'wound_care_instructions', label: 'Wound Care Instructions Given', type: 'checkbox',
          readinessItem: { itemName: 'Wound care instructions given', category: 'nursing', responsibleRole: 'nurse', slaHours: 2 } },
      ],
    },
    {
      id: 'billing',
      title: 'Financial Clearance',
      description: 'Final billing and payment confirmation.',
      fields: [
        { key: 'final_bill_prepared', label: 'Final Bill Prepared', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Final bill prepared', category: 'billing', responsibleRole: 'billing_executive', slaHours: 4, description: 'Itemized final bill generated with all charges' } },
        { key: 'total_charges', label: 'Total Charges (₹)', type: 'number', validation: { min: 0 }, width: 'half' },
        { key: 'amount_paid', label: 'Amount Paid (₹)', type: 'number', validation: { min: 0 }, width: 'half' },
        { key: 'payment_settled', label: 'Payment Settled / Insurance Claim Filed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Payment settled', category: 'billing', responsibleRole: 'billing_executive', slaHours: 4, description: 'Final settlement done or claim submitted' } },
        { key: 'outstanding_balance', label: 'Outstanding Balance (₹)', type: 'number', validation: { min: 0 }, width: 'half' },
        { key: 'balance_payment_plan', label: 'Balance Payment Plan (if any)', type: 'text', placeholder: 'E.g. to be paid within 10 days', visibleWhen: { field: 'outstanding_balance', operator: 'truthy' }, width: 'half' },
      ],
    },
    {
      id: 'nursing',
      title: 'Nursing Discharge',
      description: 'Patient and family education, medications, and transport.',
      fields: [
        { key: 'patient_education', label: 'Patient / Attendant Educated on Home Care', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Discharge education given', category: 'nursing', responsibleRole: 'nurse', slaHours: 2, description: 'Verbal and written instructions provided' } },
        { key: 'education_topics', label: 'Education Topics Covered', type: 'textarea', placeholder: 'E.g. activity restrictions, wound care, medication compliance, diet, when to report symptoms' },
        { key: 'medications_dispensed', label: 'Discharge Medications Dispensed by Pharmacy', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Discharge medications dispensed', category: 'logistics', responsibleRole: 'pharmacist', slaHours: 2, description: 'All prescribed medications handed to patient with instructions' } },
        { key: 'belongings_returned', label: 'Patient Belongings Returned', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Belongings returned', category: 'logistics', responsibleRole: 'nurse', slaHours: 1, description: 'All personal items, valuables, and documents returned' } },
        { key: 'emergency_contact', label: 'Emergency Contact Information Provided', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Emergency contact informed', category: 'logistics', responsibleRole: 'ip_coordinator', slaHours: 1, description: 'Patient has hospital contact number and knows when/where to report' } },
        { key: 'transport_arranged', label: 'Transport Arranged', type: 'checkbox', validation: { required: true } },
        { key: 'discharge_notes', label: 'Special Discharge Notes', type: 'textarea', placeholder: 'Any additional instructions or cautions' },
      ],
    },
  ],
};

// -------------------------------------------
// 11. POST_DISCHARGE_FOLLOWUP (post_discharge)
// Follow-up tracking and patient recovery status.
// -------------------------------------------

export const POST_DISCHARGE_FOLLOWUP: FormSchema = {
  formType: 'post_discharge_followup',
  title: 'Post-Discharge Follow-up',
  description: 'Track post-discharge follow-up, patient recovery, and segmented discharge experience feedback.',
  version: 2,
  stages: ['post_discharge'],
  submitterRoles: ['nurse', 'ip_coordinator', 'clinical_care', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'discharge_experience',
      title: 'Discharge Experience Feedback',
      description: 'Rate each aspect of the discharge process (1–5). Used for departmental attribution and improvement.',
      fields: [
        { key: 'rating_clinical_handoff', label: 'Clinical Handoff', type: 'select', options: [
          { value: '1', label: '1 — Very Poor' }, { value: '2', label: '2 — Poor' },
          { value: '3', label: '3 — Adequate' }, { value: '4', label: '4 — Good' }, { value: '5', label: '5 — Excellent' },
        ], width: 'half', helpText: 'How timely was the doctor\'s discharge order and summary?' },
        { key: 'rating_department_clearance', label: 'Department Clearance', type: 'select', options: [
          { value: '1', label: '1 — Very Poor' }, { value: '2', label: '2 — Poor' },
          { value: '3', label: '3 — Adequate' }, { value: '4', label: '4 — Good' }, { value: '5', label: '5 — Excellent' },
        ], width: 'half', helpText: 'Were pharmacy/lab clearances completed promptly?' },
        { key: 'rating_billing_documentation', label: 'Billing & Documentation', type: 'select', options: [
          { value: '1', label: '1 — Very Poor' }, { value: '2', label: '2 — Poor' },
          { value: '3', label: '3 — Adequate' }, { value: '4', label: '4 — Good' }, { value: '5', label: '5 — Excellent' },
        ], width: 'half', helpText: 'Was the final bill prepared and explained clearly?' },
        { key: 'rating_insurance_processing', label: 'Insurance Processing', type: 'select', options: [
          { value: '1', label: '1 — Very Poor' }, { value: '2', label: '2 — Poor' },
          { value: '3', label: '3 — Adequate' }, { value: '4', label: '4 — Good' }, { value: '5', label: '5 — Excellent' },
        ], width: 'half', helpText: 'Was the insurance approval communicated well?' },
        { key: 'rating_overall_speed', label: 'Overall Discharge Speed', type: 'select', options: [
          { value: '1', label: '1 — Very Poor' }, { value: '2', label: '2 — Poor' },
          { value: '3', label: '3 — Adequate' }, { value: '4', label: '4 — Good' }, { value: '5', label: '5 — Excellent' },
        ], width: 'half', helpText: 'Total time from discharge order to leaving the hospital' },
        { key: 'discharge_improvement_suggestion', label: 'What could we improve about the discharge process?', type: 'textarea', placeholder: 'Any suggestions for making discharge faster or more comfortable' },
      ],
    },
    {
      id: 'contact_details',
      title: 'Follow-up Contact',
      description: 'Scheduling and completion of follow-up.',
      fields: [
        { key: 'followup_date', label: 'Scheduled Follow-up Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'followup_type', label: 'Follow-up Type', type: 'select', validation: { required: true }, options: [
          { value: 'phone_call', label: 'Phone Call' },
          { value: 'in_person', label: 'In-Person Visit' },
          { value: 'teleconsult', label: 'Teleconsult' },
          { value: 'op_clinic', label: 'OP Clinic Appointment' },
        ], width: 'half' },
        { key: 'contact_attempted', label: 'Contact Attempted', type: 'checkbox', validation: { required: true } },
        { key: 'contact_attempted_date', label: 'Contact Attempted Date', type: 'date', visibleWhen: { field: 'contact_attempted', operator: 'truthy' }, width: 'half' },
        { key: 'contact_successful', label: 'Contact Successful', type: 'checkbox', validation: { required: true } },
        { key: 'who_responded', label: 'Who Responded?', type: 'select', options: [
          { value: 'patient', label: 'Patient' },
          { value: 'family', label: 'Family Member' },
          { value: 'attendant', label: 'Attendant / Caregiver' },
          { value: 'unable', label: 'Unable to Reach' },
        ], width: 'half' },
      ],
    },
    {
      id: 'clinical_status',
      title: 'Clinical Status',
      description: 'Patient self-reported recovery progress.',
      fields: [
        { key: 'patient_status', label: 'Patient Reported Status', type: 'select', validation: { required: true }, options: [
          { value: 'recovering_well', label: 'Recovering Well' },
          { value: 'some_concerns', label: 'Some Concerns' },
          { value: 'not_well', label: 'Not Recovering Well' },
          { value: 'needs_attention', label: 'Needs Medical Attention' },
          { value: 'readmission', label: 'Readmission Required' },
        ], width: 'half' },
        { key: 'pain_score', label: 'Pain Level (0-10)', type: 'number', validation: { min: 0, max: 10 }, width: 'third' },
        { key: 'wound_status', label: 'Wound / Incision Status', type: 'select', options: [
          { value: 'clean_dry', label: 'Clean & Dry' },
          { value: 'mild_redness', label: 'Mild Redness' },
          { value: 'discharge', label: 'Discharge Present' },
          { value: 'swelling', label: 'Swelling / Hematoma' },
          { value: 'infection_suspected', label: 'Infection Suspected' },
          { value: 'na', label: 'N/A' },
        ], width: 'third' },
        { key: 'fever', label: 'Fever Since Discharge?', type: 'radio', options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
          { value: 'not_checked', label: 'Not Checked' },
        ], width: 'third' },
        { key: 'fever_details', label: 'Fever Details', type: 'text', placeholder: 'Temperature, duration, other symptoms', visibleWhen: { field: 'fever', operator: 'eq', value: 'yes' } },
        { key: 'medication_adherence', label: 'Taking Medications as Prescribed', type: 'select', options: [
          { value: 'yes', label: 'Yes, regularly' },
          { value: 'partial', label: 'Partially' },
          { value: 'no', label: 'No / Stopped' },
          { value: 'na', label: 'N/A' },
        ], width: 'half' },
        { key: 'adherence_reasons', label: 'If not taking medications, reasons', type: 'text', visibleWhen: { field: 'medication_adherence', operator: 'in', value: ['partial', 'no'] } },
      ],
    },
    {
      id: 'complications',
      title: 'Complications / Adverse Events',
      description: 'Track any post-discharge complications.',
      fields: [
        { key: 'any_complications', label: 'Any Complications Since Discharge?', type: 'radio', validation: { required: true }, options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ], width: 'half' },
        { key: 'complication_details', label: 'Describe Complications', type: 'textarea', placeholder: 'Type, onset, severity', visibleWhen: { field: 'any_complications', operator: 'eq', value: 'yes' } },
        { key: 'readmission_needed', label: 'Readmission Needed?', type: 'radio', options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
          { value: 'planned', label: 'Planned Readmission' },
        ], width: 'half' },
        { key: 'er_visit_since', label: 'ER Visit or Hospitalization Since Discharge?', type: 'radio', options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ], width: 'half' },
        { key: 'er_details', label: 'ER Visit Details', type: 'text', placeholder: 'Where, when, reason', visibleWhen: { field: 'er_visit_since', operator: 'eq', value: 'yes' } },
      ],
    },
    {
      id: 'followup_plan',
      title: 'Follow-up Plan',
      description: 'Next steps in patient care.',
      fields: [
        { key: 'next_followup_date', label: 'Next Follow-up Date / Clinic Visit', type: 'date', width: 'half' },
        { key: 'next_followup_type', label: 'Next Follow-up Type', type: 'select', options: [
          { value: 'op_clinic', label: 'OP Clinic' },
          { value: 'phone_call', label: 'Phone Call' },
          { value: 'teleconsult', label: 'Teleconsult' },
          { value: 'none_scheduled', label: 'None Scheduled' },
        ], width: 'half' },
        { key: 'referral_needed', label: 'Referral Needed to Other Specialist?', type: 'radio', options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ], width: 'half' },
        { key: 'referral_details', label: 'Referral Details', type: 'text', placeholder: 'Specialist, reason, hospital', visibleWhen: { field: 'referral_needed', operator: 'eq', value: 'yes' }, width: 'half' },
        { key: 'physiotherapy_status', label: 'Physiotherapy Status', type: 'select', options: [
          { value: 'not_needed', label: 'Not Needed' },
          { value: 'home_pt', label: 'Home Physiotherapy' },
          { value: 'clinic_pt', label: 'Clinic Physiotherapy' },
          { value: 'planned', label: 'Planned to start' },
        ], width: 'half' },
        { key: 'followup_completed', label: 'Follow-up Completed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Post-discharge follow-up completed', category: 'clearance', responsibleRole: 'nurse', slaHours: 24, description: 'Patient contacted and recovery status documented' } },
        { key: 'followup_notes', label: 'Follow-up Notes', type: 'textarea', placeholder: 'Summary of conversation, patient counseling provided, action items' },
      ],
    },
  ],
};

// -------------------------------------------
// 12. DAILY_DEPARTMENT_UPDATE (any, requiresPatient: false)
// Morning meeting summary — no patient required.
// -------------------------------------------

export const DAILY_DEPARTMENT_UPDATE: FormSchema = {
  formType: 'daily_department_update',
  title: 'Daily Department Update',
  description: 'Morning meeting summary from each department head.',
  version: 1,
  stages: [],
  submitterRoles: ['department_head', 'super_admin'],
  requiresPatient: false,
  sections: [
    {
      id: 'census',
      title: 'Census',
      description: 'Patient census and admission/discharge summary.',
      fields: [
        { key: 'date', label: 'Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'department', label: 'Department', type: 'text', validation: { required: true }, width: 'half' },
        { key: 'total_patients', label: 'Total Patients (Current Census)', type: 'number', validation: { required: true, min: 0 }, width: 'third' },
        { key: 'new_admissions_today', label: 'New Admissions Today', type: 'number', validation: { min: 0 }, width: 'third' },
        { key: 'discharges_planned', label: 'Discharges Planned', type: 'number', validation: { min: 0 }, width: 'third' },
        { key: 'surgeries_scheduled', label: 'Surgeries Scheduled Today', type: 'number', validation: { min: 0 }, width: 'third' },
        { key: 'icu_patients', label: 'ICU / Critical Patients', type: 'number', validation: { min: 0 }, width: 'third' },
        { key: 'bed_availability', label: 'Beds Available', type: 'number', validation: { min: 0 }, width: 'third' },
      ],
    },
    {
      id: 'operational',
      title: 'Operational Issues',
      description: 'Staffing, equipment, and facility concerns.',
      fields: [
        { key: 'staffing_concerns', label: 'Staffing Concerns', type: 'textarea', placeholder: 'Shortages, absences, skill gaps', helpText: 'Any staff availability issues affecting today\'s operations' },
        { key: 'equipment_issues', label: 'Equipment / Facility Issues', type: 'textarea', placeholder: 'Broken equipment, maintenance needs, bed/room issues' },
        { key: 'pending_discharges', label: 'Pending Discharges', type: 'text', placeholder: 'Any discharges held up for billing/paperwork' },
        { key: 'bed_pressure', label: 'Bed Pressure / Occupancy Rate', type: 'text', placeholder: 'E.g. 85% full, emergency admissions expected' },
      ],
    },
    {
      id: 'clinical_alerts',
      title: 'Clinical Alerts',
      description: 'Critical patients and safety issues.',
      fields: [
        { key: 'critical_patients', label: 'Critical Patients / Alerts', type: 'textarea', placeholder: 'List any patients at risk, unstable, or requiring escalation' },
        { key: 'infection_alerts', label: 'Infection Control Alerts', type: 'textarea', placeholder: 'E.g. MRSA outbreak, suspected foodborne illness' },
        { key: 'sentinel_events', label: 'Sentinel Events / Adverse Incidents', type: 'textarea', placeholder: 'Any reportable incidents from yesterday/today' },
        { key: 'quality_concerns', label: 'Quality / Safety Concerns', type: 'textarea', placeholder: 'Patient safety concerns, quality metrics off target' },
      ],
    },
    {
      id: 'action_items',
      title: 'Action Items',
      description: 'Follow-ups and escalations from the meeting.',
      fields: [
        { key: 'pending_escalations', label: 'Pending Escalations', type: 'textarea', placeholder: 'Items needing hospital management attention' },
        { key: 'previous_meeting_items', label: 'Items from Previous Meeting', type: 'textarea', placeholder: 'Status update on yesterday\'s action items' },
        { key: 'new_action_items', label: 'New Action Items for Today', type: 'textarea', placeholder: 'Bulleted list of today\'s follow-ups and owners' },
        { key: 'general_remarks', label: 'General Remarks / Notes', type: 'textarea', placeholder: 'Anything else relevant to department operations' },
      ],
    },
  ],
};

// -------------------------------------------
// 13. PAC_CLEARANCE (pre_op)
// Anesthesiologist clears patient for anesthesia.
// -------------------------------------------

export const PAC_CLEARANCE: FormSchema = {
  formType: 'pac_clearance',
  title: 'PAC (Pre-Anesthetic Checkup) Clearance',
  description: 'Anesthesiologist clears patient for anesthesia.',
  version: 1,
  stages: ['pre_op'],
  submitterRoles: ['anesthesiologist', 'pac_coordinator', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'medical_history',
      title: 'Medical History',
      description: 'Previous surgical and anesthesia history.',
      fields: [
        { key: 'previous_surgery', label: 'Previous Surgeries', type: 'textarea', placeholder: 'List surgeries with dates and type of anesthesia used' },
        { key: 'anesthesia_history', label: 'Anesthesia History', type: 'select', options: [
          { value: 'ga', label: 'General Anesthesia' },
          { value: 'regional', label: 'Regional / Spinal' },
          { value: 'local', label: 'Local Anesthesia' },
          { value: 'no_previous', label: 'No Previous Anesthesia' },
        ], width: 'half' },
        { key: 'anesthesia_complications', label: 'Previous Anesthesia Complications', type: 'textarea', placeholder: 'E.g. nausea, difficulty intubation, malignant hyperthermia, allergic reaction' },
        { key: 'adverse_reactions', label: 'Known Adverse Reactions', type: 'textarea', placeholder: 'Drug allergies, latex allergy, reactions to anesthetics' },
        { key: 'current_medications', label: 'Current Medications', type: 'textarea', placeholder: 'All medications patient is taking — include doses' },
        { key: 'allergies', label: 'Known Allergies', type: 'textarea', placeholder: 'Food, drug, environmental allergies' },
      ],
    },
    {
      id: 'physical_exam',
      title: 'Physical Examination',
      description: 'Pre-operative clinical examination findings.',
      fields: [
        { key: 'weight', label: 'Weight (kg)', type: 'number', validation: { required: true, min: 5, max: 200 }, width: 'third' },
        { key: 'height', label: 'Height (cm)', type: 'number', validation: { required: true, min: 80, max: 250 }, width: 'third' },
        { key: 'bmi', label: 'BMI (calculated)', type: 'number', validation: { min: 10, max: 60 }, width: 'third' },
        { key: 'bp_systolic', label: 'BP Systolic (mmHg)', type: 'number', validation: { required: true, min: 60, max: 220 }, width: 'third' },
        { key: 'bp_diastolic', label: 'BP Diastolic (mmHg)', type: 'number', validation: { required: true, min: 40, max: 140 }, width: 'third' },
        { key: 'heart_rate', label: 'Heart Rate (bpm)', type: 'number', validation: { required: true, min: 40, max: 150 }, width: 'third' },
        { key: 'airway_assessment', label: 'Airway Assessment', type: 'select', validation: { required: true }, options: [
          { value: 'normal', label: 'Normal Airway' },
          { value: 'anticipated_difficult', label: 'Anticipated Difficult Airway' },
          { value: 'difficult', label: 'Known Difficult Airway' },
        ], width: 'half' },
        { key: 'mallampati_grade', label: 'Mallampati Grade', type: 'select', validation: { required: true }, options: [
          { value: '1', label: 'Grade I (Soft palate, fauces, uvula visible)' },
          { value: '2', label: 'Grade II (Uvula partially visible)' },
          { value: '3', label: 'Grade III (Only base of uvula visible)' },
          { value: '4', label: 'Grade IV (Soft palate not visible — difficult intubation)' },
        ], width: 'half' },
        { key: 'dental_status', label: 'Dental Status', type: 'select', options: [
          { value: 'normal', label: 'Normal Dentition' },
          { value: 'caries', label: 'Dental Caries / Poor Oral Hygiene' },
          { value: 'loose_teeth', label: 'Loose / Missing Teeth' },
          { value: 'dentures', label: 'Dentures / Crowns' },
          { value: 'other', label: 'Other (specify)' },
        ], width: 'half' },
        { key: 'mouth_opening', label: 'Mouth Opening Limited?', type: 'radio', options: [
          { value: 'no', label: 'No — Normal' },
          { value: 'yes', label: 'Yes — Limited' },
        ], width: 'half' },
        { key: 'thyromental_distance', label: 'Thyromental Distance (cm)', type: 'number', validation: { min: 2, max: 10 }, helpText: 'Distance from thyroid cartilage to mentum; <6cm suggests difficulty intubating' },
      ],
    },
    {
      id: 'investigations',
      title: 'Lab & Investigation Review',
      description: 'Review of recent investigations.',
      fields: [
        { key: 'cbc_reviewed', label: 'CBC Reviewed', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'CBC reviewed', category: 'investigation', responsibleRole: 'anesthesiologist', slaHours: 12 } },
        { key: 'cbc_abnormal', label: 'CBC Abnormal Findings?', type: 'text', placeholder: 'Hemoglobin, platelets, WBC if abnormal', visibleWhen: { field: 'cbc_reviewed', operator: 'truthy' } },
        { key: 'coagulation_reviewed', label: 'Coagulation Profile Reviewed', type: 'checkbox',
          readinessItem: { itemName: 'Coagulation profile reviewed', category: 'investigation', responsibleRole: 'anesthesiologist', slaHours: 12 } },
        { key: 'coagulation_abnormal', label: 'Coagulation Abnormal Findings?', type: 'text', placeholder: 'PT, INR, aPTT if abnormal', visibleWhen: { field: 'coagulation_reviewed', operator: 'truthy' } },
        { key: 'ecg_reviewed', label: 'ECG Reviewed (if >40 years or indicated)', type: 'checkbox',
          readinessItem: { itemName: 'ECG reviewed', category: 'investigation', responsibleRole: 'anesthesiologist', slaHours: 12 } },
        { key: 'ecg_abnormal', label: 'ECG Abnormal Findings?', type: 'text', placeholder: 'Arrhythmias, ischemic changes, etc.', visibleWhen: { field: 'ecg_reviewed', operator: 'truthy' } },
        { key: 'chest_xray_reviewed', label: 'Chest X-Ray Reviewed (if indicated)', type: 'checkbox' },
        { key: 'cxr_abnormal', label: 'CXR Abnormal Findings?', type: 'text', placeholder: 'Consolidation, effusion, cardiomegaly, etc.', visibleWhen: { field: 'chest_xray_reviewed', operator: 'truthy' } },
        { key: 'other_investigations', label: 'Other Investigations Reviewed', type: 'textarea', placeholder: 'E.g. blood sugar, renal function, liver function' },
      ],
    },
    {
      id: 'anesthesia_plan',
      title: 'Anesthesia Plan & Clearance',
      description: 'Anesthesia strategy and fitness assessment.',
      fields: [
        { key: 'asa_grade', label: 'ASA Physical Status', type: 'select', validation: { required: true }, options: [
          { value: '1', label: 'ASA I — Healthy' },
          { value: '2', label: 'ASA II — Mild systemic disease' },
          { value: '3', label: 'ASA III — Severe systemic disease' },
          { value: '4', label: 'ASA IV — Life-threatening disease' },
          { value: '5', label: 'ASA V — Moribund, not expected to survive 24h' },
        ], width: 'half' },
        { key: 'anesthesia_plan', label: 'Anesthesia Plan', type: 'select', validation: { required: true }, options: [
          { value: 'general', label: 'General Anesthesia (with intubation)' },
          { value: 'general_lma', label: 'General Anesthesia (with LMA)' },
          { value: 'spinal', label: 'Spinal Anesthesia' },
          { value: 'epidural', label: 'Epidural' },
          { value: 'regional_block', label: 'Regional Block' },
          { value: 'local', label: 'Local Anesthesia' },
          { value: 'sedation', label: 'IV Sedation' },
          { value: 'combined', label: 'Combined (e.g. GA + Regional)' },
        ], width: 'half' },
        { key: 'special_precautions', label: 'Special Precautions / Considerations', type: 'textarea', placeholder: 'E.g. difficult airway management plan, aspiration precautions, positioning concerns, special monitoring' },
        { key: 'preop_orders', label: 'Pre-Op Orders', type: 'textarea', placeholder: 'Premedication, NPO timing, specific instructions', validation: { maxLength: 1000 } },
        { key: 'fit_for_anesthesia', label: 'Patient FIT FOR ANESTHESIA', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'PAC clearance — fit for anesthesia', category: 'clearance', responsibleRole: 'anesthesiologist', slaHours: 4, description: 'Anesthesiologist has cleared patient for planned anesthesia' } },
        { key: 'pac_clearance_date', label: 'PAC Clearance Date & Time', type: 'datetime', validation: { required: true }, width: 'half' },
        { key: 'anesthesiologist_name', label: 'Anesthesiologist Name', type: 'text', validation: { required: true }, width: 'half' },
        { key: 'pac_notes', label: 'Additional Notes', type: 'textarea', placeholder: 'Any other relevant information for the surgical team' },
      ],
    },
  ],
};

// ============================================
// SURGERY BOOKING (Standalone — R.2c)
// For admitted/pre_op patients needing a new or additional surgery.
// Fields mirror Section C of Consolidated Marketing Handoff.
// Routes summary to: patient thread + OT department channel.
// ============================================

const SURGERY_BOOKING: FormSchema = {
  formType: 'surgery_booking',
  title: 'Surgery Booking',
  description: 'Book a patient for surgery. Captures the surgical plan, clinical risk profile, and OT scheduling requirements. Routes a summary to the OT department channel.',
  stages: ['admitted', 'pre_op'],
  submitterRoles: ['super_admin', 'clinical_care', 'ot_coordinator', 'doctor', 'nursing'],
  requiresPatient: true,
  version: 1,
  sections: [
    // ── Surgical Plan ──
    {
      id: 'surgical_plan',
      title: 'Surgical Plan',
      description: 'Core procedure details for OT scheduling.',
      fields: [
        { key: 'surgeon_name', label: 'Surgeon Name', type: 'text', validation: { required: true }, placeholder: 'Who will operate', width: 'half' },
        { key: 'surgical_specialty', label: 'Surgical Specialty', type: 'select', validation: { required: true }, options: [
          { value: 'general_surgery', label: 'General Surgery' },
          { value: 'orthopaedics', label: 'Orthopaedics' },
          { value: 'ent', label: 'ENT' },
          { value: 'urology', label: 'Urology' },
          { value: 'gynaecology', label: 'Gynaecology' },
          { value: 'ophthalmology', label: 'Ophthalmology' },
          { value: 'neurosurgery', label: 'Neurosurgery' },
          { value: 'cardiothoracic', label: 'Cardiothoracic' },
          { value: 'plastic_surgery', label: 'Plastic Surgery' },
          { value: 'paediatric_surgery', label: 'Paediatric Surgery' },
          { value: 'vascular_surgery', label: 'Vascular Surgery' },
          { value: 'gastro_surgery', label: 'GI / Laparoscopic Surgery' },
          { value: 'other', label: 'Other' },
        ], width: 'half' },
        { key: 'proposed_procedure', label: 'Proposed Procedure', type: 'text', validation: { required: true }, placeholder: 'What surgery is planned' },
        { key: 'laterality', label: 'Laterality', type: 'select', options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'bilateral', label: 'Bilateral' },
          { value: 'na', label: 'N/A' },
        ], width: 'half' },
        { key: 'surgery_urgency', label: 'Urgency', type: 'select', validation: { required: true }, options: [
          { value: 'elective', label: 'Elective' },
          { value: 'urgent', label: 'Urgent' },
          { value: 'emergency', label: 'Emergency' },
        ], width: 'half' },
        { key: 'clinical_justification', label: 'Clinical Justification', type: 'textarea', placeholder: 'Indication for surgery' },
      ],
    },
    // ── Clinical Risk Profile ──
    {
      id: 'clinical_risk',
      title: 'Clinical Risk Profile',
      description: 'Co-morbidities, habits, and medication — critical for anaesthesia planning.',
      fields: [
        { key: 'known_comorbidities', label: 'Known Co-morbidities', type: 'multiselect', options: [
          { value: 'diabetes', label: 'Diabetes' },
          { value: 'cardiac_disease', label: 'Cardiac Disease' },
          { value: 'renal_disease', label: 'Renal Disease' },
          { value: 'respiratory_disease', label: 'Respiratory Disease' },
          { value: 'hypertension', label: 'Hypertension' },
          { value: 'thyroid', label: 'Thyroid' },
          { value: 'obesity', label: 'Obesity (BMI > 35)' },
          { value: 'anaemia', label: 'Anaemia' },
          { value: 'thrombocytopenia', label: 'Thrombocytopenia' },
          { value: 'none', label: 'None' },
        ] },
        { key: 'comorbidities_controlled', label: 'Are co-morbidities well controlled?', type: 'select', options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'unknown', label: 'Unknown' },
        ], helpText: 'Diabetes: HbA1c < 8, RBS < 180 · BP: < 150/100 on ≥2 readings · TSH: < 5 · Heart disease/CVD: cardiology clearance obtained · Renal: eGFR > 60 · BMI > 35: documented · Hb > 8 · Platelets > 80,000 · Respiratory: SpO2 > 94% on room air · Fever: resolved > 1 week ago', width: 'half' },
        { key: 'habits', label: 'Habits', type: 'multiselect', options: [
          { value: 'smoking', label: 'Smoking' },
          { value: 'alcohol', label: 'Alcohol' },
          { value: 'tobacco_chewing', label: 'Tobacco Chewing' },
          { value: 'none', label: 'None' },
        ], width: 'half' },
        { key: 'habits_stopped', label: 'Habits stopped 3+ days ago?', type: 'select', visibleWhen: { field: 'habits', operator: 'truthy' }, options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ], width: 'half' },
        { key: 'current_medication', label: 'Current Medication', type: 'textarea', placeholder: 'Active prescriptions, especially anticoagulants' },
        { key: 'referred_from_practitioner', label: 'Referred from Private Practitioner?', type: 'select', options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ], width: 'half' },
        { key: 'referring_doctor', label: 'Referring Doctor / Clinic', type: 'text', visibleWhen: { field: 'referred_from_practitioner', operator: 'eq', value: 'yes' }, placeholder: 'Name of referring practitioner', width: 'half' },
      ],
    },
    // ── OT Scheduling ──
    {
      id: 'ot_scheduling',
      title: 'OT Scheduling',
      description: 'Pre-anaesthetic status, preferred dates, and resource requirements.',
      fields: [
        { key: 'pac_status', label: 'PAC Status', type: 'select', options: [
          { value: 'not_done', label: 'Not Done' },
          { value: 'done_fit', label: 'Done — Fit' },
          { value: 'done_unfit', label: 'Done — Unfit' },
          { value: 'pending_review', label: 'Pending Review' },
        ], width: 'half' },
        { key: 'preferred_surgery_date', label: 'Preferred Surgery Date', type: 'date', width: 'half' },
        { key: 'preferred_surgery_time', label: 'Preferred Surgery Time', type: 'select', options: [
          { value: 'morning', label: 'Morning' },
          { value: 'afternoon', label: 'Afternoon' },
          { value: 'no_preference', label: 'No Preference' },
        ], width: 'half' },
        { key: 'estimated_duration', label: 'Estimated Duration', type: 'text', placeholder: 'e.g. 2 hours', width: 'half' },
        { key: 'anaesthesia_type', label: 'Anaesthesia Type', type: 'select', options: [
          { value: 'general', label: 'General (GA)' },
          { value: 'regional', label: 'Regional' },
          { value: 'local', label: 'Local' },
          { value: 'sedation', label: 'Sedation' },
          { value: 'tbd', label: 'TBD' },
        ], width: 'half' },
        { key: 'support_requirements', label: 'Support Requirements', type: 'textarea', placeholder: 'ICU bed, ventilator, blood products, etc.' },
        { key: 'special_requirements', label: 'Special Requirements', type: 'textarea', placeholder: 'Implants, consumables, special equipment' },
        { key: 'booking_notes', label: 'Additional Notes', type: 'textarea', placeholder: 'Any other information for the OT team' },
      ],
    },
  ],
};

// ============================================
// FORM REGISTRY — THE MASTER MAP
// ============================================

export const FORM_REGISTRY: Record<FormType, FormSchema> = {
  consolidated_marketing_handoff: CONSOLIDATED_MARKETING_HANDOFF,
  marketing_cc_handoff: MARKETING_CC_HANDOFF,  // legacy — kept for existing form submissions
  admission_advice: ADMISSION_ADVICE,
  financial_counseling: FINANCIAL_COUNSELING,
  surgery_booking: SURGERY_BOOKING,
  ot_billing_clearance: OT_BILLING_CLEARANCE,
  admission_checklist: ADMISSION_CHECKLIST,
  surgery_posting: SURGERY_POSTING,
  pre_op_nursing_checklist: PRE_OP_NURSING_CHECKLIST,
  who_safety_checklist: WHO_SAFETY_CHECKLIST,
  nursing_shift_handoff: NURSING_SHIFT_HANDOFF,
  discharge_readiness: DISCHARGE_READINESS,
  post_discharge_followup: POST_DISCHARGE_FOLLOWUP,
  daily_department_update: DAILY_DEPARTMENT_UPDATE,
  pac_clearance: PAC_CLEARANCE,
};

// ============================================
// FORM TYPE METADATA (for listings/dropdowns)
// ============================================

export const FORM_TYPE_LABELS: Record<FormType, string> = {
  consolidated_marketing_handoff: 'Marketing Handoff',
  marketing_cc_handoff: 'Marketing → CC Handoff',  // legacy label for existing submissions
  admission_advice: 'Admission Advice',
  financial_counseling: 'Financial Counseling',
  surgery_booking: 'Surgery Booking',
  ot_billing_clearance: 'OT Billing Clearance',
  admission_checklist: 'Admission Checklist',
  surgery_posting: 'Surgery Posting',
  pre_op_nursing_checklist: 'Pre-Op Nursing Checklist',
  who_safety_checklist: 'WHO Safety Checklist',
  nursing_shift_handoff: 'Nursing Shift Handoff',
  discharge_readiness: 'Discharge Readiness',
  post_discharge_followup: 'Post-Discharge Follow-up',
  daily_department_update: 'Daily Department Update',
  pac_clearance: 'PAC Clearance',
};

/**
 * Forms grouped by patient journey stage for quick access.
 * Updated for Intake-to-Outcome Pivot PRD v1.1 (8 Apr 2026):
 * - opd/pre_admission: Consolidated Marketing Handoff replaces separate forms
 * - admitted/pre_op: Standalone Financial Counseling + Surgery Booking for post-admission use
 */
export const FORMS_BY_STAGE: Record<string, FormType[]> = {
  // Sprint 1 Day 3 (23 Apr 2026): pruned `pre_op_nursing_checklist`, `who_safety_checklist`,
  // and `nursing_shift_handoff` from all stage menus. Their schemas remain in FORM_REGISTRY
  // so historical submissions still render correctly; they're just hidden from the stage picker.
  // Surgery-day safety will move to the state machine's day-of verification flow in Sprint 3.
  opd: ['consolidated_marketing_handoff', 'admission_advice'],
  pre_admission: ['consolidated_marketing_handoff', 'admission_advice'],
  admitted: ['financial_counseling', 'surgery_booking', 'admission_checklist'],
  pre_op: ['financial_counseling', 'surgery_booking', 'ot_billing_clearance', 'pac_clearance'],
  surgery: [],
  post_op: [],
  discharge: ['discharge_readiness'],
  post_discharge: ['post_discharge_followup'],
  medical_management: [],
  post_op_care: ['discharge_readiness'],
  long_term_followup: ['post_discharge_followup'],
  any: ['daily_department_update'], // stage-agnostic
};

/** All form types across all stages — used by the "Show all forms" toggle */
export const ALL_FORM_TYPES: FormType[] = [
  'consolidated_marketing_handoff',
  'admission_advice',
  'financial_counseling',
  'surgery_booking',
  'ot_billing_clearance',
  'admission_checklist',
  'surgery_posting',
  'pre_op_nursing_checklist',
  'who_safety_checklist',
  'nursing_shift_handoff',
  'discharge_readiness',
  'post_discharge_followup',
  'pac_clearance',
  'daily_department_update',
];
