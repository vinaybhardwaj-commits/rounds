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

// -----------------------------------------------------------------------------
// Merge helper (Phase 5.1) — fold loser thread into winner, re-parent FK rows
// -----------------------------------------------------------------------------

/**
 * Canonical patient-journey stage ordering used for forward-only merge logic.
 * When merging, if the loser is "ahead" of the winner on this scale, we
 * advance the winner's stage to the loser's (never regress).
 *
 * Stages not listed get a rank of -1 (treated as "unknown, don't advance").
 */
const STAGE_ORDER: Record<string, number> = {
  opd: 0,
  pre_admission: 1,
  admitted: 2,
  pre_op: 3,
  surgery: 4,
  post_op: 5,
  post_op_care: 6,
  medical_management: 6,
  discharge: 7,
  post_discharge: 8,
  long_term_followup: 9,
};

function stageRank(stage: string | null | undefined): number {
  if (!stage) return -1;
  return STAGE_ORDER[stage] ?? -1;
}

export interface MergeActor {
  profileId: string | null;
  email: string | null;
}

export interface MergeOptions {
  /** Free-text reason shown in the audit log + candidate resolution */
  reason?: string | null;
  /** Endpoint tag for logDedupAction audit entry */
  endpoint?: string;
}

export interface MergeResult {
  winnerId: string;
  loserId: string;
  /** Field-by-field count of values the loser contributed (winner was NULL) */
  mergedFields: string[];
  /** Table-by-table FK row counts that were re-parented */
  fkCounts: Record<string, number>;
  /** Whether the winner's stage was advanced to match the loser's */
  stageAdvanced: boolean;
  /** Did we encounter any file collisions that were dedup-deleted? */
  fileCollisionsDropped: number;
  /** Loser snapshot (full row) captured before the merge for audit */
  loserSnapshot: Record<string, unknown>;
}

/**
 * Fields that participate in the "winner wins, fill gaps" COALESCE merge.
 * Excludes identity/audit columns (id, created_at, updated_at, archived_at,
 * merged_into_id, merged_at, current_stage — stage has custom forward-only
 * logic). Callers cannot override this list.
 */
const MERGEABLE_FIELDS = [
  'patient_name',
  'uhid',
  'ip_number',
  'even_member_id',
  'lead_source',
  'primary_consultant_id',
  'primary_diagnosis',
  'planned_procedure',
  'department_id',
  'admission_date',
  'planned_surgery_date',
  'discharge_date',
  'pac_status',
  'lsq_lead_id',
  'lsq_prospect_auto_id',
  'phone',
  'whatsapp_number',
  'email',
  'gender',
  'age',
  'date_of_birth',
  'city',
  'state',
  'address',
  'zip',
  'ailment',
  'doctor_name',
  'appointment_date',
  'hospital_location',
  'surgery_order_value',
  'financial_category',
  'utm_source',
  'utm_campaign',
  'utm_medium',
  'signup_url',
  'lsq_owner_name',
  'lsq_owner_email',
  'lsq_lead_stage',
  'lsq_created_on',
  'lsq_last_synced_at',
  'source_type',
  'source_detail',
  'chief_complaint',
  'insurance_status',
  'target_department',
  'referral_details',
  'getstream_channel_id',
] as const;

/**
 * FK tables that point at patient_threads.id and should be unconditionally
 * re-parented from loser → winner during a merge. `patient_files` is handled
 * separately because it has a UNIQUE(patient_thread_id, file_id) constraint
 * which can conflict when both rows link the same file.
 */
const FK_TABLES_SIMPLE = [
  'admission_tracker',
  'claim_events',
  'discharge_milestones',
  'escalation_log',
  'form_submissions',
  'insurance_claims',
  'lsq_activity_cache',
  'patient_changelog',
  'readiness_items',
  'surgery_postings',
] as const;

