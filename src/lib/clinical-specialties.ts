// =============================================================================
// src/lib/clinical-specialties.ts
//
// Canonical list of clinical specialties / admitting departments.
//
// Single source of truth shared across:
//   - Marketing Handoff form's `target_department` select (form-registry.ts)
//   - Patient Overview's clinical department picker (PatientDetailView.tsx)
//   - LSQ sync's doctor → specialty mapping (lsq-sync.ts)
//   - Marketing Handoff submission hook copying form_data.target_department
//     onto patient_threads.target_department (forms route)
//
// Mirrors the SURGICAL set in `/api/doctors/route.ts` and
// `FormRenderer.tsx::SURGICAL_SPECIALTIES` — keep in sync if any of those
// move/grow.
// =============================================================================

export const CLINICAL_SPECIALTIES = [
  'Anaesthesia',
  'Cardiology',
  'Dentistry',
  'Dermatology',
  'ENT',
  'Emergency',
  'Endocrinology',
  'Gastroenterology',
  'General Surgery',
  'ICU',
  'Internal Medicine',
  'Medical Oncology',
  'Nephrology',
  'Neurology',
  'Neurosurgery',
  'Obstetrics & Gynecology',
  'Oncology',
  'Ophthalmology',
  'Oral & Maxillofacial Surgery',
  'Orthopedics',
  'Paediatric Haemato-Oncology',
  'Paediatric Surgery',
  'Pain & Palliative Care',
  'Pathology',
  'Pediatrics',
  'Physiatry',
  'Physiotherapy',
  'Plastic Surgery',
  'Psychiatry',
  'Pulmonology',
  'Radiation Oncology',
  'Radiology',
  'Rheumatology',
  'Surgical Gastroenterology',
  'Surgical Oncology',
  'Urology',
  'Vascular Surgery',
  'Wards',
] as const;

export type ClinicalSpecialty = (typeof CLINICAL_SPECIALTIES)[number];

export const CLINICAL_SPECIALTY_SET: ReadonlySet<string> = new Set(CLINICAL_SPECIALTIES);

/** Returns true if `s` is one of the canonical 40 clinical specialties. */
export function isCanonicalSpecialty(s: string | null | undefined): boolean {
  return !!s && CLINICAL_SPECIALTY_SET.has(s);
}

/** Surgical subset (drives Section C visibility in Marketing Handoff). */
export const SURGICAL_SPECIALTIES: ReadonlySet<string> = new Set([
  'Dentistry',
  'Dermatology',
  'ENT',
  'General Surgery',
  'Neurosurgery',
  'Obstetrics & Gynecology',
  'Oncology',
  'Ophthalmology',
  'Oral & Maxillofacial Surgery',
  'Orthopedics',
  'Paediatric Surgery',
  'Plastic Surgery',
  'Surgical Gastroenterology',
  'Surgical Oncology',
  'Urology',
  'Vascular Surgery',
]);

export function isSurgicalSpecialty(s: string | null | undefined): boolean {
  return !!s && SURGICAL_SPECIALTIES.has(s);
}
