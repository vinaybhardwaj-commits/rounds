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
  | 'email';

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

    // Required check
    const isRequired = v.required || evaluateRequiredIf(v.requiredIf, data);
    if (isRequired && isEmpty(value)) {
      errors.push({ field: field.key, message: `${field.label} is required` });
      continue; // skip further checks for empty required field
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
// 3–13. REMAINING FORM SCHEMAS (skeletons)
// These have the core sections defined but
// fewer fields — to be fleshed out in Step 4.2/4.3
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
      fields: [
        { key: 'diagnosis', label: 'Diagnosis', type: 'text', validation: { required: true } },
        { key: 'reason_for_admission', label: 'Reason for Admission', type: 'textarea', validation: { required: true } },
        { key: 'admission_type', label: 'Admission Type', type: 'select', validation: { required: true }, options: [
          { value: 'elective', label: 'Elective' }, { value: 'emergency', label: 'Emergency' }, { value: 'daycare', label: 'Day Care' },
        ], width: 'half' },
        { key: 'preferred_date', label: 'Preferred Admission Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'expected_los', label: 'Expected Length of Stay (days)', type: 'number', validation: { min: 1, max: 90 }, width: 'half' },
        { key: 'room_preference', label: 'Room Category Preference', type: 'select', options: [
          { value: 'general', label: 'General Ward' }, { value: 'semi_private', label: 'Semi-Private' },
          { value: 'private', label: 'Private' }, { value: 'suite', label: 'Suite' },
        ], width: 'half' },
        { key: 'special_instructions', label: 'Special Instructions', type: 'textarea' },
      ],
    },
  ],
};

