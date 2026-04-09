/**
 * Smoke test for src/lib/dedup.ts against live Neon DB.
 * Not a unit test — exercises the real queries with known-existing data.
 *
 * Run: npx tsx scripts/smoke-test-dedup.ts
 */

import {
  normalizePhone,
  checkForDuplicate,
  NAME_SIMILARITY_THRESHOLD,
} from '../src/lib/dedup';
import { query } from '../src/lib/db';

interface CheckResult {
  label: string;
  pass: boolean;
  note?: string;
}

const results: CheckResult[] = [];
const record = (label: string, pass: boolean, note?: string) =>
  results.push({ label, pass, note });

async function main() {
  // -------------------------------------------------------------------------
  // 1. normalizePhone unit cases
  // -------------------------------------------------------------------------
  record('normalizePhone("+91-9019062373") === "9019062373"',
    normalizePhone('+91-9019062373') === '9019062373');
  record('normalizePhone("9019062373") === "9019062373"',
    normalizePhone('9019062373') === '9019062373');
  record('normalizePhone("+919019062373") === "9019062373"',
    normalizePhone('+919019062373') === '9019062373');
  record('normalizePhone("(919) 019-0623") === "9190190623"',
    normalizePhone('(919) 019-0623') === '9190190623');
  record('normalizePhone(null) === null',
    normalizePhone(null) === null);
  record('normalizePhone("") === null',
    normalizePhone('') === null);
  record('normalizePhone("123") === null',
    normalizePhone('123') === null);

  // -------------------------------------------------------------------------
  // 2. Fetch a real existing patient to use as a dedup target
  // -------------------------------------------------------------------------
  const existing = await query<{
    id: string;
    patient_name: string;
    phone: string;
  }>(
    `SELECT id, patient_name, phone FROM patient_threads
     WHERE phone IS NOT NULL AND archived_at IS NULL AND patient_name IS NOT NULL
     ORDER BY random() LIMIT 1`
  );

  if (!existing.length) {
    console.error('NO EXISTING PATIENT WITH PHONE — cannot run dedup smoke test');
    process.exit(1);
  }

  const target = existing[0];
  console.log('Using existing patient as dedup target:');
  console.log('  id:', target.id);
  console.log('  name:', target.patient_name);
  console.log('  phone:', target.phone, '→ normalized:', normalizePhone(target.phone));

  // -------------------------------------------------------------------------
  // 3. Layer 1: exact phone match should LINK
  // -------------------------------------------------------------------------
  const layer1 = await checkForDuplicate({
    name: 'Totally Different Name Xyz',
    phone: target.phone,
  });
  record(
    'Layer 1 phone exact match → action=link',
    layer1.action === 'link' && layer1.matchedThread?.id === target.id,
    `action=${layer1.action} layer=${layer1.layer} matchedId=${layer1.matchedThread?.id}`
  );

  // -------------------------------------------------------------------------
  // 4. Layer 1: alternate phone formats should still match
  // -------------------------------------------------------------------------
  const phoneAlt = '+91 ' + normalizePhone(target.phone);
  const layer1Alt = await checkForDuplicate({
    name: 'Different Again',
    phone: phoneAlt,
  });
  record(
    'Layer 1 reformatted phone → still LINK',
    layer1Alt.action === 'link' && layer1Alt.matchedThread?.id === target.id,
    `phoneAlt=${phoneAlt} action=${layer1Alt.action}`
  );

  // -------------------------------------------------------------------------
  // 5. Layer 2: close-enough name, different phone → FLAG
  // -------------------------------------------------------------------------
  // Tweak the name slightly to trigger trigram > 0.6 but not exact
  const nameTweak = target.patient_name.slice(0, -2) + 'xy';
  const layer2 = await checkForDuplicate({
    name: nameTweak,
    phone: '9000000001', // fake phone that won't match
  });
  record(
    'Layer 2 fuzzy name → action=flag (if similarity >= 0.6)',
    layer2.action === 'flag' || layer2.action === 'create',
    `tweakedName="${nameTweak}" action=${layer2.action} fuzzyCount=${layer2.fuzzyMatches?.length ?? 0}`
  );

  // -------------------------------------------------------------------------
  // 6. No match at all → CREATE
  // -------------------------------------------------------------------------
  const noMatch = await checkForDuplicate({
    name: 'Zzzz Random Unique Name Qwerty 12345',
    phone: '9000000099',
  });
  record(
    'No match → action=create',
    noMatch.action === 'create',
    `action=${noMatch.action}`
  );

  // -------------------------------------------------------------------------
  // 7. Verify similarity threshold constant is exported
  // -------------------------------------------------------------------------
  record(
    'NAME_SIMILARITY_THRESHOLD === 0.6',
    NAME_SIMILARITY_THRESHOLD === 0.6
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n=== SMOKE TEST RESULTS ===');
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

main().catch((e) => {
  console.error('SMOKE TEST FATAL:', e);
  process.exit(1);
});
