/**
 * Phase 4 smoke test — verifies the KX CSV import matching helper
 * (`src/lib/kx-import-match.ts`) against live Neon.
 *
 * Phase 4 replaces the route's old "name+phone exact" Tier 2 with a pure
 * phone Layer 1 match, guarded by a UHID collision check. The matching
 * logic was extracted into a helper so the route and this smoke test share
 * one implementation.
 *
 * Tests exercised end-to-end:
 *
 *   1. UHID exact match  →  matchedVia='uhid', no dedup_log side effect.
 *   2. Phone link to a UHID-less row (typical manual thread without UHID)
 *      →  matchedVia='phone', dedup_log has 'link' row.
 *   3. Phone link when incoming UHID == existing UHID (redundant but safe)
 *      →  matchedVia='uhid' because Tier 1 fires first.
 *   4. Phone collision — incoming UHID differs from existing UHID but
 *      phones match (family members sharing a phone)
 *      →  existing=null, collisionSkipped=true, dedup_log has 'ignore' row.
 *   5. No match at all (brand new UHID + phone)
 *      →  existing=null, matchedVia=null, no dedup_log side effect.
 *   6. Within-batch chained match — after the route links a row and updates
 *      its UHID, a subsequent call with the same UHID should match Tier 1.
 *
 * All temp rows + audit rows are hard-deleted at the end. Safe to re-run.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/smoke-test-phase4.ts
 */

import {
  matchKxRow,
  buildKxIndexes,
  type KxExistingPatient,
} from '../src/lib/kx-import-match';
import { createPatientThread } from '../src/lib/db-v5';
import { query, queryOne } from '../src/lib/db';

interface CheckResult {
  label: string;
  pass: boolean;
  note?: string;
}
const results: CheckResult[] = [];
const record = (label: string, pass: boolean, note?: string) =>
  results.push({ label, pass, note });

const TEST_PREFIX = '__SMOKE_PHASE4_';
const createdIds: string[] = [];

async function getAnyProfileId(): Promise<{ id: string; email: string | null }> {
  const row = await queryOne<{ id: string; email: string | null }>(
    `SELECT id, email FROM profiles WHERE role IS NOT NULL ORDER BY created_at ASC LIMIT 1`
  );
  if (!row) throw new Error('No profile found to use as created_by');
  return row;
}

/**
 * Give the fire-and-forget logDedupAction promises enough time to flush.
 * matchKxRow returns synchronously but kicks off .catch()-chained inserts.
 */
async function flush(ms = 300) {
  await new Promise((r) => setTimeout(r, ms));
}

async function countDedupLog(
  opts: {
    target_thread_id?: string;
    source_thread_id?: string;
    action: 'link' | 'ignore';
    reason: string;
  }
): Promise<number> {
  if (opts.target_thread_id) {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM dedup_log
        WHERE target_thread_id = $1 AND action = $2
          AND endpoint = 'kx_import' AND reason = $3`,
      [opts.target_thread_id, opts.action, opts.reason]
    );
    return row?.n ?? 0;
  }
  if (opts.source_thread_id) {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM dedup_log
        WHERE source_thread_id = $1 AND action = $2
          AND endpoint = 'kx_import' AND reason = $3`,
      [opts.source_thread_id, opts.action, opts.reason]
    );
    return row?.n ?? 0;
  }
  return 0;
}

