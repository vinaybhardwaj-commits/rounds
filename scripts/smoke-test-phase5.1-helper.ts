/**
 * Phase 5.1 HELPER smoke test — verifies `mergePatientThreads()` against live Neon.
 *
 * This is the most important test of Phase 5.1: it exercises the single
 * function that actually moves data around when an admin clicks "Merge".
 *
 * Scenarios covered:
 *
 *   TEST 1 — Basic COALESCE merge + counters:
 *     Winner has name+phone+stage; loser has extra email+city+age.
 *     After merge:
 *       - winner gained email/city/age
 *       - winner's phone/stage unchanged
 *       - returning_patient_count bumped
 *       - loser is archived + has merged_into_id = winner
 *
 *   TEST 2 — Forward-only stage advance:
 *     Winner stage = 'pre_admission', loser stage = 'admitted'.
 *     Winner should be promoted to 'admitted' (never regressed).
 *
 *   TEST 3 — Stage does NOT regress:
 *     Winner stage = 'post_op', loser stage = 'pre_admission'.
 *     Winner must stay at 'post_op'.
 *
 *   TEST 4 — FK re-parenting:
 *     Insert patient_changelog + readiness_items rows for the loser, merge,
 *     verify they now point at the winner.
 *
 *   TEST 5 — patient_files UNIQUE(patient_thread_id, file_id) collision:
 *     Both winner and loser link the same file → loser's row is dropped,
 *     winner keeps its original row. Unique file rows get re-parented.
 *
 *   TEST 6 — dedup_candidates resolution:
 *     Pending candidate (winner, loser) → status='merged' after merge.
 *
 *   TEST 7 — Idempotency:
 *     Calling mergePatientThreads with the same loser a second time throws
 *     "already merged" and does NOT corrupt the winner.
 *
 *   TEST 8 — LSQ conflict guard:
 *     Winner and loser both have distinct non-null lsq_lead_id — merge is
 *     blocked unless reason contains "override".
 *
 *   TEST 9 — dedup_log audit entry:
 *     A 'merge' row is written with source=loser, target=winner, full
 *     loser_snapshot in metadata, and endpoint matching the caller.
 *
 *   TEST 10 — Self-merge rejection:
 *     mergePatientThreads(x, x, ...) throws "cannot merge a thread into itself".
 *
 * All seeded rows are hard-deleted at the end via createdIds tracking.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/smoke-test-phase5.1-helper.ts
 */

import { mergePatientThreads } from '../src/lib/dedup';
import { createPatientThread } from '../src/lib/db-v5';
import { query, queryOne, execute } from '../src/lib/db';

interface CheckResult {
  label: string;
  pass: boolean;
  note?: string;
}
const results: CheckResult[] = [];
const record = (label: string, pass: boolean, note?: string) =>
  results.push({ label, pass, note });

const TEST_PREFIX = '__SMOKE_PHASE5_1_';
const createdIds: string[] = [];
const createdFileIds: string[] = [];

async function getAnyProfileId(): Promise<{ id: string; email: string | null }> {
  const row = await queryOne<{ id: string; email: string | null }>(
    `SELECT id, email FROM profiles WHERE role IS NOT NULL ORDER BY created_at ASC LIMIT 1`
  );
  if (!row) throw new Error('No profile found to use as created_by');
  return row;
}

async function getPT(id: string) {
  return queryOne<Record<string, unknown>>(
    `SELECT * FROM patient_threads WHERE id = $1`,
    [id]
  );
}