export const FINANCIAL_COUNSELING: FormSchema = {
  formType: 'financial_counseling',
  title: 'Financial Counseling Sheet',
  description: 'Capture financial discussion with patient/attendant before admission.',
  version: 1,
  stages: ['pre_admission'],
  submitterRoles: ['billing_executive', 'insurance_coordinator', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'financial_details',
      title: 'Financial Details',
      fields: [
        { key: 'payment_mode', label: 'Payment Mode', type: 'select', validation: { required: true }, options: [
          { value: 'cash', label: 'Cash / Self-Pay' }, { value: 'insurance', label: 'Insurance' },
          { value: 'corporate', label: 'Corporate' }, { value: 'credit', label: 'Credit' },
        ], width: 'half' },
        { key: 'package_name', label: 'Package Name', type: 'text', width: 'half' },
        { key: 'estimated_cost', label: 'Estimated Total Cost (₹)', type: 'number', validation: { required: true, min: 0 }, width: 'half' },
        { key: 'deposit_amount', label: 'Deposit Amount (₹)', type: 'number', validation: { min: 0 }, width: 'half' },
        { key: 'deposit_collected', label: 'Deposit Collected', type: 'checkbox',
          readinessItem: { itemName: 'Deposit collected', category: 'billing', responsibleRole: 'billing_executive', slaHours: 24 } },
        { key: 'insurance_provider', label: 'Insurance Provider', type: 'text', visibleWhen: { field: 'payment_mode', operator: 'eq', value: 'insurance' }, width: 'half' },
        { key: 'policy_number', label: 'Policy Number', type: 'text', visibleWhen: { field: 'payment_mode', operator: 'eq', value: 'insurance' }, width: 'half' },
        { key: 'preauth_required', label: 'Pre-Authorization Required', type: 'checkbox', visibleWhen: { field: 'payment_mode', operator: 'eq', value: 'insurance' } },
        { key: 'counseling_notes', label: 'Counseling Notes', type: 'textarea' },
        { key: 'patient_signature_obtained', label: 'Patient / attendant acknowledged estimate', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Financial estimate acknowledged', category: 'consent', responsibleRole: 'billing_executive', slaHours: 4 } },
      ],
    },
  ],
};

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
      id: 'billing_clearance',
      title: 'Billing Clearance',
      fields: [
        { key: 'total_estimate', label: 'Total Surgery Estimate (₹)', type: 'number', validation: { required: true, min: 0 } },
        { key: 'deposit_received', label: 'Deposit Received (₹)', type: 'number', validation: { required: true, min: 0 }, width: 'half' },
        { key: 'outstanding_balance', label: 'Outstanding Balance (₹)', type: 'number', width: 'half' },
        { key: 'clearance_status', label: 'Clearance Status', type: 'select', validation: { required: true }, options: [
          { value: 'cleared', label: 'Cleared — Proceed' }, { value: 'conditional', label: 'Conditional — Pending balance' },
          { value: 'blocked', label: 'Blocked — Not cleared' },
        ] },
        { key: 'billing_cleared', label: 'Billing clearance confirmed', type: 'checkbox',
          readinessItem: { itemName: 'OT billing clearance confirmed', category: 'billing', responsibleRole: 'billing_executive', slaHours: 4 } },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
  ],
};

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
      id: 'checklist',
      title: 'Admission Checklist Items',
      fields: [
        { key: 'id_verified', label: 'Patient identity verified (Aadhaar / ID)', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'Patient identity verified', category: 'consent', responsibleRole: 'ip_coordinator', slaHours: 2 } },
        { key: 'consent_general', label: 'General consent for treatment signed', type: 'checkbox',
          readinessItem: { itemName: 'General consent signed', category: 'consent', responsibleRole: 'ip_coordinator', slaHours: 2 } },
        { key: 'room_assigned', label: 'Room / bed assigned', type: 'checkbox',
          readinessItem: { itemName: 'Room assigned', category: 'logistics', responsibleRole: 'ip_coordinator', slaHours: 1 } },
        { key: 'room_number', label: 'Room Number', type: 'text', visibleWhen: { field: 'room_assigned', operator: 'truthy' }, width: 'half' },
        { key: 'vitals_recorded', label: 'Admission vitals recorded', type: 'checkbox',
          readinessItem: { itemName: 'Admission vitals recorded', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'diet_order_placed', label: 'Diet order placed', type: 'checkbox',
          readinessItem: { itemName: 'Diet order placed', category: 'nursing', responsibleRole: 'nurse', slaHours: 2 } },
        { key: 'pharmacy_notified', label: 'Pharmacy notified of admission', type: 'checkbox',
          readinessItem: { itemName: 'Pharmacy notified', category: 'logistics', responsibleRole: 'pharmacist', slaHours: 1 } },
        { key: 'notes', label: 'Admission Notes', type: 'textarea' },
      ],
    },
  ],
};

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
      id: 'pre_op_checks',
      title: 'Pre-Op Checks',
      fields: [
        { key: 'npo_verified', label: 'NPO status verified', type: 'checkbox',
          readinessItem: { itemName: 'NPO status verified (nursing)', category: 'nursing', responsibleRole: 'nurse', slaHours: 2 } },
        { key: 'pre_op_vitals', label: 'Pre-op vitals recorded', type: 'checkbox',
          readinessItem: { itemName: 'Pre-op vitals recorded', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'iv_line_secured', label: 'IV line secured', type: 'checkbox',
          readinessItem: { itemName: 'IV line secured', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'prep_done', label: 'Surgical site prep done', type: 'checkbox',
          readinessItem: { itemName: 'Surgical site prep done', category: 'nursing', responsibleRole: 'nurse', slaHours: 2 } },
        { key: 'jewelry_removed', label: 'Jewelry / dentures / prosthetics removed', type: 'checkbox',
          readinessItem: { itemName: 'Personal items secured', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'premed_given', label: 'Pre-medication administered', type: 'checkbox',
          readinessItem: { itemName: 'Pre-medication given', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'patient_gown', label: 'Patient in OT gown', type: 'checkbox',
          readinessItem: { itemName: 'Patient in OT gown', category: 'nursing', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'file_complete', label: 'Patient file accompanies patient', type: 'checkbox',
          readinessItem: { itemName: 'Patient file with patient', category: 'investigation', responsibleRole: 'nurse', slaHours: 1 } },
        { key: 'notes', label: 'Nursing Notes', type: 'textarea' },
      ],
    },
  ],
};

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
      fields: [
        { key: 'si_identity_confirmed', label: 'Patient identity confirmed', type: 'checkbox', validation: { required: true } },
        { key: 'si_site_marked', label: 'Site marked / not applicable', type: 'checkbox', validation: { required: true } },
        { key: 'si_consent_confirmed', label: 'Consent confirmed', type: 'checkbox', validation: { required: true } },
        { key: 'si_pulse_ox', label: 'Pulse oximeter on patient and functioning', type: 'checkbox', validation: { required: true } },
        { key: 'si_allergy_checked', label: 'Known allergy checked', type: 'checkbox', validation: { required: true } },
        { key: 'si_airway_assessed', label: 'Difficult airway / aspiration risk assessed', type: 'checkbox', validation: { required: true } },
        { key: 'si_blood_loss_risk', label: 'Risk of >500ml blood loss planned for', type: 'checkbox', validation: { required: true } },
      ],
    },
    {
      id: 'time_out',
      title: 'Time Out (Before Incision)',
      fields: [
        { key: 'to_team_introduced', label: 'All team members introduced by name and role', type: 'checkbox', validation: { required: true } },
        { key: 'to_patient_confirmed', label: 'Patient name, procedure, and site confirmed', type: 'checkbox', validation: { required: true } },
        { key: 'to_antibiotics_given', label: 'Antibiotic prophylaxis given within last 60 minutes', type: 'checkbox' },
        { key: 'to_imaging_displayed', label: 'Essential imaging displayed', type: 'checkbox' },
        { key: 'to_critical_steps', label: 'Critical steps / equipment concerns discussed', type: 'checkbox', validation: { required: true } },
      ],
    },
    {
      id: 'sign_out',
      title: 'Sign Out (Before Patient Leaves OT)',
      fields: [
        { key: 'so_procedure_recorded', label: 'Procedure name recorded', type: 'checkbox', validation: { required: true } },
        { key: 'so_counts_complete', label: 'Instrument, sponge, needle counts correct', type: 'checkbox', validation: { required: true } },
        { key: 'so_specimen_labeled', label: 'Specimen labeled correctly', type: 'checkbox' },
        { key: 'so_equipment_issues', label: 'Equipment problems addressed', type: 'checkbox' },
        { key: 'so_recovery_plan', label: 'Recovery and post-op plan communicated', type: 'checkbox', validation: { required: true } },
      ],
    },
  ],
};

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
      id: 'handoff',
      title: 'Shift Handoff',
      fields: [
        { key: 'outgoing_shift', label: 'Outgoing Shift', type: 'select', validation: { required: true }, options: [
          { value: 'day', label: 'Day (8AM–2PM)' }, { value: 'evening', label: 'Evening (2PM–8PM)' },
          { value: 'night', label: 'Night (8PM–8AM)' },
        ], width: 'half' },
        { key: 'incoming_shift', label: 'Incoming Shift', type: 'select', validation: { required: true }, options: [
          { value: 'day', label: 'Day (8AM–2PM)' }, { value: 'evening', label: 'Evening (2PM–8PM)' },
          { value: 'night', label: 'Night (8PM–8AM)' },
        ], width: 'half' },
        { key: 'current_status', label: 'Current Patient Status', type: 'textarea', validation: { required: true }, placeholder: 'Brief clinical status, vitals summary' },
        { key: 'active_orders', label: 'Active Orders / Medications', type: 'textarea', validation: { required: true } },
        { key: 'pending_tasks', label: 'Pending Tasks for Next Shift', type: 'textarea' },
        { key: 'alerts', label: 'Alerts / Special Precautions', type: 'textarea', placeholder: 'Fall risk, allergy alerts, isolation, etc.' },
        { key: 'family_communication', label: 'Family Communication Notes', type: 'textarea' },
      ],
    },
  ],
};

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
      fields: [
        { key: 'clinically_stable', label: 'Patient clinically stable', type: 'checkbox',
          readinessItem: { itemName: 'Clinically stable', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 4 } },
        { key: 'discharge_summary_ready', label: 'Discharge summary prepared', type: 'checkbox',
          readinessItem: { itemName: 'Discharge summary prepared', category: 'investigation', responsibleRole: 'clinical_care', slaHours: 4 } },
        { key: 'medications_prescribed', label: 'Discharge medications prescribed', type: 'checkbox',
          readinessItem: { itemName: 'Discharge medications prescribed', category: 'clearance', responsibleRole: 'clinical_care', slaHours: 2 } },
      ],
    },
    {
      id: 'billing',
      title: 'Financial Clearance',
      fields: [
        { key: 'final_bill_prepared', label: 'Final bill prepared', type: 'checkbox',
          readinessItem: { itemName: 'Final bill prepared', category: 'billing', responsibleRole: 'billing_executive', slaHours: 4 } },
        { key: 'payment_settled', label: 'Payment settled / insurance claim filed', type: 'checkbox',
          readinessItem: { itemName: 'Payment settled', category: 'billing', responsibleRole: 'billing_executive', slaHours: 4 } },
      ],
    },
    {
      id: 'nursing',
      title: 'Nursing Discharge',
      fields: [
        { key: 'patient_education', label: 'Patient / attendant educated on care at home', type: 'checkbox',
          readinessItem: { itemName: 'Discharge education given', category: 'nursing', responsibleRole: 'nurse', slaHours: 2 } },
        { key: 'pharmacy_meds_dispensed', label: 'Pharmacy medications dispensed', type: 'checkbox',
          readinessItem: { itemName: 'Medications dispensed', category: 'logistics', responsibleRole: 'pharmacist', slaHours: 2 } },
        { key: 'follow_up_scheduled', label: 'Follow-up appointment scheduled', type: 'checkbox',
          readinessItem: { itemName: 'Follow-up scheduled', category: 'logistics', responsibleRole: 'ip_coordinator', slaHours: 2 } },
        { key: 'transport_arranged', label: 'Transport arranged', type: 'checkbox' },
      ],
    },
  ],
};