async function main() {
  const creator = await getAnyProfileId();
  console.log('Using creator profile:', creator.id);

  const uniqueMarker = Math.floor(Math.random() * 1_000_000);
  const actor = { profileId: creator.id, email: creator.email };

  // Three seed rows representing distinct real-world shapes:
  //
  //   seedUhid     — LSQ-style row WITH a uhid + a phone (P_shared_LSQ).
  //   seedNoUhid   — Manual-entry row WITHOUT a uhid but with a phone (P_manual).
  //   seedFamily   — LSQ-style row with a DIFFERENT uhid but sharing phone P_family
  //                  with the incoming KX row → family-member collision case.
  //
  // We also need a brand-new phone P_brand that matches nothing, for the
  // no-match passthrough test.

  const P_shared_LSQ = '9' + String(Date.now()).slice(-9);
  const P_manual = '9' + String(Date.now() + 1).slice(-9);
  const P_family = '9' + String(Date.now() + 2).slice(-9);

  const UHID_seed_lsq = `KX-SMOKE-${uniqueMarker}-A`;
  const UHID_seed_family = `KX-SMOKE-${uniqueMarker}-FAM`;

  // --- Seed data ---
  const seedUhid = await createPatientThread({
    patient_name: `${TEST_PREFIX}LSQ With Uhid ${uniqueMarker}`,
    uhid: UHID_seed_lsq,
    current_stage: 'opd',
    created_by: creator.id,
    phone: P_shared_LSQ,
    whatsapp_number: P_shared_LSQ,
    source_type: 'lsq',
  });
  createdIds.push(seedUhid.id);

  const seedNoUhid = await createPatientThread({
    patient_name: `${TEST_PREFIX}Manual No Uhid ${uniqueMarker}`,
    current_stage: 'opd',
    created_by: creator.id,
    phone: P_manual,
    whatsapp_number: P_manual,
    source_type: 'manual',
  });
  createdIds.push(seedNoUhid.id);

  const seedFamily = await createPatientThread({
    patient_name: `${TEST_PREFIX}Family Member ${uniqueMarker}`,
    uhid: UHID_seed_family,
    current_stage: 'opd',
    created_by: creator.id,
    phone: P_family,
    whatsapp_number: P_family,
    source_type: 'lsq',
  });
  createdIds.push(seedFamily.id);

  console.log('Seeded 3 rows:', {
    uhid: seedUhid.id,
    noUhid: seedNoUhid.id,
    family: seedFamily.id,
  });

  // Build the indexes once from the seed rows (the route does this once per
  // import batch).
  const seedRows: KxExistingPatient[] = [
    {
      id: seedUhid.id,
      uhid: UHID_seed_lsq,
      patient_name: `${TEST_PREFIX}LSQ With Uhid ${uniqueMarker}`,
      phone: P_shared_LSQ,
      whatsapp_number: P_shared_LSQ,
      current_stage: 'opd',
      getstream_channel_id: null,
      lsq_lead_id: null,
      source_type: 'lsq',
    },
    {
      id: seedNoUhid.id,
      uhid: null,
      patient_name: `${TEST_PREFIX}Manual No Uhid ${uniqueMarker}`,
      phone: P_manual,
      whatsapp_number: P_manual,
      current_stage: 'opd',
      getstream_channel_id: null,
      lsq_lead_id: null,
      source_type: 'manual',
    },
    {
      id: seedFamily.id,
      uhid: UHID_seed_family,
      patient_name: `${TEST_PREFIX}Family Member ${uniqueMarker}`,
      phone: P_family,
      whatsapp_number: P_family,
      current_stage: 'opd',
      getstream_channel_id: null,
      lsq_lead_id: null,
      source_type: 'lsq',
    },
  ];
  const { byUhid, byPhone } = buildKxIndexes(seedRows);

  // ===========================================================================
  // TEST 1: UHID exact match — Tier 1 fires, phone is ignored
  // ===========================================================================
  console.log('\n--- TEST 1: UHID exact match ---');

  const test1 = matchKxRow(
    {
      uhid: UHID_seed_lsq,
      patient_name: 'anything',
      mobile: '9999999999', // intentionally DIFFERENT phone — UHID must win
    },
    byUhid,
    byPhone,
    actor
  );
  record(
    'TEST 1 — existing is the UHID seed row',
    test1.existing?.id === seedUhid.id,
    `got=${test1.existing?.id}`
  );
  record(
    'TEST 1 — matchedVia=uhid',
    test1.matchedVia === 'uhid',
    `got=${test1.matchedVia}`
  );
  record(
    'TEST 1 — collisionSkipped=false',
    test1.collisionSkipped === false,
    `got=${test1.collisionSkipped}`
  );

  // ===========================================================================
  // TEST 2: Phone link to UHID-less manual row
  // ===========================================================================
  console.log('\n--- TEST 2: Phone → UHID-less row link ---');

  const incomingUhidForTest2 = `KX-SMOKE-${uniqueMarker}-NEW`;
  const test2 = matchKxRow(
    {
      uhid: incomingUhidForTest2,
      patient_name: `${TEST_PREFIX}Incoming KX ${uniqueMarker}`,
      mobile: '+91-' + P_manual, // reformatted — normalizer must strip non-digits
    },
    byUhid,
    byPhone,
    actor
  );
  record(
    'TEST 2 — existing is the manual seed row',
    test2.existing?.id === seedNoUhid.id,
    `got=${test2.existing?.id}`
  );
  record(
    'TEST 2 — matchedVia=phone',
    test2.matchedVia === 'phone',
    `got=${test2.matchedVia}`
  );
  record(
    'TEST 2 — collisionSkipped=false',
    test2.collisionSkipped === false
  );

  await flush();
  const linkLogCount = await countDedupLog({
    target_thread_id: seedNoUhid.id,
    action: 'link',
    reason: 'kx_import_phone_link',
  });
  record(
    'TEST 2 — dedup_log has a kx_import_phone_link row',
    linkLogCount >= 1,
    `count=${linkLogCount}`
  );

  // ===========================================================================
  // TEST 3: Phone link where incoming UHID == existing UHID → Tier 1 wins
  // ===========================================================================
  console.log('\n--- TEST 3: Same UHID + same phone → Tier 1 wins ---');

  const test3 = matchKxRow(
    {
      uhid: UHID_seed_lsq, // same as seedUhid
      patient_name: 'doesnt matter',
      mobile: P_shared_LSQ,
    },
    byUhid,
    byPhone,
    actor
  );
  record(
    'TEST 3 — existing is seedUhid',
    test3.existing?.id === seedUhid.id,
    `got=${test3.existing?.id}`
  );
  record(
    'TEST 3 — matchedVia=uhid (Tier 1 fires before Tier 2)',
    test3.matchedVia === 'uhid',
    `got=${test3.matchedVia}`
  );

  // ===========================================================================
  // TEST 4: Phone collision — different UHID, same phone → log ignore, null out
  // ===========================================================================
  console.log('\n--- TEST 4: Phone collision (family members) ---');

  const incomingUhidForTest4 = `KX-SMOKE-${uniqueMarker}-OTHER`;
  const test4 = matchKxRow(
    {
      uhid: incomingUhidForTest4, // a DIFFERENT uhid than seedFamily's
      patient_name: `${TEST_PREFIX}Brother ${uniqueMarker}`,
      mobile: P_family,
    },
    byUhid,
    byPhone,
    actor
  );
  record(
    'TEST 4 — existing is null (collision blocked the link)',
    test4.existing === null,
    `got=${test4.existing?.id ?? 'null'}`
  );
  record(
    'TEST 4 — matchedVia is null',
    test4.matchedVia === null,
    `got=${test4.matchedVia}`
  );
  record(
    'TEST 4 — collisionSkipped=true',
    test4.collisionSkipped === true,
    `got=${test4.collisionSkipped}`
  );

  await flush();
  const ignoreLogCount = await countDedupLog({
    source_thread_id: seedFamily.id,
    action: 'ignore',
    reason: 'kx_import_phone_uhid_collision',
  });
  record(
    'TEST 4 — dedup_log has a kx_import_phone_uhid_collision row',
    ignoreLogCount >= 1,
    `count=${ignoreLogCount}`
  );

  // ===========================================================================
  // TEST 5: No match at all (new UHID + new phone) → pure passthrough
  // ===========================================================================
  console.log('\n--- TEST 5: No match → passthrough ---');

  const P_brand = '8' + String(Date.now() + 9).slice(-9);
  const test5 = matchKxRow(
    {
      uhid: `KX-SMOKE-${uniqueMarker}-BRAND`,
      patient_name: `${TEST_PREFIX}Brand New ${uniqueMarker}`,
      mobile: P_brand,
    },
    byUhid,
    byPhone,
    actor
  );
  record(
    'TEST 5 — existing is null',
    test5.existing === null,
    `got=${test5.existing?.id ?? 'null'}`
  );
  record(
    'TEST 5 — matchedVia is null',
    test5.matchedVia === null,
    `got=${test5.matchedVia}`
  );
  record(
    'TEST 5 — collisionSkipped is false',
    test5.collisionSkipped === false,
    `got=${test5.collisionSkipped}`
  );

  await flush();
  // Sanity check — no stray dedup_log row for the brand-new row
  const strayCount = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM dedup_log
      WHERE endpoint = 'kx_import'
        AND (metadata->>'kx_uhid') = $1`,
    [`KX-SMOKE-${uniqueMarker}-BRAND`]
  );
  record(
    'TEST 5 — no dedup_log row written for the brand-new UHID',
    (strayCount?.n ?? 0) === 0,
    `count=${strayCount?.n}`
  );

  // ===========================================================================
  // TEST 6: Within-batch chained match — after a link, the route updates the
  // map in place so a later row with the same UHID hits Tier 1.
  // ===========================================================================
  console.log('\n--- TEST 6: Within-batch chained UHID match ---');

  // Simulate what the route does after TEST 2's link: fill in the linked row's
  // UHID on the byUhid map.
  const filledInUhid = incomingUhidForTest2;
  const linkedRow: KxExistingPatient = {
    ...seedNoUhid as unknown as KxExistingPatient,
    id: seedNoUhid.id,
    uhid: filledInUhid,
    patient_name: `${TEST_PREFIX}Manual No Uhid ${uniqueMarker}`,
    phone: P_manual,
    whatsapp_number: P_manual,
    current_stage: 'opd',
    getstream_channel_id: null,
    lsq_lead_id: null,
    source_type: 'manual',
  };
  byUhid.set(filledInUhid.toLowerCase(), linkedRow);

  // Now call matchKxRow again with the same UHID — should hit Tier 1.
  const test6 = matchKxRow(
    {
      uhid: filledInUhid,
      patient_name: 'second row',
      mobile: P_manual,
    },
    byUhid,
    byPhone,
    actor
  );
  record(
    'TEST 6 — within-batch UHID lookup returns the linked row',
    test6.existing?.id === seedNoUhid.id,
    `got=${test6.existing?.id}`
  );
  record(
    'TEST 6 — matchedVia=uhid on the chained call',
    test6.matchedVia === 'uhid',
    `got=${test6.matchedVia}`
  );

  // ===========================================================================
  // CLEANUP
  // ===========================================================================
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
        `DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      console.log(`\nCleanup: removed ${createdIds.length} test rows`);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n=== PHASE 4 SMOKE TEST RESULTS ===');
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
      await query(`DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`, [createdIds]);
      console.log(`Crash cleanup: removed ${createdIds.length} rows`);
    } catch {
      /* noop */
    }
  }
  process.exit(1);
});