async function main() {
  console.log('=== PHASE 5.1 HELPER SMOKE TEST ===\n');
  const creator = await getAnyProfileId();
  console.log('Using creator profile:', creator.id);
  const actor = { profileId: creator.id, email: creator.email };
  const uniqueMarker = Math.floor(Math.random() * 1_000_000);

  // ===========================================================================
  // TEST 1: Basic COALESCE merge + counters
  // ===========================================================================
  console.log('\n--- TEST 1: Basic COALESCE merge + counters ---');
  const t1winner = await createPatientThread({
    patient_name: `${TEST_PREFIX}T1_Winner_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    phone: '9' + String(uniqueMarker).padStart(9, '1'),
    source_type: 'manual',
  });
  createdIds.push(t1winner.id);

  const t1loser = await createPatientThread({
    patient_name: `${TEST_PREFIX}T1_Loser_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    email: 't1loser@example.com',
    city: 'Bangalore',
    age: 42,
    source_type: 'manual',
  });
  createdIds.push(t1loser.id);

  const r1 = await mergePatientThreads(t1winner.id, t1loser.id, actor, {
    reason: 'T1 basic merge',
    endpoint: 'smoke-5.1-helper',
  });
  record(
    'T1.1 — merge result fields include email/city/age',
    ['email', 'city', 'age'].every((f) => r1.mergedFields.includes(f)),
    `mergedFields=${r1.mergedFields.join(',')}`
  );

  const t1winAfter = await getPT(t1winner.id);
  record(
    'T1.2 — winner gained email from loser',
    t1winAfter?.email === 't1loser@example.com',
    `email=${t1winAfter?.email}`
  );
  record(
    'T1.3 — winner gained city from loser',
    t1winAfter?.city === 'Bangalore',
    `city=${t1winAfter?.city}`
  );
  record(
    'T1.4 — winner gained age from loser',
    t1winAfter?.age === 42,
    `age=${t1winAfter?.age}`
  );
  record(
    'T1.5 — winner phone unchanged (non-null wins)',
    t1winAfter?.phone === '9' + String(uniqueMarker).padStart(9, '1'),
    `phone=${t1winAfter?.phone}`
  );
  record(
    'T1.6 — winner returning_patient_count bumped',
    Number(t1winAfter?.returning_patient_count) === 1,
    `count=${t1winAfter?.returning_patient_count}`
  );
  record(
    'T1.7 — winner is_returning_patient = true',
    t1winAfter?.is_returning_patient === true,
    `flag=${t1winAfter?.is_returning_patient}`
  );

  const t1losAfter = await getPT(t1loser.id);
  record(
    'T1.8 — loser archived_at set',
    !!t1losAfter?.archived_at,
    `archived_at=${t1losAfter?.archived_at}`
  );
  record(
    'T1.9 — loser merged_into_id = winner',
    t1losAfter?.merged_into_id === t1winner.id,
    `merged_into_id=${t1losAfter?.merged_into_id}`
  );
  record(
    'T1.10 — loser merged_at set',
    !!t1losAfter?.merged_at,
    `merged_at=${t1losAfter?.merged_at}`
  );
  record(
    'T1.11 — loser archive_type = merged',
    t1losAfter?.archive_type === 'merged',
    `archive_type=${t1losAfter?.archive_type}`
  );
  record(
    'T1.12 — loser is_possible_duplicate cleared',
    t1losAfter?.is_possible_duplicate === false,
    `flag=${t1losAfter?.is_possible_duplicate}`
  );

  // ===========================================================================
  // TEST 2: Forward-only stage advance
  // ===========================================================================
  console.log('\n--- TEST 2: Forward-only stage advance ---');
  const t2winner = await createPatientThread({
    patient_name: `${TEST_PREFIX}T2_Winner_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t2winner.id);
  const t2loser = await createPatientThread({
    patient_name: `${TEST_PREFIX}T2_Loser_${uniqueMarker}`,
    current_stage: 'admitted',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t2loser.id);

  const r2 = await mergePatientThreads(t2winner.id, t2loser.id, actor, {
    reason: 'T2 stage advance',
    endpoint: 'smoke-5.1-helper',
  });
  record(
    'T2.1 — merge reports stageAdvanced=true',
    r2.stageAdvanced === true,
    `stageAdvanced=${r2.stageAdvanced}`
  );
  const t2winAfter = await getPT(t2winner.id);
  record(
    'T2.2 — winner advanced from pre_admission → admitted',
    t2winAfter?.current_stage === 'admitted',
    `stage=${t2winAfter?.current_stage}`
  );

  // ===========================================================================
  // TEST 3: Stage does NOT regress
  // ===========================================================================
  console.log('\n--- TEST 3: Stage does NOT regress ---');
  const t3winner = await createPatientThread({
    patient_name: `${TEST_PREFIX}T3_Winner_${uniqueMarker}`,
    current_stage: 'post_op',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t3winner.id);
  const t3loser = await createPatientThread({
    patient_name: `${TEST_PREFIX}T3_Loser_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t3loser.id);

  const r3 = await mergePatientThreads(t3winner.id, t3loser.id, actor, {
    reason: 'T3 stage no-regress',
    endpoint: 'smoke-5.1-helper',
  });
  record(
    'T3.1 — merge reports stageAdvanced=false',
    r3.stageAdvanced === false,
    `stageAdvanced=${r3.stageAdvanced}`
  );
  const t3winAfter = await getPT(t3winner.id);
  record(
    'T3.2 — winner stage stays at post_op',
    t3winAfter?.current_stage === 'post_op',
    `stage=${t3winAfter?.current_stage}`
  );

  // ===========================================================================
  // TEST 4: FK re-parenting (patient_changelog + readiness_items)
  // ===========================================================================
  console.log('\n--- TEST 4: FK re-parenting ---');
  const t4winner = await createPatientThread({
    patient_name: `${TEST_PREFIX}T4_Winner_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t4winner.id);
  const t4loser = await createPatientThread({
    patient_name: `${TEST_PREFIX}T4_Loser_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t4loser.id);

  // Insert 3 patient_changelog rows + 2 escalation_log rows on the loser.
  // patient_changelog has a check constraint — change_type must be in
  // {stage_change, field_edit, pac_status_change, form_submission}.
  // We tag via a unique field_name so we can count per-test.
  const SMOKE_CHG_FIELD = `smoke_t4_field_${uniqueMarker}`;
  for (let i = 0; i < 3; i++) {
    await execute(
      `INSERT INTO patient_changelog (patient_thread_id, change_type, field_name, old_value, new_value, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [t4loser.id, 'field_edit', SMOKE_CHG_FIELD, 'old', `new_${i}`, creator.id]
    );
  }
  const SMOKE_ESC_SOURCE = `smoke_t4_${uniqueMarker}`;
  for (let i = 0; i < 2; i++) {
    await execute(
      `INSERT INTO escalation_log (source_type, source_id, patient_thread_id, reason, level)
       VALUES ($1, $2, $3, $4, $5)`,
      [SMOKE_ESC_SOURCE, `${uniqueMarker}-${i}`, t4loser.id, `smoke reason ${i}`, 1]
    );
  }

  const r4 = await mergePatientThreads(t4winner.id, t4loser.id, actor, {
    reason: 'T4 FK re-parenting',
    endpoint: 'smoke-5.1-helper',
  });
  record(
    'T4.1 — merge re-parented 3 patient_changelog rows',
    r4.fkCounts['patient_changelog'] === 3,
    `count=${r4.fkCounts['patient_changelog']}`
  );
  record(
    'T4.2 — merge re-parented 2 escalation_log rows',
    r4.fkCounts['escalation_log'] === 2,
    `count=${r4.fkCounts['escalation_log']}`
  );

  const chgOnWinner = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_changelog WHERE patient_thread_id = $1 AND field_name = $2`,
    [t4winner.id, SMOKE_CHG_FIELD]
  );
  record(
    'T4.3 — winner now has 3 changelog rows',
    chgOnWinner[0]?.n === 3,
    `n=${chgOnWinner[0]?.n}`
  );
  const chgOnLoser = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_changelog WHERE patient_thread_id = $1 AND field_name = $2`,
    [t4loser.id, SMOKE_CHG_FIELD]
  );
  record(
    'T4.4 — loser has 0 changelog rows after merge',
    chgOnLoser[0]?.n === 0,
    `n=${chgOnLoser[0]?.n}`
  );

  // ===========================================================================
  // TEST 5: patient_files UNIQUE collision + re-parent
  // ===========================================================================
  console.log('\n--- TEST 5: patient_files UNIQUE collision handling ---');
  const t5winner = await createPatientThread({
    patient_name: `${TEST_PREFIX}T5_Winner_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t5winner.id);
  const t5loser = await createPatientThread({
    patient_name: `${TEST_PREFIX}T5_Loser_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t5loser.id);

  // Create 2 real file rows in `files` then link them to threads.
  const file1 = await query<{ id: string }>(
    `INSERT INTO files (filename, original_filename, mime_type, size_bytes, blob_url, blob_pathname, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      `${TEST_PREFIX}shared_${uniqueMarker}.pdf`,
      `shared_${uniqueMarker}.pdf`,
      'application/pdf',
      1000,
      `https://smoke.test/shared_${uniqueMarker}.pdf`,
      `smoke/shared_${uniqueMarker}.pdf`,
      creator.id,
    ]
  );
  const file2 = await query<{ id: string }>(
    `INSERT INTO files (filename, original_filename, mime_type, size_bytes, blob_url, blob_pathname, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      `${TEST_PREFIX}loser_only_${uniqueMarker}.pdf`,
      `loser_only_${uniqueMarker}.pdf`,
      'application/pdf',
      2000,
      `https://smoke.test/loser_only_${uniqueMarker}.pdf`,
      `smoke/loser_only_${uniqueMarker}.pdf`,
      creator.id,
    ]
  );
  const sharedFileId = file1[0].id;
  const loserOnlyFileId = file2[0].id;
  createdFileIds.push(sharedFileId, loserOnlyFileId);

  // Both winner and loser link the SHARED file (collision case).
  await execute(
    `INSERT INTO patient_files (patient_thread_id, file_id, file_name, linked_by)
     VALUES ($1, $2, $3, $4)`,
    [t5winner.id, sharedFileId, `${TEST_PREFIX}shared_file_${uniqueMarker}.pdf`, creator.id]
  );
  await execute(
    `INSERT INTO patient_files (patient_thread_id, file_id, file_name, linked_by)
     VALUES ($1, $2, $3, $4)`,
    [t5loser.id, sharedFileId, `${TEST_PREFIX}shared_file_${uniqueMarker}.pdf`, creator.id]
  );
  // Loser also has its own exclusive file (should re-parent cleanly).
  await execute(
    `INSERT INTO patient_files (patient_thread_id, file_id, file_name, linked_by)
     VALUES ($1, $2, $3, $4)`,
    [t5loser.id, loserOnlyFileId, `${TEST_PREFIX}loser_only_file_${uniqueMarker}.pdf`, creator.id]
  );

  const r5 = await mergePatientThreads(t5winner.id, t5loser.id, actor, {
    reason: 'T5 file collision',
    endpoint: 'smoke-5.1-helper',
  });
  record(
    'T5.1 — merge dropped 1 colliding file row from loser',
    r5.fileCollisionsDropped === 1,
    `dropped=${r5.fileCollisionsDropped}`
  );
  record(
    'T5.2 — merge re-parented 1 remaining loser file row',
    r5.fkCounts['patient_files'] === 1,
    `reparented=${r5.fkCounts['patient_files']}`
  );

  const winnerFiles = await query<{ file_id: string | null }>(
    `SELECT file_id FROM patient_files WHERE patient_thread_id = $1 ORDER BY file_id`,
    [t5winner.id]
  );
  record(
    'T5.3 — winner ends with 2 file rows (shared + loser_only)',
    winnerFiles.length === 2,
    `count=${winnerFiles.length}`
  );
  const loserFiles = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_files WHERE patient_thread_id = $1`,
    [t5loser.id]
  );
  record(
    'T5.4 — loser has 0 file rows after merge',
    loserFiles[0]?.n === 0,
    `n=${loserFiles[0]?.n}`
  );

  // ===========================================================================
  // TEST 6: dedup_candidates resolution
  // ===========================================================================
  console.log('\n--- TEST 6: dedup_candidates resolution ---');
  const t6winner = await createPatientThread({
    patient_name: `${TEST_PREFIX}T6_Winner_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t6winner.id);
  const t6loser = await createPatientThread({
    patient_name: `${TEST_PREFIX}T6_Loser_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(t6loser.id);

  const cand = await query<{ id: string }>(
    `INSERT INTO dedup_candidates (new_thread_id, existing_thread_id, similarity, match_type, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [t6loser.id, t6winner.id, 0.85, 'name_trgm']
  );
  const candidateId = cand[0].id;

  await mergePatientThreads(t6winner.id, t6loser.id, actor, {
    reason: 'T6 dedup_candidate resolve',
    endpoint: 'smoke-5.1-helper',
  });
  const candAfter = await queryOne<{ status: string; resolved_at: string | null }>(
    `SELECT status, resolved_at FROM dedup_candidates WHERE id = $1`,
    [candidateId]
  );
  record(
    'T6.1 — candidate status = merged after merge',
    candAfter?.status === 'merged',
    `status=${candAfter?.status}`
  );
  record(
    'T6.2 — candidate resolved_at set',
    !!candAfter?.resolved_at,
    `resolved_at=${candAfter?.resolved_at}`
  );

  // ===========================================================================
  // TEST 7: Idempotency — second merge throws "already merged"
  // ===========================================================================
  console.log('\n--- TEST 7: Idempotency — double-merge rejection ---');
  let threwAlreadyMerged = false;
  try {
    await mergePatientThreads(t6winner.id, t6loser.id, actor, {
      reason: 'T7 should fail',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already merged/i.test(msg)) threwAlreadyMerged = true;
  }
  record(
    'T7.1 — second merge throws "already merged"',
    threwAlreadyMerged,
    ''
  );

  // ===========================================================================
  // TEST 8: LSQ conflict guard
  // ===========================================================================
  console.log('\n--- TEST 8: LSQ conflict guard ---');
  const t8winner = await createPatientThread({
    patient_name: `${TEST_PREFIX}T8_Winner_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'lsq',
  });
  createdIds.push(t8winner.id);
  // Set distinct LSQ lead ids directly
  await execute(
    `UPDATE patient_threads SET lsq_lead_id = $2 WHERE id = $1`,
    [t8winner.id, `SMOKE_LSQ_A_${uniqueMarker}`]
  );
  const t8loser = await createPatientThread({
    patient_name: `${TEST_PREFIX}T8_Loser_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'lsq',
  });
  createdIds.push(t8loser.id);
  await execute(
    `UPDATE patient_threads SET lsq_lead_id = $2 WHERE id = $1`,
    [t8loser.id, `SMOKE_LSQ_B_${uniqueMarker}`]
  );

  let threwLsqConflict = false;
  try {
    await mergePatientThreads(t8winner.id, t8loser.id, actor, {
      reason: 'T8 conflict attempt',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/lsq lead ids/i.test(msg)) threwLsqConflict = true;
  }
  record(
    'T8.1 — LSQ conflict blocks merge without override',
    threwLsqConflict,
    ''
  );

  // With override keyword in reason, merge should succeed
  const r8 = await mergePatientThreads(t8winner.id, t8loser.id, actor, {
    reason: 'T8 override LSQ conflict for testing',
  });
  record(
    'T8.2 — merge succeeds when reason contains "override"',
    r8.winnerId === t8winner.id,
    ''
  );

  // ===========================================================================
  // TEST 9: dedup_log audit entry
  // ===========================================================================
  console.log('\n--- TEST 9: dedup_log audit entry ---');
  const logRow = await queryOne<{
    action: string;
    source_thread_id: string;
    target_thread_id: string;
    metadata: Record<string, unknown>;
    endpoint: string;
  }>(
    `SELECT action, source_thread_id, target_thread_id, metadata, endpoint
     FROM dedup_log
     WHERE source_thread_id = $1 AND target_thread_id = $2 AND action = 'merge'
     ORDER BY created_at DESC
     LIMIT 1`,
    [t1loser.id, t1winner.id]
  );
  record(
    'T9.1 — dedup_log has merge row for T1 pair',
    !!logRow && logRow.action === 'merge',
    `action=${logRow?.action}`
  );
  record(
    'T9.2 — dedup_log endpoint matches caller',
    logRow?.endpoint === 'smoke-5.1-helper',
    `endpoint=${logRow?.endpoint}`
  );
  record(
    'T9.3 — dedup_log metadata has merged_fields + fk_counts + loser_snapshot',
    !!logRow?.metadata &&
      Array.isArray((logRow.metadata as Record<string, unknown>).merged_fields) &&
      !!(logRow.metadata as Record<string, unknown>).fk_counts &&
      !!(logRow.metadata as Record<string, unknown>).loser_snapshot,
    ''
  );

  // ===========================================================================
  // TEST 10: Self-merge rejection
  // ===========================================================================
  console.log('\n--- TEST 10: Self-merge rejection ---');
  let threwSelfMerge = false;
  try {
    await mergePatientThreads(t1winner.id, t1winner.id, actor, {
      reason: 'T10 self-merge',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/into itself/i.test(msg)) threwSelfMerge = true;
  }
  record(
    'T10.1 — self-merge throws "cannot merge a thread into itself"',
    threwSelfMerge,
    ''
  );

  // ===========================================================================
  // CLEANUP
  // ===========================================================================
  console.log('\n--- Cleanup ---');
  try {
    if (createdIds.length > 0) {
      await query(
        `DELETE FROM dedup_log
          WHERE source_thread_id = ANY($1::uuid[])
             OR target_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM dedup_candidates
          WHERE new_thread_id = ANY($1::uuid[])
             OR existing_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_changelog WHERE patient_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM escalation_log WHERE patient_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_files WHERE patient_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      if (createdFileIds.length > 0) {
        await query(`DELETE FROM files WHERE id = ANY($1::uuid[])`, [createdFileIds]);
      }
      // Null out merged_into_id before deleting to avoid self-reference FK
      await query(
        `UPDATE patient_threads SET merged_into_id = NULL WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      console.log(`Cleanup: removed ${createdIds.length} test rows + ${createdFileIds.length} files`);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n=== PHASE 5.1 HELPER TEST RESULTS ===');
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${r.label}${r.note ? `  (${r.note})` : ''}`);
    if (r.pass) passed++;
    else failed++;
  }
  console.log(`\n${passed}/${results.length} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error('SMOKE TEST FATAL:', e);
  if (createdIds.length > 0) {
    try {
      await query(
        `DELETE FROM dedup_log
          WHERE source_thread_id = ANY($1::uuid[])
             OR target_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM dedup_candidates
          WHERE new_thread_id = ANY($1::uuid[])
             OR existing_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_changelog WHERE patient_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM escalation_log WHERE patient_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_files WHERE patient_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      if (createdFileIds.length > 0) {
        await query(`DELETE FROM files WHERE id = ANY($1::uuid[])`, [createdFileIds]);
      }
      await query(
        `UPDATE patient_threads SET merged_into_id = NULL WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      console.log(`Crash cleanup: removed ${createdIds.length} rows`);
    } catch {
      /* noop */
    }
  }
  process.exit(1);
});