/**
 * Merge the `loser` patient_threads row into the `winner` row.
 *
 * IMPORTANT: The Neon HTTP driver has no transaction support, so this function
 * performs its work in an **idempotent order** so that a partial failure
 * mid-merge is safely recoverable by re-running it with the same ids:
 *
 *   1. Pre-flight: load both rows, reject self-merge / already-merged /
 *      conflicting LSQ lead ids (unless reason includes "override").
 *   2. Re-parent FK tables (simple) — unconditional UPDATE ... WHERE loser.
 *      Idempotent: second run matches 0 rows.
 *   3. Re-parent patient_files — delete any loser rows whose file_id already
 *      exists on the winner (UNIQUE collisions), then re-parent the rest.
 *   4. Resolve any matching dedup_candidates rows to status='merged'.
 *   5. COALESCE-merge mergeable fields onto the winner (winner wins, loser
 *      fills gaps) + forward-only stage advance.
 *   6. Soft-delete the loser: archived_at, archive_type='merged',
 *      merged_into_id, merged_at, is_possible_duplicate=FALSE.
 *   7. Write dedup_log audit entry with the loser snapshot in metadata.
 *
 * Returns a summary of what was merged so the API/UI can show a receipt.
 * Does NOT touch GetStream — channel rename lives at the route layer so a
 * Stream outage can't break a merge.
 */
