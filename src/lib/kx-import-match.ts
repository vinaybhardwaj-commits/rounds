// ============================================
// KX Import Matching (Phase 4)
//
// Extracted from /api/patients/import so the matching + audit decision is
// independently testable. The route preloads patient_threads into two maps
// (byUhid, byPhone) and for each CSV row calls matchKxRow() to get a
// `{ existing, matchedVia }` decision plus any `dedup_log` side effects.
//
// Matching rules (2-tier + collision guard):
//   Tier 1  — exact UHID match (strongest).
//   Tier 2  — Layer 1 phone match (last-10-digit normalized), BUT only if the
//             matched row has a NULL or same UHID as the incoming row. If the
//             phone matches a row with a DIFFERENT UHID, treat it as two
//             patients sharing a phone (family members), log an 'ignore' row
//             to dedup_log, and fall through to Tier 3.
//   Tier 3  — no match → caller creates a new row.
// ============================================

import { logDedupAction } from './dedup';

export interface KxExistingPatient {
  id: string;
  uhid: string | null;
  patient_name: string;
  phone: string | null;
  whatsapp_number: string | null;
  current_stage: string;
  getstream_channel_id: string | null;
  lsq_lead_id: string | null;
  source_type: string | null;
}

export interface KxMatchInput {
  uhid: string;
  patient_name: string;
  mobile: string;
}

export interface KxMatchActor {
  profileId: string;
  email: string | null;
}

export interface KxMatchResult {
  existing: KxExistingPatient | null;
  matchedVia: 'uhid' | 'phone' | null;
  /** The `ignore` action was logged because a phone hit was blocked by a UHID collision. */
  collisionSkipped: boolean;
}

export function normalizeKxPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Build the byUhid + byPhone lookup maps from the preloaded patient_threads.
 * Called once per import batch.
 */
export function buildKxIndexes(patients: KxExistingPatient[]): {
  byUhid: Map<string, KxExistingPatient>;
  byPhone: Map<string, KxExistingPatient[]>;
} {
  const byUhid = new Map<string, KxExistingPatient>();
  const byPhone = new Map<string, KxExistingPatient[]>();
  for (const p of patients) {
    if (p.uhid) byUhid.set(p.uhid.toLowerCase(), p);
    const phoneKey = normalizeKxPhone(p.phone) || normalizeKxPhone(p.whatsapp_number);
    if (phoneKey) {
      const list = byPhone.get(phoneKey);
      if (list) list.push(p);
      else byPhone.set(phoneKey, [p]);
    }
  }
  return { byUhid, byPhone };
}

/**
 * Decide whether a KX CSV row matches an existing patient_thread.
 * Writes to dedup_log as a side effect on phone-link and collision-skip paths.
 */
export function matchKxRow(
  row: KxMatchInput,
  byUhid: Map<string, KxExistingPatient>,
  byPhone: Map<string, KxExistingPatient[]>,
  actor: KxMatchActor
): KxMatchResult {
  // Tier 1: UHID exact match
  const uhidLower = row.uhid.toLowerCase();
  const uhidMatch = byUhid.get(uhidLower) || null;
  if (uhidMatch) {
    return { existing: uhidMatch, matchedVia: 'uhid', collisionSkipped: false };
  }

  // Tier 2: phone Layer 1 match with UHID collision guard
  const kxPhoneKey = normalizeKxPhone(row.mobile);
  if (!kxPhoneKey) {
    return { existing: null, matchedVia: null, collisionSkipped: false };
  }

  const phoneMatches = byPhone.get(kxPhoneKey) || [];
  if (phoneMatches.length === 0) {
    return { existing: null, matchedVia: null, collisionSkipped: false };
  }

  const safeLink = phoneMatches.find(
    p => !p.uhid || p.uhid.toLowerCase() === uhidLower
  );
  const collisions = phoneMatches.filter(
    p => p.uhid && p.uhid.toLowerCase() !== uhidLower
  );

  if (safeLink) {
    logDedupAction({
      action: 'link',
      target_thread_id: safeLink.id,
      match_layer: 1,
      reason: 'kx_import_phone_link',
      metadata: {
        kx_uhid: row.uhid,
        kx_patient_name: row.patient_name,
        matched_phone: kxPhoneKey,
        existing_source_type: safeLink.source_type,
        existing_had_uhid: !!safeLink.uhid,
      },
      endpoint: 'kx_import',
      actor_id: actor.profileId,
      actor_name: actor.email,
    }).catch(() => { /* non-blocking */ });
    return { existing: safeLink, matchedVia: 'phone', collisionSkipped: false };
  }

  if (collisions.length > 0) {
    logDedupAction({
      action: 'ignore',
      source_thread_id: collisions[0].id,
      match_layer: 1,
      reason: 'kx_import_phone_uhid_collision',
      metadata: {
        kx_uhid: row.uhid,
        kx_patient_name: row.patient_name,
        matched_phone: kxPhoneKey,
        existing_uhids: collisions.map(c => c.uhid),
        existing_names: collisions.map(c => c.patient_name),
      },
      endpoint: 'kx_import',
      actor_id: actor.profileId,
      actor_name: actor.email,
    }).catch(() => { /* non-blocking */ });
    return { existing: null, matchedVia: null, collisionSkipped: true };
  }

  // Shouldn't reach here (phoneMatches was non-empty but neither branch hit)
  return { existing: null, matchedVia: null, collisionSkipped: false };
}
