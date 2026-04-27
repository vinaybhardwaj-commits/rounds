'use client';

// =============================================================================
// HospitalPicker — mandatory hospital picker for multi-hospital users
//
// Per Multi-Hospital v2 PRD §7.1 + Q3 (mandatory, no default for multi_hospital
// scope) + Q4 refined (no cross-field reactivity — picker is independent of
// any other picker; server validates compatibility on submit).
//
// USAGE
//   <HospitalPicker
//     value={hospitalId}
//     onChange={setHospitalId}
//     required
//     name="target_hospital_id"
//   />
//
// BEHAVIOR
//   - Fetches /api/hospitals/accessible on mount (cached for the form's lifetime)
//   - For users whose accessible list = 1 hospital: auto-fills + renders
//     disabled/read-only with the hospital name + a small lock icon
//   - For users with N > 1 accessible hospitals: required picker with no default;
//     submit blocks until picked
//   - Filters out is_active=false hospitals (handled server-side by the API)
//
// NO CROSS-FIELD REACTIVITY (Q4 refinement)
//   This component does NOT filter or constrain other pickers (consultant,
//   doctor, etc.). The server validates compatibility on submit and returns
//   400 with field: 'consultant_id' if mismatched.
// =============================================================================

import { useState, useEffect, useMemo } from 'react';
import { Lock, ChevronDown } from 'lucide-react';

interface AccessibleHospital {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
}

interface HospitalPickerProps {
  /** Currently-picked hospital UUID (controlled). */
  value: string | null;
  /** Called when user picks (or auto-fill resolves). */
  onChange: (hospitalId: string) => void;
  /** Form field name for native form submission. */
  name?: string;
  /** Render as required (shows asterisk + form validation). Default: true. */
  required?: boolean;
  /** Additional className for the wrapper div. */
  className?: string;
  /** Optional label override. Default: "Hospital". */
  label?: string;
  /** Disable interaction entirely (e.g., during form submission). */
  disabled?: boolean;
}

export function HospitalPicker({
  value,
  onChange,
  name = 'hospital_id',
  required = true,
  className = '',
  label = 'Hospital',
  disabled = false,
}: HospitalPickerProps) {
  const [hospitals, setHospitals] = useState<AccessibleHospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/hospitals/accessible', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(body => {
        if (cancelled) return;
        if (body?.success && Array.isArray(body.data)) {
          setHospitals(body.data);
          // Auto-fill for single-hospital users
          if (body.data.length === 1 && !value) {
            onChange(body.data[0].id);
          }
        } else {
          setError(body?.error || 'Failed to load hospitals');
        }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load hospitals'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSingleHospital = hospitals.length === 1;
  const selectedHospital = useMemo(
    () => hospitals.find(h => h.id === value) || null,
    [hospitals, value]
  );

  if (loading) {
    return (
      <div className={`block ${className}`}>
        <label className="block text-xs font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
        <div className="h-9 bg-gray-50 border border-gray-200 rounded-md flex items-center px-3 text-xs text-gray-400">Loading hospitals…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`block ${className}`}>
        <label className="block text-xs font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
        <div className="h-9 bg-red-50 border border-red-200 rounded-md flex items-center px-3 text-xs text-red-700">Hospital list unavailable: {error}</div>
      </div>
    );
  }

  if (hospitals.length === 0) {
    return (
      <div className={`block ${className}`}>
        <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
        <div className="h-9 bg-amber-50 border border-amber-200 rounded-md flex items-center px-3 text-xs text-amber-700">No hospitals accessible to your account</div>
      </div>
    );
  }

  if (isSingleHospital) {
    // Hospital-bound user: auto-filled + read-only
    const h = hospitals[0];
    return (
      <div className={`block ${className}`}>
        <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
        <div className="h-9 bg-gray-50 border border-gray-200 rounded-md flex items-center px-3 text-sm text-gray-700 gap-2">
          <Lock size={12} className="text-gray-400" />
          <span>{h.name}</span>
          <span className="text-xs text-gray-400">({h.short_name || h.slug.toUpperCase()})</span>
        </div>
        <input type="hidden" name={name} value={h.id} />
      </div>
    );
  }

  // Multi-hospital user: mandatory picker, no default
  return (
    <div className={`block ${className}`}>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <select
          name={name}
          required={required}
          disabled={disabled}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="w-full h-9 bg-white border border-gray-300 rounded-md pl-3 pr-8 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-even-blue disabled:bg-gray-50 disabled:cursor-not-allowed"
        >
          <option value="" disabled>Pick a hospital…</option>
          {hospitals.map(h => (
            <option key={h.id} value={h.id}>
              {h.name}{h.short_name ? ` (${h.short_name})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
      {!value && (
        <p className="text-[10px] text-gray-500 mt-1">
          You have access to {hospitals.length} hospitals — pick which this is for.
        </p>
      )}
      {selectedHospital && (
        <p className="text-[10px] text-gray-500 mt-1">
          Picked: {selectedHospital.name}
        </p>
      )}
    </div>
  );
}
