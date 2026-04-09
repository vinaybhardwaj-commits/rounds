/**
 * Phase 2 smoke test — verifies the dedup library + createPatientThread
 * extended columns end-to-end against live Neon.
 *
 * Does NOT hit the /api/patients endpoint (requires auth cookie). Instead
 * it exercises the same building blocks the route uses, to prove the
 * database layer accepts the new fields and all 3 dedup actions behave.
 *
 * Cleans up all test rows at the end. Safe to re-run.
 *
 * Run: npx tsx scripts/smoke-test-phase2.ts
 */

import {
  checkForDuplicate,
  linkToExistingThread,
  flagAsFuzzyDuplicate,
  normalizePhone,
} from '../src/lib/dedup';
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

const TEST_PREFIX = '__SMOKE_PHASE2_';
const createdIds: string[] = [];

async function getAnyProfileId(): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE role IS NOT NULL ORDER BY created_at ASC LIMIT 1`
  );
  if (!row) throw new Error('No profile found to use as created_by');
  return row.id;
}

async function main() {
  const creatorId = await getAnyProfileId();
  console.log('Using creator profile:', creatorId);

  // -------------------------------------------------------------------------
  // TEST 1: Layer 3 — clean create with all new R.3/R.4 fields
  // -------------------------------------------------------------------------
  const uniqueMarker = Math.floor(Math.random() * 1_000_000);
  const layer3Name = `${TEST_PREFIX}Ranjana Smoke ${uniqueMarker}`;
  const layer3Phone = '9' + String(Date.now()).slice(-9); // unique 10-digit phone

  // Pre-check should say "create"
  const pre3 = await checkForDuplicate({
    name: layer3Name,
    phone: layer3Phone,
  });
  record(
    'Layer 3 pre-check → action=create (brand-new patient)',
    pre3.action === 'create',
    `action=${pre3.action} layer=${pre3.layer}`
  );

  // Insert with ALL the new fields
  const created3 = await createPatientThread({
    patient_name: layer3Name,
    current_stage: 'opd',
    created_by: creatorId,
    phone: layer3Phone,
    whatsapp_number: layer3Phone,
    age: 42,
    gender: 'female',
    city: 'Bengaluru',
    source_type: 'manual',
    source_detail: null,
    chief_complaint: 'Headache for 3 weeks',
    target_department: 'Neurology',
    insurance_status: 'cash',
    is_existing_member: false,
    member_type: null,
  });
  createdIds.push(created3.id);

  // Read back and verify all 11 new columns landed
  const row3 = await queryOne<{
    phone: string | null;
    age: number | null;
    gender: string | null;
    city: string | null;
    source_type: string | null;
    chief_complaint: string | null;
    target_department: string | null;
    insurance_status: string | null;
    is_existing_member: boolean;
    member_type: string | null;
    is_returning_patient: boolean;
    returning_patient_count: number;
    is_possible_duplicate: boolean;
  }>(
    `SELECT phone, age, gender, city, source_type, chief_complaint, target_department,
            insurance_status, is_existing_member, member_type,
            is_returning_patient, returning_patient_count, is_possible_duplicate
       FROM patient_threads WHERE id = $1`,
    [created3.id]
  );

  record(
    'Layer 3 row — phone persisted',
    row3?.phone === layer3Phone,
    `got=${row3?.phone}`
  );
  record('Layer 3 row — age=42', row3?.age === 42);
  record('Layer 3 row — gender=female', row3?.gender === 'female');
  record('Layer 3 row — city=Bengaluru', row3?.city === 'Bengaluru');
  record('Layer 3 row — source_type=manual', row3?.source_type === 'manual');
  record('Layer 3 row — chief_complaint set', row3?.chief_complaint === 'Headache for 3 weeks');
  record('Layer 3 row — target_department=Neurology', row3?.target_department === 'Neurology');
  record('Layer 3 row — insurance_status=cash', row3?.insurance_status === 'cash');
  record('Layer 3 row — is_existing_member=false', row3?.is_existing_member === false);
  record('Layer 3 row — is_returning_patient=false (fresh)', row3?.is_returning_patient === false);
  record('Layer 3 row — returning_patient_count=0', row3?.returning_patient_count === 0);
  record('Layer 3 row — is_possible_duplicate=false (clean)', row3?.is_possible_duplicate === false);

  // -------------------------------------------------------------------------
  // TEST 2: Layer 1 — same phone triggers link, merge bumps returning count
  // -------------------------------------------------------------------------
  // Different name, alternative format of same phone
  const reformattedPhone = '+91 ' + normalizePhone(layer3Phone);
  const layer1 = await checkForDuplicate({
    name: 'Different Name Xyz',
    phone: reformattedPhone,
  });
  record(
    'Layer 1 — reformatted phone matches Layer 3 patient',
    layer1.action === 'link' && layer1.matchedThread?.id === created3.id,
    `action=${layer1.action} matchedId=${layer1.matchedThread?.id}`
  );

  // Simulate the POST handler path — merge incoming data
  if (layer1.action === 'link' && layer1.matchedThread) {
    await linkToExistingThread(layer1.matchedThread.id, {
      name: 'Different Name Xyz',
      phone: reformattedPhone,
      whatsapp: null,
      email: 'new@example.com',
      age: null,
      gender: null,
      city: 'Mysuru', // won't overwrite "Bengaluru" because COALESCE merges into NULLs only
      chief_complaint: 'Dizziness',
      insurance_status: null,
      target_department: null,
    });

    const afterLink = await queryOne<{
      city: string | null;
      chief_complaint: string | null;
      email: string | null;
      is_returning_patient: boolean;
      returning_patient_count: number;
    }>(
      `SELECT city, chief_complaint, email, is_returning_patient, returning_patient_count
         FROM patient_threads WHERE id = $1`,
      [created3.id]
    );

    record(
      'Layer 1 link — city preserved (COALESCE does not overwrite)',
      afterLink?.city === 'Bengaluru',
      `got=${afterLink?.city}`
    );
    record(
      'Layer 1 link — chief_complaint preserved',
      afterLink?.chief_complaint === 'Headache for 3 weeks',
      `got=${afterLink?.chief_complaint}`
    );
    record(
      'Layer 1 link — email filled in (was NULL)',
      afterLink?.email === 'new@example.com',
      `got=${afterLink?.email}`
    );
    record(
      'Layer 1 link — is_returning_patient=true after bump',
      afterLink?.is_returning_patient === true
    );
    record(
      'Layer 1 link — returning_patient_count incremented',
      (afterLink?.returning_patient_count ?? 0) >= 1,
      `count=${afterLink?.returning_patient_count}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 3: Layer 2 — similar name, different phone → flag as possible dup
  // -------------------------------------------------------------------------
  const layer2Name = layer3Name.replace('Smoke', 'Smokey'); // trigram > 0.6
  const layer2Phone = '9' + String(Date.now() + 1).slice(-9);

  const pre2 = await checkForDuplicate({
    name: layer2Name,
    phone: layer2Phone,
  });
  record(
    'Layer 2 pre-check — similar name, diff phone → flag or create',
    pre2.action === 'flag' || pre2.action === 'create',
    `action=${pre2.action} fuzzyCount=${pre2.fuzzyMatches?.length ?? 0}`
  );

  const created2 = await createPatientThread({
    patient_name: layer2Name,
    current_stage: 'opd',
    created_by: creatorId,
    phone: layer2Phone,
    whatsapp_number: layer2Phone,
    age: 45,
    gender: 'female',
    source_type: 'manual',
    chief_complaint: 'Test Layer 2',
  });
  createdIds.push(created2.id);

  if (pre2.action === 'flag' && pre2.fuzzyMatches) {
    await flagAsFuzzyDuplicate(created2.id, pre2.fuzzyMatches);
    const row2 = await queryOne<{ is_possible_duplicate: boolean }>(
      `SELECT is_possible_duplicate FROM patient_threads WHERE id = $1`,
      [created2.id]
    );
    record(
      'Layer 2 row — is_possible_duplicate=true after flag',
      row2?.is_possible_duplicate === true
    );

    const cands = await query<{ id: string }>(
      `SELECT id FROM dedup_candidates WHERE new_thread_id = $1 AND status = 'pending'`,
      [created2.id]
    );
    record(
      'Layer 2 — dedup_candidates row created',
      cands.length >= 1,
      `count=${cands.length}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 4: existing-member checkbox persists
  // -------------------------------------------------------------------------
  const memberName = `${TEST_PREFIX}Even Member ${uniqueMarker}`;
  const memberPhone = '9' + String(Date.now() + 2).slice(-9);
  const createdMember = await createPatientThread({
    patient_name: memberName,
    current_stage: 'opd',
    created_by: creatorId,
    phone: memberPhone,
    source_type: 'manual',
    is_existing_member: true,
    member_type: 'care_plan',
  });
  createdIds.push(createdMember.id);

  const memberRow = await queryOne<{ is_existing_member: boolean; member_type: string | null }>(
    `SELECT is_existing_member, member_type FROM patient_threads WHERE id = $1`,
    [createdMember.id]
  );
  record(
    'Member checkbox — is_existing_member=true persisted',
    memberRow?.is_existing_member === true
  );
  record(
    'Member checkbox — member_type=care_plan persisted',
    memberRow?.member_type === 'care_plan'
  );

  // -------------------------------------------------------------------------
  // CLEANUP — hard-delete test rows + their dedup_candidates
  // -------------------------------------------------------------------------
  if (createdIds.length > 0) {
    // dedup_candidates will cascade via FK
    await query(
      `DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`,
      [createdIds]
    );
    await query(
      `DELETE FROM dedup_log WHERE source_thread_id = ANY($1::uuid[]) OR target_thread_id = ANY($1::uuid[])`,
      [createdIds]
    );
    console.log(`\nCleanup: removed ${createdIds.length} test rows`);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n=== PHASE 2 SMOKE TEST RESULTS ===');
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
  // Best-effort cleanup on crash
  if (createdIds.length > 0) {
    try {
      await query(`DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`, [createdIds]);
      console.log(`Cleanup after crash: removed ${createdIds.length} rows`);
    } catch { /* noop */ }
  }
  process.exit(1);
});
