/**
 * Phase 3 smoke test — verifies that the LSQ sync pipeline now uses the
 * dedup engine to link incoming leads to pre-existing manual threads by
 * phone, and to skip duplicate LSQ leads that share a phone.
 *
 * Tests three paths end-to-end against live Neon:
 *
 *   1. Manual thread exists → LSQ lead arrives with matching phone
 *      → expect UPDATE on existing row, no new row, lsq_lead_id attached,
 *        existing data preserved (COALESCE), dedup_log has a 'link' row.
 *
 *   2. LSQ thread already exists → a SECOND LSQ lead arrives with the same
 *      phone but a different lsq_lead_id → expect SKIP, no new row,
 *      dedup_log has an 'ignore' row, existing lead unchanged.
 *
 *   3. Passthrough — brand-new LSQ lead with no matching phone → expect
 *      CREATE as before (no regression).
 *
 * Cleans up all test rows + audit rows at the end. Safe to re-run.
 *
 * Run: npx tsx scripts/smoke-test-phase3.ts
 */

import { upsertLeadAsPatient } from '../src/lib/lsq-sync';
import { createPatientThread } from '../src/lib/db-v5';
import { query, queryOne } from '../src/lib/db';
import type { NormalizedLead } from '../src/lib/leadsquared';

interface CheckResult {
  label: string;
  pass: boolean;
  note?: string;
}
const results: CheckResult[] = [];
const record = (label: string, pass: boolean, note?: string) =>
  results.push({ label, pass, note });

const TEST_PREFIX = '__SMOKE_PHASE3_';
const createdIds: string[] = [];
const createdLsqLeadIds: string[] = [];