export const POST_DISCHARGE_FOLLOWUP: FormSchema = {
  formType: 'post_discharge_followup',
  title: 'Post-Discharge Follow-up',
  description: 'Track post-discharge follow-up calls and patient recovery status.',
  version: 1,
  stages: ['post_discharge'],
  submitterRoles: ['nurse', 'ip_coordinator', 'clinical_care', 'super_admin'],
  requiresPatient: true,
  sections: [
    {
      id: 'followup',
      title: 'Follow-up Details',
      fields: [
        { key: 'followup_date', label: 'Follow-up Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'followup_type', label: 'Follow-up Type', type: 'select', validation: { required: true }, options: [
          { value: 'phone_call', label: 'Phone Call' }, { value: 'in_person', label: 'In-Person Visit' },
          { value: 'teleconsult', label: 'Teleconsult' },
        ], width: 'half' },
        { key: 'patient_status', label: 'Patient Reported Status', type: 'select', options: [
          { value: 'recovering_well', label: 'Recovering Well' }, { value: 'some_concerns', label: 'Some Concerns' },
          { value: 'needs_attention', label: 'Needs Medical Attention' }, { value: 'readmission', label: 'Readmission Required' },
        ] },
        { key: 'pain_level', label: 'Pain Level (0-10)', type: 'number', validation: { min: 0, max: 10 }, width: 'half' },
        { key: 'medication_adherence', label: 'Taking medications as prescribed', type: 'radio', options: [
          { value: 'yes', label: 'Yes' }, { value: 'partial', label: 'Partially' }, { value: 'no', label: 'No' },
        ], width: 'half' },
        { key: 'wound_status', label: 'Wound / Incision Status', type: 'select', options: [
          { value: 'clean_dry', label: 'Clean & Dry' }, { value: 'mild_redness', label: 'Mild Redness' },
          { value: 'discharge', label: 'Discharge Present' }, { value: 'infection_suspected', label: 'Infection Suspected' },
        ] },
        { key: 'notes', label: 'Follow-up Notes', type: 'textarea' },
      ],
    },
  ],
};

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
      id: 'daily_update',
      title: 'Department Update',
      fields: [
        { key: 'date', label: 'Date', type: 'date', validation: { required: true }, width: 'half' },
        { key: 'total_patients', label: 'Total Patients (current census)', type: 'number', validation: { required: true, min: 0 }, width: 'half' },
        { key: 'new_admissions', label: 'New Admissions Today', type: 'number', validation: { min: 0 }, width: 'third' },
        { key: 'discharges_planned', label: 'Discharges Planned', type: 'number', validation: { min: 0 }, width: 'third' },
        { key: 'surgeries_scheduled', label: 'Surgeries Scheduled', type: 'number', validation: { min: 0 }, width: 'third' },
        { key: 'critical_patients', label: 'Critical Patients / Alerts', type: 'textarea' },
        { key: 'pending_issues', label: 'Pending Issues / Escalations', type: 'textarea' },
        { key: 'staffing_issues', label: 'Staffing Concerns', type: 'textarea' },
        { key: 'equipment_issues', label: 'Equipment / Facility Issues', type: 'textarea' },
        { key: 'general_remarks', label: 'General Remarks', type: 'textarea' },
      ],
    },
  ],
};

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
      id: 'pac',
      title: 'Pre-Anesthetic Assessment',
      fields: [
        { key: 'asa_grade', label: 'ASA Physical Status', type: 'select', validation: { required: true }, options: [
          { value: '1', label: 'ASA I — Healthy' }, { value: '2', label: 'ASA II — Mild systemic disease' },
          { value: '3', label: 'ASA III — Severe systemic disease' }, { value: '4', label: 'ASA IV — Life-threatening' },
        ], width: 'half' },
        { key: 'anesthesia_plan', label: 'Anesthesia Plan', type: 'select', validation: { required: true }, options: [
          { value: 'general', label: 'General' }, { value: 'spinal', label: 'Spinal' },
          { value: 'epidural', label: 'Epidural' }, { value: 'regional', label: 'Regional Block' },
          { value: 'local', label: 'Local' }, { value: 'sedation', label: 'IV Sedation' },
        ], width: 'half' },
        { key: 'airway_assessment', label: 'Airway Assessment', type: 'select', options: [
          { value: 'normal', label: 'Normal' }, { value: 'anticipated_difficult', label: 'Anticipated Difficult' },
        ], width: 'half' },
        { key: 'mallampati', label: 'Mallampati Grade', type: 'select', options: [
          { value: '1', label: 'Grade I' }, { value: '2', label: 'Grade II' },
          { value: '3', label: 'Grade III' }, { value: '4', label: 'Grade IV' },
        ], width: 'half' },
        { key: 'investigations_reviewed', label: 'All investigations reviewed', type: 'checkbox', validation: { required: true } },
        { key: 'fit_for_anesthesia', label: 'Patient fit for anesthesia', type: 'checkbox', validation: { required: true },
          readinessItem: { itemName: 'PAC clearance — fit for anesthesia', category: 'clearance', responsibleRole: 'anesthesiologist', slaHours: 24 } },
        { key: 'special_precautions', label: 'Special Precautions / Instructions', type: 'textarea' },
        { key: 'pre_op_orders', label: 'Pre-Op Orders', type: 'textarea', placeholder: 'NPO timing, pre-medication, etc.' },
      ],
    },
  ],
};

// ============================================
// FORM REGISTRY — THE MASTER MAP
// ============================================

export const FORM_REGISTRY: Record<FormType, FormSchema> = {
  marketing_cc_handoff: MARKETING_CC_HANDOFF,
  admission_advice: ADMISSION_ADVICE,
  financial_counseling: FINANCIAL_COUNSELING,
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
  marketing_cc_handoff: 'Marketing → CC Handoff',
  admission_advice: 'Admission Advice',
  financial_counseling: 'Financial Counseling',
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

/** Forms grouped by patient journey stage for quick access */
export const FORMS_BY_STAGE: Record<string, FormType[]> = {
  opd: ['marketing_cc_handoff', 'admission_advice'],
  pre_admission: ['marketing_cc_handoff', 'admission_advice', 'financial_counseling'],
  admitted: ['admission_checklist', 'nursing_shift_handoff'],
  pre_op: ['surgery_posting', 'pre_op_nursing_checklist', 'ot_billing_clearance', 'pac_clearance'],
  surgery: ['who_safety_checklist'],
  post_op: ['nursing_shift_handoff'],
  discharge: ['discharge_readiness'],
  post_discharge: ['post_discharge_followup'],
  any: ['daily_department_update'], // stage-agnostic
};
