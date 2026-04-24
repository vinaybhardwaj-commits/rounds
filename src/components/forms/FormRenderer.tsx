'use client';

// ============================================
// Rounds — Dynamic Form Renderer (Step 4.1)
// Reads a FormSchema and renders all sections
// and fields with validation and conditional
// visibility. Mobile-first layout.
// ============================================

import { useState, useCallback, useMemo, useEffect } from 'react';
import VersionHistoryDrawer from './VersionHistoryDrawer';
import { trackFeature } from '@/lib/session-tracker';
import {
  type FormSchema,
  type FormField,
  type FormSection,
  type ValidationError,
  validateFormData,
  computeCompletionScore,
  getAllFields,
} from '@/lib/form-registry';

// ============================================
// TYPES
// ============================================

interface FormRendererProps {
  schema: FormSchema;
  initialData?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>, completionScore: number) => void | Promise<void>;
  onSaveDraft?: (data: Record<string, unknown>) => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  /**
   * Sprint 1 Day 3 — when set, enables LSQ prefill block at the top of the form
   * and routes file-upload requests to include this patient_thread_id.
   */
  patientId?: string;
  /**
   * Sprint 1 Day 5 — when set, enables the "Version history" button on the form
   * header. currentFormId is optional; if provided, the drawer highlights the
   * currently-open submission in the timeline.
   */
  currentFormId?: string;
}

// Sprint 1 Day 5 — form types that participate in the version chain. Kept in
// sync with VERSIONED_FORM_TYPES in /api/forms/route.ts (server-side enforces).
const VERSIONED_FORM_TYPES = new Set([
  'consolidated_marketing_handoff',
  'financial_counseling',
  'surgery_booking',
  'admission_advice',
]);

// Sprint 1 Day 4 — doctor profile shape (from /api/doctors)
// 24 Apr 2026 added: specialty + is_surgical for Marketing Handoff auto-fill.
interface DoctorOption {
  id: string;
  name: string;
  email: string | null;
  role: string;
  primary_hospital_id: string | null;
  primary_hospital_slug: string | null;
  specialty?: string | null;
  is_surgical?: boolean;
}

// 24 Apr 2026 — surgical-specialty rule. Canonical specialties from the
// doctor roster mapped to boolean is_surgical. Kept in sync with the
// server-side rule in /api/doctors and the canonical specialty set in
// migration-reference-doctors-specialty.sql.
const SURGICAL_SPECIALTIES = new Set([
  'Dentistry', 'Dermatology', 'ENT', 'General Surgery', 'Neurosurgery',
  'Obstetrics & Gynecology', 'Oncology', 'Ophthalmology',
  'Oral & Maxillofacial Surgery', 'Orthopedics', 'Paediatric Surgery',
  'Plastic Surgery', 'Surgical Gastroenterology', 'Surgical Oncology',
  'Urology', 'Vascular Surgery',
]);
function isSurgicalSpecialty(spec: string | undefined | null): boolean {
  return !!spec && SURGICAL_SPECIALTIES.has(spec);
}

// Sprint 1 Day 3 — shape returned by /api/patients/[id]/lsq-prefill
interface LsqPrefillData {
  lsq_lead_id: string | null;
  name: string | null;
  age: number | null;
  gender: string | null;
  mobile: string | null;
  email: string | null;
  uhid: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  ailment: string | null;
  doctor_name: string | null;
  financial_category: string | null;
  is_existing_member: boolean | null;
  lsq_owner_name: string | null;
  lsq_last_synced_at: string | null;
  [key: string]: unknown;
}

// Sprint 1 Day 3 — shape stored in form_data for each uploaded file
interface UploadedFile {
  url: string;
  filename: string;
  size: number;
  contentType: string;
}

// ============================================
// COMPONENT
// ============================================

