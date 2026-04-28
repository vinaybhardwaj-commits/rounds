// =============================================================================
// validate-consultant-hospital.ts (v1.1 — 28 Apr 2026)
//
// Soft validator: does this consultant (profile) have an affiliation with this
// hospital? Same shape as validate-doctor-hospital.ts (MH.7a) but operates on
// a different M2M table:
//
//   - validate-doctor-hospital.ts → reference_doctor_hospital_affiliations
//                                    (the 217-doctor reference roster — used
//                                    by marketing handoff target_hospital)
//   - validate-consultant-hospital.ts → doctor_hospital_affiliations
//                                       (profile-doctors / consultants on
//                                       staff — used by patient_threads.
//                                       primary_consultant_id, schedule-pac)
//
// 3 distinct M2M tables for 3 distinct concerns; do NOT conflate.
//
//   severity = 'pass' → affiliation row exists, OR consultantId is not a UUID
//                       (free-text consultant per consultant-name-flex
//                       migration — no validation possible)
//   severity = 'warn' → consultant is a UUID + no affiliation row; submission
//                       still proceeds. Caller logs to audit_log.
//
// NEVER blocks. Same rationale as MH.7a — real-world data drift shouldn't
// block legitimate workflows; surface for admin review instead.
//
// Usage:
//   const v = await validateConsultantHospitalAffiliation(consultantId, hospitalId);
//   if (v.severity === 'warn') {
//     warnings.push({ code: 'consultant_hospital_mismatch', message: v.message });
//     await audit({ action: 'pac.consultant_hospital_mismatch', ... });
//   }
// =============================================================================

import { queryOne } from '@/lib/db';

export type ValidationSeverity = 'pass' | 'warn';

export interface ConsultantHospitalValidation {
  ok: boolean;
  severity: ValidationSeverity;
  message?: string;
  consultantName?: string;
  hospitalSlug?: string;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Soft-check: does this consultant (profile) have an affiliation with this hospital?
 * NEVER throws on missing affiliation — returns severity='warn' instead.
 *
 * @param consultantId UUID from profiles.id (a doctor on staff), OR a
 *                     free-text consultant name (no validation possible),
 *                     OR null/undefined → pass.
 * @param hospitalId   UUID from hospitals.id (or null/undefined → pass)
 */
export async function validateConsultantHospitalAffiliation(
  consultantId: string | null | undefined,
  hospitalId: string | null | undefined
): Promise<ConsultantHospitalValidation> {
  // Skip if either is missing — not a mismatch, just not applicable.
  if (!consultantId || !hospitalId) {
    return { ok: true, severity: 'pass' };
  }

  // Skip if consultant is free-text (post-consultant-name-flex migration
  // patient_threads.primary_consultant_id can be NULL when the patient
  // names a consultant who isn't on staff). The validator can't lookup a
  // hospital affiliation for a name string; treat as 'pass'.
  if (!UUID_RE.test(consultantId)) {
    return { ok: true, severity: 'pass' };
  }

  // Fast path: does the affiliation row exist in the profile-doctor M2M?
  const hit = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM doctor_hospital_affiliations
       WHERE profile_id = $1::uuid AND hospital_id = $2::uuid
     ) AS exists`,
    [consultantId, hospitalId]
  );

  if (hit?.exists) {
    return { ok: true, severity: 'pass' };
  }

  // Soft-warn path: pull consultant name + hospital label for a friendly message.
  const consultant = await queryOne<{ full_name: string | null }>(
    `SELECT full_name FROM profiles WHERE id = $1::uuid`,
    [consultantId]
  );
  const hospital = await queryOne<{ slug: string | null; short_name: string | null }>(
    `SELECT slug, short_name FROM hospitals WHERE id = $1::uuid`,
    [hospitalId]
  );

  const consultantName = consultant?.full_name || 'this consultant';
  const hospLabel = hospital?.short_name || (hospital?.slug || 'this hospital').toUpperCase();

  return {
    ok: false,
    severity: 'warn',
    message: `${consultantName} is not on file as affiliated with ${hospLabel}. PAC scheduled anyway — flagged for review.`,
    consultantName: consultant?.full_name ?? undefined,
    hospitalSlug: hospital?.slug ?? undefined,
  };
}
