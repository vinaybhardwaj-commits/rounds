/**
 * Patient Dedup Engine — shared across manual add, LSQ sync, and KX import
 *
 * R.3 + R.4 Phase 1. Pure, side-effect-light functions that the three intake
 * pathways call to decide whether an incoming patient should:
 *   - LINK to an existing thread (Layer 1: phone exact match)
 *   - FLAG as a possible duplicate (Layer 2: name trigram > 0.6)
 *   - CREATE a brand-new thread (no match)
 *
 * No UI, no transport, no HTTP. Just DB reads + helper mutations.
 */

import { query, queryOne, execute } from './db';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SourceType = 'lsq' | 'manual' | 'kx_import' | 'walk_in' | 'referral';

export interface DedupInput {
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  city?: string | null;
}

export interface ThreadMatch {
  id: string;
  patient_name: string;
  phone: string | null;
  whatsapp_number: string | null;
  city: string | null;
  current_stage: string;
  source_type: string | null;
  lsq_lead_id: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface FuzzyMatch extends ThreadMatch {
  similarity: number;
}

export type DedupAction = 'link' | 'flag' | 'create';

export interface DedupResult {
  action: DedupAction;
  /** Populated when action === 'link' — the thread to link to */
  matchedThread?: ThreadMatch;
  /** Populated when action === 'flag' — all fuzzy matches found */
  fuzzyMatches?: FuzzyMatch[];
  /** Debug: which layer triggered the decision */
  layer: 1 | 2 | null;
  /** Debug: the normalized phone used for Layer 1 (if any) */
  phoneNormalized: string | null;
}

// Layer 2 trigram similarity floor — anything below this is considered "no match"
export const NAME_SIMILARITY_THRESHOLD = 0.6;

// -----------------------------------------------------------------------------
// Phone normalization
// -----------------------------------------------------------------------------

/**
 * Normalize a phone string to its last 10 digits.
 * Handles formats like "+91-9019062373", "9019062373", "+919019062373",
 * "(919) 019-0623" etc. Returns null if fewer than 10 digits remain.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

// -----------------------------------------------------------------------------
// Core dedup check
// -----------------------------------------------------------------------------

/**
 * Run the 3-layer dedup check on an incoming patient record.
 *
 * Layer 1: exact phone/whatsapp match → LINK (no new thread)
 * Layer 2: trigram name similarity > 0.6 (optionally + city match) → FLAG (new thread + candidates row)
 * Layer 3: no matches → CREATE (new thread, no flag)
 *
 * This function is READ-ONLY. It does not mutate the DB. Callers use the
 * returned action + matchedThread/fuzzyMatches to decide next steps.
 */
export async function checkForDuplicate(input: DedupInput): Promise<DedupResult> {
  const phoneNorm = normalizePhone(input.phone);
  const whatsappNorm = normalizePhone(input.whatsapp);

  // -------------------------------------------------------------------------
  // Layer 1: exact phone / whatsapp match
  // Prefer phone, fall back to whatsapp. Skip archived threads.
  // -------------------------------------------------------------------------
  if (phoneNorm || whatsappNorm) {
    const layer1 = await queryOne<ThreadMatch>(
      `
      SELECT
        id, patient_name, phone, whatsapp_number, city, current_stage,
        source_type, lsq_lead_id, archived_at, created_at
      FROM patient_threads
      WHERE archived_at IS NULL
        AND (
          ($1::text IS NOT NULL AND RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1)
          OR
          ($2::text IS NOT NULL AND RIGHT(regexp_replace(COALESCE(whatsapp_number, ''), '\\D', '', 'g'), 10) = $2)
        )
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [phoneNorm, whatsappNorm]
    );

    if (layer1) {
      return {
        action: 'link',
        matchedThread: layer1,
        layer: 1,
        phoneNormalized: phoneNorm,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Layer 2: trigram fuzzy name match (non-archived only)
  // Similarity threshold 0.6. City match adds soft confidence but doesn't
  // gate the result — that's an admin judgment call.
  // -------------------------------------------------------------------------
  const fuzzyMatches = await query<FuzzyMatch>(
    `
    SELECT
      id, patient_name, phone, whatsapp_number, city, current_stage,
      source_type, lsq_lead_id, archived_at, created_at,
      similarity(patient_name, $1) AS similarity
    FROM patient_threads
    WHERE archived_at IS NULL
      AND patient_name % $1
      AND similarity(patient_name, $1) >= $2
    ORDER BY similarity(patient_name, $1) DESC
    LIMIT 5
    `,
    [input.name, NAME_SIMILARITY_THRESHOLD]
  );

  if (fuzzyMatches.length > 0) {
    return {
      action: 'flag',
      fuzzyMatches,
      layer: 2,
      phoneNormalized: phoneNorm,
    };
  }

  // -------------------------------------------------------------------------
  // Layer 3: no match → create
  // -------------------------------------------------------------------------
  return {
    action: 'create',
    layer: null,
    phoneNormalized: phoneNorm,
  };
}

// -----------------------------------------------------------------------------
// Mutation helpers
// -----------------------------------------------------------------------------

/**
 * Merge incoming data into an existing thread — existing non-null values
 * always win, and incoming data only fills in fields that are currently
 * NULL (or empty string). Bumps returning_patient_count and sets
 * is_returning_patient.
 *
 * Semantics: "existing wins, fill in gaps only". This protects already-
 * validated data from being clobbered if the intake clerk types something
 * wrong on a re-add. The only fields incoming can actually change are
 * ones that were previously unknown.
 *
 * Used by Layer 1 phone-match flow: we keep the existing thread and enrich
 * it with any new fields from the incoming payload.
 */
export async function linkToExistingThread(
  existingId: string,
  incoming: {
    name?: string;
    phone?: string | null;
    whatsapp?: string | null;
    email?: string | null;
    age?: number | null;
    gender?: string | null;
    city?: string | null;
    chief_complaint?: string | null;
    insurance_status?: string | null;
    target_department?: string | null;
    source_detail?: string | null;
  }
): Promise<void> {
  await execute(
    `
    UPDATE patient_threads SET
      patient_name       = COALESCE(NULLIF(patient_name, ''), NULLIF($2, '')),
      phone              = COALESCE(NULLIF(phone, ''), NULLIF($3, '')),
      whatsapp_number    = COALESCE(NULLIF(whatsapp_number, ''), NULLIF($4, '')),
      email              = COALESCE(NULLIF(email, ''), NULLIF($5, '')),
      age                = COALESCE(age, $6),
      gender             = COALESCE(NULLIF(gender, ''), NULLIF($7, '')),
      city               = COALESCE(NULLIF(city, ''), NULLIF($8, '')),
      chief_complaint    = COALESCE(NULLIF(chief_complaint, ''), NULLIF($9, '')),
      insurance_status   = COALESCE(NULLIF(insurance_status, ''), NULLIF($10, '')),
      target_department  = COALESCE(NULLIF(target_department, ''), NULLIF($11, '')),
      source_detail      = COALESCE(NULLIF(source_detail, ''), NULLIF($12, '')),
      is_returning_patient = TRUE,
      returning_patient_count = COALESCE(returning_patient_count, 0) + 1,
      updated_at         = NOW()
    WHERE id = $1
    `,
    [
      existingId,
      incoming.name ?? null,
      incoming.phone ?? null,
      incoming.whatsapp ?? null,
      incoming.email ?? null,
      incoming.age ?? null,
      incoming.gender ?? null,
      incoming.city ?? null,
      incoming.chief_complaint ?? null,
      incoming.insurance_status ?? null,
      incoming.target_department ?? null,
      incoming.source_detail ?? null,
    ]
  );
}

/**
 * Mark a newly-created thread as a possible duplicate and insert
 * dedup_candidates rows for each fuzzy match, so the admin review queue
 * at /admin/dedup picks them up.
 *
 * Uses the unique index `uq_dedup_candidates_pair_pending` for idempotency:
 * re-running this for the same pair will silently no-op instead of erroring.
 */
export async function flagAsFuzzyDuplicate(
  newThreadId: string,
  fuzzyMatches: FuzzyMatch[]
): Promise<void> {
  if (!fuzzyMatches.length) return;

  await execute(
    `UPDATE patient_threads SET is_possible_duplicate = TRUE, updated_at = NOW() WHERE id = $1`,
    [newThreadId]
  );

  for (const match of fuzzyMatches) {
    await execute(
      `
      INSERT INTO dedup_candidates (
        new_thread_id, existing_thread_id, similarity, match_type, match_fields, status
      ) VALUES ($1, $2, $3, 'name_trgm', $4, 'pending')
      ON CONFLICT DO NOTHING
      `,
      [
        newThreadId,
        match.id,
        match.similarity,
        JSON.stringify({
          name_similarity: match.similarity,
          incoming_city: null,
          existing_city: match.city,
        }),
      ]
    );
  }
}

// -----------------------------------------------------------------------------
// Audit logging
// -----------------------------------------------------------------------------

export interface DedupLogEntry {
  action: 'link' | 'flag' | 'create' | 'merge' | 'split' | 'ignore';
  source_thread_id?: string | null;
  target_thread_id?: string | null;
  match_layer?: 1 | 2 | null;
  similarity?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  actor_id?: string | null;
  actor_name?: string | null;
  endpoint: string;
}

/**
 * Append an audit entry to dedup_log. Fire-and-forget safe — callers should
 * not block on this or assume it succeeded.
 */
export async function logDedupAction(entry: DedupLogEntry): Promise<void> {
  try {
    await execute(
      `
      INSERT INTO dedup_log (
        action, source_thread_id, target_thread_id, match_layer,
        similarity, reason, metadata, actor_id, actor_name, endpoint
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        entry.action,
        entry.source_thread_id ?? null,
        entry.target_thread_id ?? null,
        entry.match_layer ?? null,
        entry.similarity ?? null,
        entry.reason ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.actor_id ?? null,
        entry.actor_name ?? null,
        entry.endpoint,
      ]
    );
  } catch (err) {
    // Never let audit logging break the caller
    console.error('[dedup] logDedupAction failed:', err);
  }
}