export default function FormRenderer({
  schema,
  initialData,
  onSubmit,
  onSaveDraft,
  isSubmitting = false,
  submitLabel = 'Submit Form',
  patientId,
  currentFormId,
}: FormRendererProps) {
  // Sprint 1 Day 5 — version history drawer state
  const showVersionButton = !!patientId && VERSIONED_FORM_TYPES.has(schema.formType);
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  // Sprint 1 Day 3 — LSQ prefill state (only loaded for consolidated_marketing_handoff)
  const showLsqPrefill = !!patientId && schema.formType === 'consolidated_marketing_handoff';
  const [lsqData, setLsqData] = useState<LsqPrefillData | null>(null);
  const [lsqLoading, setLsqLoading] = useState(false);
  const [lsqError, setLsqError] = useState<string | null>(null);

  const fetchLsqPrefill = useCallback(async () => {
    if (!showLsqPrefill) return;
    setLsqLoading(true);
    setLsqError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/lsq-prefill`);
      const body = await res.json();
      if (!res.ok || !body.success) {
        setLsqError(body.error || `HTTP ${res.status}`);
        setLsqData(null);
      } else if (!body.has_lsq_data) {
        setLsqData(null); // patient exists but no LSQ origin — hide the block
      } else {
        setLsqData(body.data as LsqPrefillData);
      }
    } catch (err) {
      setLsqError(err instanceof Error ? err.message : String(err));
    } finally {
      setLsqLoading(false);
    }
  }, [showLsqPrefill, patientId]);

  useEffect(() => {
    fetchLsqPrefill();
  }, [fetchLsqPrefill]);

  // Sprint 1 Day 4 — Doctor list for Picker B (admitting_doctor_id dropdown).
  // Loaded only for the handoff form. On no-doctors, the picker shows a
  // "no doctors on file" helper but remains usable (user types into the text
  // field instead).
  const usesPickerB = schema.formType === 'consolidated_marketing_handoff';
  const [doctorOptions, setDoctorOptions] = useState<DoctorOption[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);

  useEffect(() => {
    if (!usesPickerB) return;
    let cancelled = false;
    setDoctorsLoading(true);
    setDoctorsError(null);
    fetch('/api/doctors')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.success && Array.isArray(body.data)) {
          setDoctorOptions(body.data as DoctorOption[]);
        } else {
          setDoctorsError(body?.error || 'Failed to load doctors');
        }
      })
      .catch((e) => { if (!cancelled) setDoctorsError(String(e)); })
      .finally(() => { if (!cancelled) setDoctorsLoading(false); });
    return () => { cancelled = true; };
  }, [usesPickerB]);

  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const field of getAllFields(schema)) {
      if (field.defaultValue !== undefined) {
        defaults[field.key] = field.defaultValue;
      }
    }
    return { ...defaults, ...initialData };
  });

  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Error lookup by field key
  const errorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of errors) map[e.field] = e.message;
    return map;
  }, [errors]);

  // Update a single field
  const setField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    // Clear error for this field on change
    setErrors((prev) => prev.filter((e) => e.field !== key));
  }, []);

  // Sprint 1 Day 4 — Picker B side effect.
  // When admitting_doctor_id changes (and is non-empty), auto-fill target_opd_doctor
  // with the doctor's display name, then fetch their hospital affiliations and
  // auto-fill target_hospital with the primary. Marketing can override both.
  useEffect(() => {
    if (!usesPickerB) return;
    const docId = formData.admitting_doctor_id as string | undefined;
    if (!docId) return;

    // 24 Apr 2026 tweak: 'Other' clears the manual field so user starts fresh,
    // and skips affiliations lookup since there is no doctor ID to resolve.
    if (docId === 'other') {
      setFormData((prev) => ({ ...prev, target_opd_doctor: '' }));
      return;
    }

    const doc = doctorOptions.find((d) => d.id === docId);
    if (!doc) return;

    // Picker is authoritative for the doctor name — overwrite to reflect the
    // current selection. (Previously only filled when empty; that left stale
    // names when marketing switched between doctors.) Also auto-fills
    // target_department from doctor.specialty; user can edit.
    setFormData((prev) => ({
      ...prev,
      target_opd_doctor: doc.name,
      ...(doc.specialty ? { target_department: doc.specialty } : {}),
    }));

    let cancelled = false;
    fetch(`/api/doctors/${docId}/affiliations`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.success && body.primary_hospital_slug) {
          // Only set target_hospital if currently empty OR matches the picker-suggested
          // doctor's old primary (to avoid stomping a marketing override).
          setFormData((prev) => {
            if (!prev.target_hospital) {
              return { ...prev, target_hospital: body.primary_hospital_slug };
            }
            return prev;
          });
        }
      })
      .catch((e) => console.warn('[PickerB] affiliations lookup failed:', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.admitting_doctor_id, doctorOptions, usesPickerB]);

  // 24 Apr 2026 — Derived _is_surgical_case for Section C visibility. Runs
  // whenever target_department changes (from picker auto-fill, manual edit, or
  // specialty dropdown for 'Other'). Stored in form_data so the schema's
  // section.visibleWhen can read it. Harmless extra key in submissions.
  useEffect(() => {
    if (schema.formType !== 'consolidated_marketing_handoff') return;
    const spec = (formData.target_department as string | undefined) || '';
    const isSurg = isSurgicalSpecialty(spec);
    setFormData((prev) => {
      if (prev._is_surgical_case === isSurg) return prev;
      return { ...prev, _is_surgical_case: isSurg };
    });
  }, [formData.target_department, schema.formType]);

  // Mark field as touched on blur
  const touchField = useCallback((key: string) => {
    setTouchedFields((prev) => new Set(prev).add(key));
  }, []);

  // Check visibility condition
  const isFieldVisible = useCallback(
    (field: FormField): boolean => {
      if (!field.visibleWhen) return true;
      const val = formData[field.visibleWhen.field];
      switch (field.visibleWhen.operator) {
        case 'eq': return val === field.visibleWhen.value;
        case 'neq': return val !== field.visibleWhen.value;
        case 'in': return Array.isArray(field.visibleWhen.value) && (field.visibleWhen.value as unknown[]).includes(val);
        case 'truthy': return !!val;
        default: return true;
      }
    },
    [formData]
  );

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // Validate
      const validationErrors = validateFormData(schema, formData);
      if (validationErrors.length > 0) {
        setErrors(validationErrors);
        // Touch all fields to show errors
        setTouchedFields(new Set(getAllFields(schema).map((f) => f.key)));
        // Scroll to first error
        const firstErrorKey = validationErrors[0].field;
        const el = document.getElementById(`field-${firstErrorKey}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const score = computeCompletionScore(schema, formData);
      trackFeature('form_submit', { form_type: schema.type || schema.title, completion_score: Math.round(score * 100) });
      await onSubmit(formData, score);
    },
    [schema, formData, onSubmit]
  );

  // Completion progress
  const completionScore = useMemo(
    () => computeCompletionScore(schema, formData),
    [schema, formData]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Form header */}
      <div className="border-b border-gray-200 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-gray-900">{schema.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{schema.description}</p>
          </div>
          {/* Sprint 1 Day 5 — Version history button for any VERSIONED form */}
          {showVersionButton && (
            <button
              type="button"
              onClick={() => setVersionDrawerOpen(true)}
              className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Version history
            </button>
          )}
        </div>

        {/* Completion bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Completion</span>
            <span>{Math.round(completionScore * 100)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{
                width: `${completionScore * 100}%`,
                backgroundColor: completionScore === 1 ? '#22C55E' : completionScore > 0.5 ? '#F97316' : '#EF4444',
              }}
            />
          </div>
        </div>
      </div>

      {/* Sprint 1 Day 3 — LSQ prefill block (handoff form only, patient-driven) */}
      {showLsqPrefill && (lsqLoading || lsqData || lsqError) && (
        <LsqPrefillBlock
          data={lsqData}
          loading={lsqLoading}
          error={lsqError}
          onRefresh={fetchLsqPrefill}
        />
      )}

      {/* Sections */}
      {schema.sections.map((section) => {
        // 24 Apr 2026 — section-level visibleWhen. Skip the entire section
        // (no header, no fields) when the condition evaluates false.
        if (section.visibleWhen) {
          const condValue = formData[section.visibleWhen.field];
          const op = section.visibleWhen.operator;
          const want = section.visibleWhen.value;
          const met = op === 'truthy' ? !!condValue
            : op === 'eq' ? condValue === want
            : op === 'neq' ? condValue !== want
            : op === 'in' ? Array.isArray(want) && (want as unknown[]).includes(condValue)
            : false;
          if (!met) return null;
        }
        // Sprint 1 Day 4 — inject dynamic options into the admitting_doctor_id
        // select so Picker B shows the actual doctor list from /api/doctors.
        // Sprint 1 Day 4 + 24 Apr 2026 tweak: populate admitting_doctor_id
        // dropdown with live doctors + always append 'Other' so the user has
        // an explicit manual-entry path. target_opd_doctor (free text) is now
        // hidden when a real doctor is picked and shown only when the picker
        // is unset or 'Other' is chosen.
        const sectionForRender = usesPickerB && section.fields.some((f) => f.key === 'admitting_doctor_id')
          ? {
              ...section,
              fields: section.fields.map((f) => {
                if (f.key === 'admitting_doctor_id') {
                  return {
                    ...f,
                    options: [
                      ...doctorOptions.map((d) => ({
                        value: d.id,
                        label: `${d.name}${d.primary_hospital_slug ? ` · ${d.primary_hospital_slug.toUpperCase()}` : ''}`,
                      })),
                      { value: 'other', label: 'Other — type manually' },
                    ],
                    helpText: doctorsLoading
                      ? 'Loading doctor list…'
                      : doctorsError
                      ? `Couldn't load doctors: ${doctorsError}. Choose Other to type a name.`
                      : doctorOptions.length === 0
                      ? 'No doctors seeded yet. Choose Other to type the name.'
                      : 'Pick a doctor, or choose Other to type manually.',
                  };
                }
                if (f.key === 'target_opd_doctor') {
                  // Hide unless picker is empty or 'Other'. 'in' operator supports
                  // array membership; undefined and '' both count as 'not picked'.
                  return {
                    ...f,
                    visibleWhen: {
                      field: 'admitting_doctor_id',
                      operator: 'in' as const,
                      value: ['', 'other', undefined, null],
                    },
                    label: 'Admitting Doctor — Manual Entry',
                    helpText: 'Shown because you chose Other (or haven\u2019t picked yet). Type the full name here.',
                  };
                }
                return f;
              }),
            }
          : section;
        return (
          <SectionRenderer
            key={section.id}
            section={sectionForRender}
            formData={formData}
            setField={setField}
            touchField={touchField}
            touchedFields={touchedFields}
            errorMap={errorMap}
            isFieldVisible={isFieldVisible}
            patientId={patientId}
          />
        );
      })}

      {/* Validation error summary */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800">
            Please fix {errors.length} error{errors.length > 1 ? 's' : ''} before submitting:
          </p>
          <ul className="mt-2 text-sm text-red-700 list-disc list-inside">
            {errors.map((e) => (
              <li key={e.field}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Submitting...' : submitLabel}
        </button>
        {onSaveDraft && (
          <button
            type="button"
            onClick={() => onSaveDraft(formData)}
            disabled={isSubmitting}
            className="px-6 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Save Draft
          </button>
        )}
      </div>

      {/* Sprint 1 Day 5 — version history drawer (mounted once; open state toggles) */}
      {showVersionButton && patientId && (
        <VersionHistoryDrawer
          patientThreadId={patientId}
          formType={schema.formType}
          currentFormId={currentFormId}
          open={versionDrawerOpen}
          onClose={() => setVersionDrawerOpen(false)}
        />
      )}
    </form>
  );
}

// ============================================
// SECTION RENDERER
// ============================================

function SectionRenderer({
  section,
  formData,
  setField,
  touchField,
  touchedFields,
  errorMap,
  isFieldVisible,
  patientId,
}: {
  section: FormSection;
  formData: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
  touchField: (key: string) => void;
  touchedFields: Set<string>;
  errorMap: Record<string, string>;
  isFieldVisible: (field: FormField) => boolean;
  /** Sprint 1 Day 3 — forwarded to file-type fields for patient-linked uploads */
  patientId?: string;
}) {
  const visibleFields = section.fields.filter(isFieldVisible);
  if (visibleFields.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
      <h3 className="text-base font-semibold text-gray-800">{section.title}</h3>
      {section.description && (
        <p className="mt-1 text-sm text-gray-500">{section.description}</p>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-6 gap-4">
        {visibleFields.map((field) => {
          const colSpan =
            field.width === 'third' ? 'sm:col-span-2' :
            field.width === 'half' ? 'sm:col-span-3' :
            'sm:col-span-6';

          return (
            <div key={field.key} id={`field-${field.key}`} className={colSpan}>
              <FieldRenderer
                field={field}
                value={formData[field.key]}
                onChange={(val) => setField(field.key, val)}
                onBlur={() => touchField(field.key)}
                error={touchedFields.has(field.key) ? errorMap[field.key] : undefined}
                patientId={patientId}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// FIELD RENDERER
// ============================================

function FieldRenderer({
  field,
  value,
  onChange,
  onBlur,
  error,
  patientId,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  error?: string;
  /** Sprint 1 Day 3 — passed to file-type uploads so they tag with patient_thread_id */
  patientId?: string;
}) {
  const isRequired = field.validation?.required;
  const hasReadiness = !!field.readinessItem;

  const labelEl = (
    <label
      htmlFor={`input-${field.key}`}
      className="block text-sm font-medium text-gray-700 mb-1"
    >
      {field.label}
      {isRequired && <span className="text-red-500 ml-0.5">*</span>}
      {hasReadiness && (
        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
          Readiness
        </span>
      )}
    </label>
  );

  const inputClasses = `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
    error ? 'border-red-300 bg-red-50' : 'border-gray-300'
  }`;

  const errorEl = error ? (
    <p className="mt-1 text-xs text-red-600">{error}</p>
  ) : null;

  const helpEl = field.helpText ? (
    <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
  ) : null;

  // CHECKBOX — special layout
  if (field.type === 'checkbox') {
    return (
      <div className="flex items-start gap-3 py-1">
        <input
          id={`input-${field.key}`}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <div className="flex-1 min-w-0">
          <label htmlFor={`input-${field.key}`} className="text-sm text-gray-700 cursor-pointer">
            {field.label}
            {isRequired && <span className="text-red-500 ml-0.5">*</span>}
            {hasReadiness && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                Readiness
              </span>
            )}
          </label>
          {helpEl}
          {errorEl}
        </div>
      </div>
    );
  }

  // RADIO — special layout
  if (field.type === 'radio' && field.options) {
    return (
      <div>
        {labelEl}
        <div className="flex flex-wrap gap-4 mt-1">
          {field.options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`input-${field.key}`}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
                onBlur={onBlur}
                className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
        {helpEl}
        {errorEl}
      </div>
    );
  }

  // TEXTAREA
  if (field.type === 'textarea') {
    return (
      <div>
        {labelEl}
        <textarea
          id={`input-${field.key}`}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={field.placeholder}
          rows={3}
          className={inputClasses + ' resize-y'}
          maxLength={field.validation?.maxLength}
        />
        {helpEl}
        {errorEl}
      </div>
    );
  }

  // SELECT
  if (field.type === 'select' && field.options) {
    return (
      <div>
        {labelEl}
        <select
          id={`input-${field.key}`}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          onBlur={onBlur}
          className={inputClasses}
        >
          <option value="">— Select —</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {helpEl}
        {errorEl}
      </div>
    );
  }

  // MULTISELECT (render as checkboxes)
  if (field.type === 'multiselect' && field.options) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        {labelEl}
        <div className="mt-1 space-y-2">
          {field.options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, opt.value]
                    : selected.filter((v) => v !== opt.value);
                  onChange(next);
                }}
                onBlur={onBlur}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
        {helpEl}
        {errorEl}
      </div>
    );
  }

  // NUMBER
  if (field.type === 'number') {
    return (
      <div>
        {labelEl}
        <input
          id={`input-${field.key}`}
          type="number"
          value={value !== undefined && value !== null ? String(value) : ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? undefined : parseFloat(v));
          }}
          onBlur={onBlur}
          placeholder={field.placeholder}
          min={field.validation?.min}
          max={field.validation?.max}
          className={inputClasses}
        />
        {helpEl}
        {errorEl}
      </div>
    );
  }

  // FILE (Sprint 1 Day 3 — multi-file upload via Vercel Blob)
  if (field.type === 'file') {
    const files = (Array.isArray(value) ? value : []) as UploadedFile[];
    return (
      <FileUploadField
        field={field}
        files={files}
        onChange={onChange}
        error={error}
        labelEl={labelEl}
        helpEl={helpEl}
        errorEl={errorEl}
        patientId={patientId}
      />
    );
  }

  // DATE / DATETIME / TIME
  if (field.type === 'date' || field.type === 'datetime' || field.type === 'time') {
    const inputType = field.type === 'datetime' ? 'datetime-local' : field.type;
    return (
      <div>
        {labelEl}
        <input
          id={`input-${field.key}`}
          type={inputType}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          onBlur={onBlur}
          className={inputClasses}
        />
        {helpEl}
        {errorEl}
      </div>
    );
  }

  // TEXT / PHONE / EMAIL (default)
  return (
    <div>
      {labelEl}
      <input
        id={`input-${field.key}`}
        type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
        readOnly={field.readonly}
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={field.placeholder}
        maxLength={field.validation?.maxLength}
        className={inputClasses}
      />
      {helpEl}
      {errorEl}
    </div>
  );
}

// ============================================
// LSQ PREFILL BLOCK (Sprint 1 Day 3)
// ============================================
// Read-only summary of LSQ-originated patient data. Renders at the top of
// the consolidated_marketing_handoff form to give Marketing instant visibility
// into everything LSQ already knows about this lead — they just confirm + add
// the new fields, instead of re-typing name/mobile/UTM.

function LsqPrefillBlock({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: LsqPrefillData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-blue-900">From LeadSquared</h3>
          <p className="mt-0.5 text-xs text-blue-700">
            LSQ-captured data for this lead. Read-only — LSQ is the source of truth.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="px-2 py-1 text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-700">Failed to load LSQ data: {error}</p>
      )}

      {loading && !data && (
        <p className="mt-3 text-xs text-blue-700">Loading…</p>
      )}

      {data && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <LsqField label="Name" value={data.name} />
          <LsqField label="Age" value={data.age != null ? String(data.age) : null} />
          <LsqField label="Gender" value={data.gender} />
          <LsqField label="Mobile" value={data.mobile} />
          <LsqField label="Email" value={data.email} />
          <LsqField label="UHID" value={data.uhid} />
          <LsqField label="Ailment" value={data.ailment} />
          <LsqField label="Doctor" value={data.doctor_name} />
          <LsqField label="Financial Cat." value={data.financial_category} />
          <LsqField label="Existing Member" value={data.is_existing_member === true ? 'Yes' : data.is_existing_member === false ? 'No' : null} />
          <LsqField label="UTM Source" value={data.utm_source} />
          <LsqField label="UTM Campaign" value={data.utm_campaign} />
          <LsqField label="LSQ Owner" value={data.lsq_owner_name} />
          <LsqField label="Last Sync" value={data.lsq_last_synced_at ? new Date(data.lsq_last_synced_at).toLocaleString() : null} />
        </dl>
      )}
    </div>
  );
}

function LsqField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-blue-700 font-medium">{label}</dt>
      <dd className="text-gray-900">{value ?? <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

// ============================================
// FILE UPLOAD FIELD (Sprint 1 Day 3)
// ============================================
// Handles multi-file upload to /api/files/upload (Vercel Blob). Stores
// { url, filename, size, contentType }[] in formData[field.key]. Existing
// uploads are shown with a remove button. Uploads happen on <input change>.

function FileUploadField({
  field,
  files,
  onChange,
  labelEl,
  helpEl,
  errorEl,
  patientId,
}: {
  field: FormField;
  files: UploadedFile[];
  onChange: (value: unknown) => void;
  error?: string;
  labelEl: React.ReactNode;
  helpEl: React.ReactNode;
  errorEl: React.ReactNode;
  patientId?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const newFiles: UploadedFile[] = [];
    try {
      for (const file of Array.from(fileList)) {
        const fd = new FormData();
        fd.append('file', file);
        if (patientId) fd.append('patient_thread_id', patientId);
        fd.append('category', 'handoff_attachment');
        fd.append('link_context', `form:${field.key}`);
        const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
        const body = await res.json();
        if (!res.ok || !body.success) {
          throw new Error(body.error || `Upload failed for ${file.name} (HTTP ${res.status})`);
        }
        newFiles.push({
          url: body.data?.url ?? body.url,
          filename: body.data?.filename ?? file.name,
          size: file.size,
          contentType: file.type,
        });
      }
      onChange([...files, ...newFiles]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {labelEl}
      <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-3">
        <input
          id={`input-${field.key}`}
          type="file"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          disabled={uploading}
          className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:hover:bg-blue-700 file:disabled:opacity-50"
        />
        {uploading && <p className="mt-2 text-xs text-blue-700">Uploading…</p>}
        {uploadError && <p className="mt-2 text-xs text-red-700">{uploadError}</p>}

        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs">
            {files.map((f, i) => (
              <li key={`${f.url}-${i}`} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1">
                <a href={f.url} target="_blank" rel="noreferrer" className="truncate text-blue-700 hover:underline">
                  {f.filename}
                </a>
                <span className="flex-shrink-0 text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  className="flex-shrink-0 text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {helpEl}
      {errorEl}
    </div>
  );
}
