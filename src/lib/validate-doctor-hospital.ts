// =============================================================================
// validate-doctor-hospital.ts (MH.7a)
//
// Soft validator: does this reference_doctor have an affiliation with this
// hospital? Per V's locked design (27 Apr 2026 night, journal §1):
//
//   severity = 'pass' → affiliation row exists in
//                       reference_doctor_hospital_affiliations
//   severity = 'warn' → no row; submission still proceeds. Server logs
//                       'form.doctor_hospital_mismatch' to audit_log; UI
//                       renders yellow banner post-submit.
//
// NEVER blocks submission per Q3 — optimizes for marketing speed at intake;
// real-world data drift (new visiting consultant arrives Mon, admin updates
// affiliations Wed) shouldn't block legitimate submissions.
//
// Usage:
//   const v = await validateDoctorHospitalAffiliation(doctorId, hospitalId);
//   if (v.severity === 'warn') {
//     warnings.push({ code: 'doctor_hospital_mismatch', message: v.message });
//     await audit({ action: 'form.doctor_hospital_mismatch', ... });
//   }
//
// Inputs may be NULL/undefined — the validator returns 'pass' early in that
// case (caller is presumed to be in a context where the validation isn't
// applicable, e.g. handoff submitted without an admitting_doctor_id picked).
// =============================================================================

import { queryOne } from '@/lib/db';

export type ValidationSeverity = 'pass' | 'warn';

export interface DoctorHospitalValidation {
  ok: boolean; // pass = true, warn = false
  severity: ValidationSeverity;
  message?: string;
  doctorName?: string;
  hospitalSlug?: string;
}

/**
 * Soft-check: does this reference_doctor have an affiliation with this hospital?
 * NEVER throws on missing affiliation — returns severity='warn' instead.
 *
 * @param doctorId   UUID from reference_doctors.id (or null/undefined → pass)
 * @param hospitalId UUID from hospitals.id (or null/undefined → pass)
 */
export async function validateDoctorHospitalAffiliation(
  doctorId: string | null | undefined,
  hospitalId: string | null | undefined
): Promise<DoctorHospitalValidation> {
  // Skip if either is missing — not a mismatch, just not applicable.
  if (!doctorId || !hospitalId) {
    return { ok: true, severity: 'pass' };
  }

  // Fast path: does the affiliation row exist?
  const hit = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reference_doctor_hospital_affiliations
       WHERE reference_doctor_id = $1::uuid AND hospital_id = $2::uuid
     ) AS exists`,
    [doctorId, hospitalId]
  );

  if (hit?.exists) {
    return { ok: true, severity: 'pass' };
  }

  // Soft-warn path: pull doctor name + hospital slug for a friendly message.
  // Two small lookups (each ~1ms on Neon) — acceptable for the warn branch.
  const doctor = await queryOne<{ full_name: string | null }>(
    `SELECT full_name FROM reference_doctors WHERE id = $1::uuid`,
    [doctorId]
  );
  const hospital = await queryOne<{ slug: string | null; short_name: string | null }>(
    `SELECT slug, short_name FROM hospitals WHERE id = $1::uuid`,
    [hospitalId]
  );

  const docName = doctor?.full_name || 'this doctor';
  const hospLabel = hospital?.short_name || (hospital?.slug || 'this hospital').toUpperCase();

  return {
    ok: false,
    severity: 'warn',
    message: `${docName} is not on file as affiliated with ${hospLabel}. Submitted anyway — flagged for review.`,
    doctorName: doctor?.full_name ?? undefined,
    hospitalSlug: hospital?.slug ?? undefined,
  };
}