function makeNormalized(overrides: Partial<NormalizedLead>): NormalizedLead {
  return {
    lsqLeadId: overrides.lsqLeadId || `phase3-lead-${Date.now()}`,
    lsqProspectAutoId: overrides.lsqProspectAutoId || `phase3-prospect-${Date.now()}`,
    patientName: overrides.patientName || `${TEST_PREFIX}Test Patient`,
    phone: overrides.phone ?? null,
    whatsappNumber: overrides.whatsappNumber ?? overrides.phone ?? null,
    email: overrides.email ?? null,
    gender: overrides.gender ?? null,
    age: overrides.age ?? null,
    dateOfBirth: overrides.dateOfBirth ?? null,
    city: overrides.city ?? null,
    state: overrides.state ?? null,
    address: overrides.address ?? null,
    zip: overrides.zip ?? null,
    ailment: overrides.ailment ?? null,
    uhid: overrides.uhid ?? null,
    ipNumber: overrides.ipNumber ?? null,
    doctorName: overrides.doctorName ?? null,
    appointmentDate: overrides.appointmentDate ?? null,
    hospitalLocation: overrides.hospitalLocation ?? null,
    primaryDiagnosis: overrides.primaryDiagnosis ?? null,
    plannedProcedure: overrides.plannedProcedure ?? null,
    surgeryOrderValue: overrides.surgeryOrderValue ?? null,
    lsqLeadStage: overrides.lsqLeadStage || 'OPD WIN',
    roundsStage: overrides.roundsStage || 'opd',
    leadSource: overrides.leadSource ?? 'HOSPITAL',
    utmSource: overrides.utmSource ?? null,
    utmCampaign: overrides.utmCampaign ?? null,
    utmMedium: overrides.utmMedium ?? null,
    signupUrl: overrides.signupUrl ?? null,
    ownerName: overrides.ownerName ?? null,
    ownerEmail: overrides.ownerEmail ?? null,
    lsqCreatedOn: overrides.lsqCreatedOn ?? new Date().toISOString(),
  };
}

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

  const uniqueMarker = Math.floor(Math.random() * 1_000_000);

  // ===========================================================================
  // TEST 1: Manual thread → LSQ phone match → LINK path
  // ===========================================================================
  console.log('\n--- TEST 1: Manual → LSQ phone link ---');

  const manualName = `${TEST_PREFIX}Manual First ${uniqueMarker}`;
  const sharedPhone = '9' + String(Date.now()).slice(-9);

  // Step A: create a manual thread (no lsq_lead_id)
  const manualThread = await createPatientThread({
    patient_name: manualName,
    current_stage: 'opd',
    created_by: creatorId,
    phone: sharedPhone,
    whatsapp_number: sharedPhone,
    age: 37,
    gender: 'male',
    city: 'Bengaluru',
    source_type: 'manual',
    chief_complaint: 'Back pain 2 weeks',
    target_department: 'Orthopedics',
    insurance_status: 'cash',
  });
  createdIds.push(manualThread.id);
  console.log(`Manual thread created: ${manualThread.id}`);

  // Count pre-state
  const preCountAll = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_threads
      WHERE RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1`,
    [sharedPhone]
  );
  record(
    'TEST 1 pre — exactly 1 row exists with shared phone',
    preCountAll?.n === 1,
    `count=${preCountAll?.n}`
  );

  // Step B: simulate LSQ sync for a lead with the SAME phone but a different
  // name. Normalized phone will match Layer 1.
  const lsqLeadIdA = `phase3-leadA-${uniqueMarker}`;
  createdLsqLeadIds.push(lsqLeadIdA);

  const incomingLsq = makeNormalized({
    lsqLeadId: lsqLeadIdA,
    lsqProspectAutoId: `phase3-propA-${uniqueMarker}`,
    patientName: `${TEST_PREFIX}From LSQ ${uniqueMarker}`, // different name
    phone: '+91-' + sharedPhone,                            // reformatted same phone
    whatsappNumber: '+91-' + sharedPhone,
    email: 'lsq-sync@example.com',
    city: 'Mysuru',                                         // should NOT overwrite
    gender: 'female',                                       // should NOT overwrite 'male'
    age: 42,                                                // should NOT overwrite 37
    ailment: 'Knee pain',                                   // new info — ailment was NULL
    uhid: 'UH-PHASE3-001',                                  // new info
    lsqLeadStage: 'OPD WIN',
    roundsStage: 'opd',
    ownerName: 'LSQ Owner',
    ownerEmail: 'owner@example.com',
  });

  const upsertResult1 = await upsertLeadAsPatient(incomingLsq, {
    doctorName: 'Dr. Test',
    appointmentDate: '2026-04-10T10:00:00Z',
    hospitalLocation: 'RCR',
  });

  record(
    'TEST 1 — upsert returned action=updated',
    upsertResult1.action === 'updated',
    `action=${upsertResult1.action} id=${upsertResult1.id}`
  );
  record(
    'TEST 1 — upsert returned the manual thread id (not a new one)',
    upsertResult1.id === manualThread.id,
    `got=${upsertResult1.id} expected=${manualThread.id}`
  );

  // Count post-state — still 1 row
  const postCountAll = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_threads
      WHERE RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1`,
    [sharedPhone]
  );
  record(
    'TEST 1 — still exactly 1 row with shared phone (no dup created)',
    postCountAll?.n === 1,
    `count=${postCountAll?.n}`
  );

  // Verify the linked row state
  const linkedRow = await queryOne<{
    patient_name: string;
    phone: string | null;
    city: string | null;
    gender: string | null;
    age: number | null;
    ailment: string | null;
    uhid: string | null;
    email: string | null;
    lsq_lead_id: string | null;
    lsq_lead_stage: string | null;
    lsq_owner_name: string | null;
    doctor_name: string | null;
    source_type: string | null;
    current_stage: string | null;
  }>(
    `SELECT patient_name, phone, city, gender, age, ailment, uhid, email,
            lsq_lead_id, lsq_lead_stage, lsq_owner_name, doctor_name,
            source_type, current_stage
       FROM patient_threads WHERE id = $1`,
    [manualThread.id]
  );

  record(
    'TEST 1 — lsq_lead_id attached to existing manual row',
    linkedRow?.lsq_lead_id === lsqLeadIdA,
    `got=${linkedRow?.lsq_lead_id}`
  );
  record(
    'TEST 1 — lsq_lead_stage set',
    linkedRow?.lsq_lead_stage === 'OPD WIN',
    `got=${linkedRow?.lsq_lead_stage}`
  );
  record(
    'TEST 1 — lsq_owner_name set',
    linkedRow?.lsq_owner_name === 'LSQ Owner',
    `got=${linkedRow?.lsq_owner_name}`
  );
  record(
    'TEST 1 — existing patient_name preserved (COALESCE)',
    linkedRow?.patient_name === manualName,
    `got=${linkedRow?.patient_name}`
  );
  record(
    'TEST 1 — existing city preserved (Bengaluru, not Mysuru)',
    linkedRow?.city === 'Bengaluru',
    `got=${linkedRow?.city}`
  );
  record(
    'TEST 1 — existing gender preserved (male, not female)',
    linkedRow?.gender === 'male',
    `got=${linkedRow?.gender}`
  );
  record(
    'TEST 1 — existing age preserved (37, not 42)',
    linkedRow?.age === 37,
    `got=${linkedRow?.age}`
  );
  record(
    'TEST 1 — ailment filled in from LSQ (was NULL)',
    linkedRow?.ailment === 'Knee pain',
    `got=${linkedRow?.ailment}`
  );
  record(
    'TEST 1 — uhid filled in from LSQ (was NULL)',
    linkedRow?.uhid === 'UH-PHASE3-001',
    `got=${linkedRow?.uhid}`
  );
  record(
    'TEST 1 — email filled in from LSQ (was NULL)',
    linkedRow?.email === 'lsq-sync@example.com',
    `got=${linkedRow?.email}`
  );
  record(
    'TEST 1 — doctor_name filled in from enriched data',
    linkedRow?.doctor_name === 'Dr. Test',
    `got=${linkedRow?.doctor_name}`
  );

  // Verify dedup_log row
  const linkLog = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM dedup_log
      WHERE target_thread_id = $1 AND action = 'link' AND endpoint = 'lsq_sync'`,
    [manualThread.id]
  );
  record(
    'TEST 1 — dedup_log has link audit row',
    (linkLog?.n ?? 0) >= 1,
    `count=${linkLog?.n}`
  );

  // ===========================================================================
  // TEST 2: LSQ×LSQ phone collision → SKIP path
  // ===========================================================================
  console.log('\n--- TEST 2: LSQ×LSQ phone collision ---');

  // The manual row from TEST 1 now has lsq_lead_id = lsqLeadIdA.
  // A second LSQ lead (different lsq_lead_id) arrives with the same phone.
  const lsqLeadIdB = `phase3-leadB-${uniqueMarker}`;
  createdLsqLeadIds.push(lsqLeadIdB);

  const collisionLsq = makeNormalized({
    lsqLeadId: lsqLeadIdB,
    lsqProspectAutoId: `phase3-propB-${uniqueMarker}`,
    patientName: `${TEST_PREFIX}Collision Lead ${uniqueMarker}`,
    phone: sharedPhone,
    whatsappNumber: sharedPhone,
    city: 'Hyderabad',
    lsqLeadStage: 'IPD WIN',
    roundsStage: 'pre_admission',
  });

  const upsertResult2 = await upsertLeadAsPatient(collisionLsq);

  record(
    'TEST 2 — upsert returned action=skipped',
    upsertResult2.action === 'skipped',
    `action=${upsertResult2.action}`
  );

  // Count post-state — still 1 row
  const test2PostCount = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_threads
      WHERE RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1`,
    [sharedPhone]
  );
  record(
    'TEST 2 — still exactly 1 row with shared phone (collision skipped)',
    test2PostCount?.n === 1,
    `count=${test2PostCount?.n}`
  );

  // Verify the row state was NOT changed by the collision attempt
  const afterCollisionRow = await queryOne<{
    lsq_lead_id: string | null;
    lsq_lead_stage: string | null;
    patient_name: string;
    city: string | null;
  }>(
    `SELECT lsq_lead_id, lsq_lead_stage, patient_name, city
       FROM patient_threads WHERE id = $1`,
    [manualThread.id]
  );
  record(
    'TEST 2 — existing lsq_lead_id unchanged after collision',
    afterCollisionRow?.lsq_lead_id === lsqLeadIdA,
    `got=${afterCollisionRow?.lsq_lead_id}`
  );
  record(
    'TEST 2 — existing lsq_lead_stage unchanged (still OPD WIN)',
    afterCollisionRow?.lsq_lead_stage === 'OPD WIN',
    `got=${afterCollisionRow?.lsq_lead_stage}`
  );
  record(
    'TEST 2 — city still Bengaluru (collision did not overwrite)',
    afterCollisionRow?.city === 'Bengaluru',
    `got=${afterCollisionRow?.city}`
  );

  // Verify an ignore audit row was written
  const ignoreLog = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM dedup_log
      WHERE source_thread_id = $1 AND action = 'ignore' AND endpoint = 'lsq_sync'
        AND reason = 'duplicate_phone_across_lsq_leads'`,
    [manualThread.id]
  );
  record(
    'TEST 2 — dedup_log has ignore audit row',
    (ignoreLog?.n ?? 0) >= 1,
    `count=${ignoreLog?.n}`
  );

  // ===========================================================================
  // TEST 3: Passthrough — LSQ lead with no match → CREATE
  // ===========================================================================
  console.log('\n--- TEST 3: New LSQ lead passthrough ---');

  const uniquePhone = '8' + String(Date.now() + 5).slice(-9);
  const lsqLeadIdC = `phase3-leadC-${uniqueMarker}`;
  createdLsqLeadIds.push(lsqLeadIdC);

  const newLsq = makeNormalized({
    lsqLeadId: lsqLeadIdC,
    lsqProspectAutoId: `phase3-propC-${uniqueMarker}`,
    patientName: `${TEST_PREFIX}Brand New ${uniqueMarker}`,
    phone: uniquePhone,
    whatsappNumber: uniquePhone,
    city: 'Chennai',
    lsqLeadStage: 'OPD WIN',
    roundsStage: 'opd',
  });

  const upsertResult3 = await upsertLeadAsPatient(newLsq);

  record(
    'TEST 3 — upsert returned action=created',
    upsertResult3.action === 'created',
    `action=${upsertResult3.action}`
  );
  if (upsertResult3.id) createdIds.push(upsertResult3.id);
  record(
    'TEST 3 — new row has an id',
    !!upsertResult3.id,
    `id=${upsertResult3.id}`
  );

  const newRow = await queryOne<{
    lsq_lead_id: string | null;
    patient_name: string;
    phone: string | null;
  }>(
    `SELECT lsq_lead_id, patient_name, phone FROM patient_threads WHERE id = $1`,
    [upsertResult3.id]
  );
  record(
    'TEST 3 — new row has lsq_lead_id set from the incoming lead',
    newRow?.lsq_lead_id === lsqLeadIdC,
    `got=${newRow?.lsq_lead_id}`
  );

  // ===========================================================================
  // CLEANUP
  // ===========================================================================
  try {
    if (createdIds.length > 0) {
      await query(
        `DELETE FROM dedup_log WHERE source_thread_id = ANY($1::uuid[]) OR target_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM dedup_candidates WHERE new_thread_id = ANY($1::uuid[]) OR existing_thread_id = ANY($1::uuid[])`,
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
  console.log('\n=== PHASE 3 SMOKE TEST RESULTS ===');
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
  // Best-effort cleanup
  if (createdIds.length > 0) {
    try {
      await query(
        `DELETE FROM dedup_log WHERE source_thread_id = ANY($1::uuid[]) OR target_thread_id = ANY($1::uuid[])`,
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