export async function mergePatientThreads(
  winnerId: string,
  loserId: string,
  actor: MergeActor,
  options: MergeOptions = {}
): Promise<MergeResult> {
  if (winnerId === loserId) {
    throw new Error('Cannot merge a thread into itself');
  }

  // --- 1. Pre-flight: load both rows ---------------------------------------
  const winner = await queryOne<Record<string, unknown>>(
    `SELECT * FROM patient_threads WHERE id = $1`,
    [winnerId]
  );
  if (!winner) {
    throw new Error(`Winner thread ${winnerId} not found`);
  }

  const loser = await queryOne<Record<string, unknown>>(
    `SELECT * FROM patient_threads WHERE id = $1`,
    [loserId]
  );
  if (!loser) {
    throw new Error(`Loser thread ${loserId} not found`);
  }

  if (loser.merged_into_id != null) {
    throw new Error(
      `Loser thread ${loserId} was already merged into ${loser.merged_into_id}`
    );
  }
  if (winner.merged_into_id != null) {
    throw new Error(
      `Winner thread ${winnerId} was already merged into ${winner.merged_into_id} and cannot accept a new merge`
    );
  }

  // Block conflicting LSQ lead ids — two distinct LSQ leads should never
  // silently fold into one row. Operator must resolve manually.
  const winnerLsq = (winner.lsq_lead_id ?? null) as string | null;
  const loserLsq = (loser.lsq_lead_id ?? null) as string | null;
  const overrideConflict = (options.reason ?? '').toLowerCase().includes('override');
  if (winnerLsq && loserLsq && winnerLsq !== loserLsq && !overrideConflict) {
    throw new Error(
      `Both threads have distinct LSQ lead ids (${winnerLsq} vs ${loserLsq}). ` +
        `Resolve manually or include "override" in the reason.`
    );
  }

  // --- 2. Re-parent FK tables (simple) -------------------------------------
  const fkCounts: Record<string, number> = {};
  for (const tbl of FK_TABLES_SIMPLE) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await query<Record<string, unknown>>(
      `UPDATE ${tbl} SET patient_thread_id = $1 WHERE patient_thread_id = $2 RETURNING 1 AS r`,
      [winnerId, loserId]
    );
    fkCounts[tbl] = rows.length;
  }

  // --- 3. Re-parent patient_files (UNIQUE(patient_thread_id, file_id)) -----
  // Step 3a: drop any loser rows whose file_id already exists on the winner.
  // These are genuine duplicates — same file linked to both threads.
  const droppedFiles = await query<Record<string, unknown>>(
    `
    DELETE FROM patient_files
    WHERE patient_thread_id = $2
      AND file_id IN (
        SELECT file_id FROM patient_files
        WHERE patient_thread_id = $1 AND file_id IS NOT NULL
      )
    RETURNING 1 AS r
    `,
    [winnerId, loserId]
  );
  const fileCollisionsDropped = droppedFiles.length;

  // Step 3b: re-parent remaining loser file rows to the winner.
  const movedFiles = await query<Record<string, unknown>>(
    `UPDATE patient_files SET patient_thread_id = $1 WHERE patient_thread_id = $2 RETURNING 1 AS r`,
    [winnerId, loserId]
  );
  fkCounts['patient_files'] = movedFiles.length;

  // --- 4. Resolve matching dedup_candidates rows ---------------------------
  // Any pending candidate pairing (winner, loser) or (loser, winner) is now
  // definitively resolved as "merged". Idempotent via partial update.
  await execute(
    `
    UPDATE dedup_candidates
    SET status = 'merged',
        resolved_at = NOW(),
        resolved_by = $3,
        resolution_note = COALESCE(resolution_note, $4)
    WHERE status = 'pending'
      AND (
        (new_thread_id = $1 AND existing_thread_id = $2)
        OR (new_thread_id = $2 AND existing_thread_id = $1)
      )
    `,
    [winnerId, loserId, actor.profileId ?? null, options.reason ?? null]
  );

  // --- 5. COALESCE-merge mergeable fields + forward-only stage -------------
  const mergedFields: string[] = [];
  const setClauses: string[] = [];
  const params: unknown[] = [winnerId];
  let paramIdx = 2;

  for (const field of MERGEABLE_FIELDS) {
    const winnerVal = winner[field];
    const loserVal = loser[field];
    const winnerIsNull =
      winnerVal == null || (typeof winnerVal === 'string' && winnerVal === '');
    const loserHasValue =
      loserVal != null && !(typeof loserVal === 'string' && loserVal === '');
    if (winnerIsNull && loserHasValue) {
      setClauses.push(`${field} = $${paramIdx}`);
      params.push(loserVal);
      paramIdx += 1;
      mergedFields.push(field);
    }
  }

  // Forward-only stage: if loser is further along, advance winner.
  const winnerStageRank = stageRank(winner.current_stage as string | null);
  const loserStageRank = stageRank(loser.current_stage as string | null);
  let stageAdvanced = false;
  if (loserStageRank > winnerStageRank && loser.current_stage) {
    setClauses.push(`current_stage = $${paramIdx}`);
    params.push(loser.current_stage);
    paramIdx += 1;
    stageAdvanced = true;
  }

  // Bump returning-patient counters so the winner reflects the re-entry.
  setClauses.push(`is_returning_patient = TRUE`);
  setClauses.push(
    `returning_patient_count = COALESCE(returning_patient_count, 0) + 1`
  );
  setClauses.push(`updated_at = NOW()`);

  if (setClauses.length > 0) {
    await execute(
      `UPDATE patient_threads SET ${setClauses.join(', ')} WHERE id = $1`,
      params
    );
  }

  // --- 6. Soft-delete the loser --------------------------------------------
  // Set archived_at + merged_into_id atomically so queries filtering on
  // archived_at won't see the loser on the main board, and audit views can
  // trace the merge without joining dedup_log.
  await execute(
    `
    UPDATE patient_threads
    SET archived_at = COALESCE(archived_at, NOW()),
        archive_type = 'merged',
        archive_reason = 'merged_into_existing',
        archive_reason_detail = $3,
        archived_by = $4,
        merged_into_id = $2,
        merged_at = COALESCE(merged_at, NOW()),
        is_possible_duplicate = FALSE,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      loserId,
      winnerId,
      options.reason ?? null,
      actor.profileId ?? null,
    ]
  );

  // --- 7. Audit log --------------------------------------------------------
  const loserSnapshot = loser as Record<string, unknown>;
  await logDedupAction({
    action: 'merge',
    source_thread_id: loserId,
    target_thread_id: winnerId,
    match_layer: null,
    similarity: null,
    reason: options.reason ?? null,
    metadata: {
      merged_fields: mergedFields,
      fk_counts: fkCounts,
      stage_advanced: stageAdvanced,
      file_collisions_dropped: fileCollisionsDropped,
      loser_snapshot: loserSnapshot,
    },
    actor_id: actor.profileId ?? null,
    actor_name: actor.email ?? null,
    endpoint: options.endpoint ?? 'mergePatientThreads',
  });

  return {
    winnerId,
    loserId,
    mergedFields,
    fkCounts,
    stageAdvanced,
    fileCollisionsDropped,
    loserSnapshot,
  };
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
