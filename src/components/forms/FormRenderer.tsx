'use client';

// ============================================
// Rounds — Dynamic Form Renderer (Step 4.1)
// Reads a FormSchema and renders all sections
// and fields with validation and conditional
// visibility. Mobile-first layout.
// ============================================

import { useState, useCallback, useMemo } from 'react';
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
}: FormRendererProps) {
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
        <h2 className="text-xl font-semibold text-gray-900">{schema.title}</h2>
        <p className="mt-1 text-sm text-gray-600">{schema.description}</p>

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

      {/* Sections */}
      {schema.sections.map((section) => (
        <SectionRenderer
          key={section.id}
          section={section}
          formData={formData}
          setField={setField}
          touchField={touchField}
          touchedFields={touchedFields}
          errorMap={errorMap}
          isFieldVisible={isFieldVisible}
        />
      ))}

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
}: {
  section: FormSection;
  formData: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
  touchField: (key: string) => void;
  touchedFields: Set<string>;
  errorMap: Record<string, string>;
  isFieldVisible: (field: FormField) => boolean;
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
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  error?: string;
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
