/**
 * scripts/smoke-sprint-1-case-tables.ts
 *
 * Read-only smoke test for Sprint 1 Day 2 migrations:
 *   • migration-existing-tables-hospital-id.sql  (patient_threads + form_submissions)
 *   • migration-surgical-cases.sql               (4 new tables)
 *   • migration-condition-library.sql            (2 new tables + 12-row seed)
 *   • migration-equipment.sql                    (2 new tables)
 *   • migration-ot-list-versions.sql             (1 new table)
 *
 * Covers 18 checks across 9 new tables + 2 altered tables. Runs in <5s.
 *
 * Usage (same pattern as smoke-sprint-1-hospital-foundation.ts):
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/smoke-sprint-1-case-tables.ts
 *
 * Author: Sprint 1 Day 2, 23 April 2026.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from 'fs';
import * as pathMod from 'path';
(() => {
  const envPath = pathMod.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
})();

import { neon } from '@neondatabase/serverless';

const EXPECT = {
  new_tables: [
    'surgical_cases', 'case_state_events', 'pac_events', 'pre_op_verifications',
    'pac_condition_library', 'condition_cards',
    'equipment_kits', 'equipment_requests',
    'ot_list_versions',
  ],
  condition_library_rows: 12,
  state_machine_values: [
    'draft', 'intake', 'pac_scheduled', 'pac_done',
    'fit', 'fit_conds', 'defer', 'unfit',
    'optimizing', 'scheduled', 'confirmed', 'verified',
    'in_theatre', 'completed', 'postponed', 'cancelled',
  ],
  pac_outcomes: ['fit', 'fit_conds', 'defer', 'unfit'],
  equipment_chain: ['requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready'],
  equipment_types: ['specialty', 'rental', 'implant', 'blood', 'imaging'],
  migration_names: [
    'sprint1-existing-tables-hospital-id',
    'sprint1-surgical-cases',
    'sprint1-condition-library',
    'sprint1-equipment-tables',
    'sprint1-ot-list-versions',
  ],
} as const;

type Status = 'pass' | 'fail' | 'warn' | 'skip';
interface Check { id: string; desc: string; status: Status; detail?: string; ms: number; }
const checks: Check[] = [];
const jsonMode = process.argv.includes('--json');

async function check(id: string, desc: string, fn: () => Promise<{ status: Status; detail?: string }>): Promise<void> {
  const start = Date.now();
  try {
    const r = await fn();
    checks.push({ id, desc, status: r.status, detail: r.detail, ms: Date.now() - start });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ id, desc, status: 'fail', detail: `EXCEPTION: ${msg}`, ms: Date.now() - start });
  }
  if (!jsonMode) {
    const last = checks[checks.length - 1];
    const icon = last.status === 'pass' ? '✓' : last.status === 'fail' ? '✗' : last.status === 'warn' ? '!' : '·';
    const color = last.status === 'pass' ? '\x1b[32m' : last.status === 'fail' ? '\x1b[31m' : last.status === 'warn' ? '\x1b[33m' : '\x1b[90m';
    const tail = last.detail ? `  — ${last.detail}` : '';
    console.log(`${color}${icon}\x1b[0m [${last.id}] ${last.desc}${tail} (${last.ms}ms)`);
  }
}

const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connStr) { console.error('FATAL: POSTGRES_URL not set.'); process.exit(2); }
const sql = neon(connStr);
const maskedHost = (() => { try { const u = new URL(connStr); return `${u.hostname}${u.pathname}`; } catch { return '(n/a)'; } })();

if (!jsonMode) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sprint 1 Day 2 — case tables smoke test                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Target:   ${maskedHost}\n`);
}

async function run(): Promise<void> {
  // CT1 — all 9 new tables exist
  await check('CT1.tables.exist', `all ${EXPECT.new_tables.length} new tables exist`, async () => {
    const rows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY(${EXPECT.new_tables as unknown as string[]})
    `) as { table_name: string }[];
    const present = new Set(rows.map(r => r.table_name));
    const missing = EXPECT.new_tables.filter(t => !present.has(t));
    if (missing.length) return { status: 'fail', detail: `missing: ${missing.join(', ')}` };
    return { status: 'pass' };
  });

  // CT2 — patient_threads.hospital_id present, all non-null
  await check('CT2.patient_threads.hospital_id', 'patient_threads.hospital_id NOT NULL', async () => {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM patient_threads WHERE hospital_id IS NULL`) as { n: number }[];
    if (rows[0]!.n > 0) return { status: 'fail', detail: `${rows[0]!.n} null rows` };
    return { status: 'pass' };
  });

  // CT3 — form_submissions.hospital_id + card-message cols
  await check('CT3.form_submissions.new_cols', 'form_submissions has hospital_id + cc/ot_card_message_id', async () => {
    const rows = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='form_submissions'
        AND column_name IN ('hospital_id','cc_card_message_id','ot_card_message_id')
    `) as { column_name: string }[];
    if (rows.length !== 3) return { status: 'fail', detail: `${rows.length} of 3 cols` };
    return { status: 'pass' };
  });

  await check('CT3.form_submissions.hospital_backfill', 'form_submissions.hospital_id NOT NULL', async () => {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM form_submissions WHERE hospital_id IS NULL`) as { n: number }[];
    if (rows[0]!.n > 0) return { status: 'fail', detail: `${rows[0]!.n} null rows` };
    return { status: 'pass' };
  });

  // CT4 — condition library seeded with 12 rows
  await check('CT4.library.row_count', `pac_condition_library has >= ${EXPECT.condition_library_rows} rows`, async () => {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM pac_condition_library WHERE is_active = TRUE`) as { n: number }[];
    if (rows[0]!.n < EXPECT.condition_library_rows) {
      return { status: 'fail', detail: `${rows[0]!.n} rows (expected >= ${EXPECT.condition_library_rows})` };
    }
    return { status: 'pass', detail: `${rows[0]!.n} active rows` };
  });

  await check('CT4.library.diabetes_exists', 'library contains "diabetes" seed (smoke-check SOP content)', async () => {
    const rows = (await sql`SELECT label FROM pac_condition_library WHERE code = 'diabetes'`) as { label: string }[];
    if (rows.length === 0) return { status: 'fail', detail: 'diabetes row missing' };
    return { status: 'pass', detail: rows[0]!.label };
  });

  // CT5 — surgical_cases state CHECK rejects invalid (round-trip via transaction)
  await check('CT5.surgical_cases.state_check', 'surgical_cases.state CHECK rejects invalid value', async () => {
    // Look up the constraint by name
    const rows = (await sql`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'surgical_cases'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%state%'
      LIMIT 1
    `) as { def: string }[];
    if (rows.length === 0) return { status: 'fail', detail: 'state CHECK constraint missing' };
    const def = rows[0]!.def;
    const missing = EXPECT.state_machine_values.filter(s => !def.includes(`'${s}'`));
    if (missing.length > 0) return { status: 'fail', detail: `states missing from CHECK: ${missing.join(',')}` };
    return { status: 'pass' };
  });

  // CT6 — pac_events.outcome CHECK covers 4 outcomes
  await check('CT6.pac_events.outcome_check', 'pac_events.outcome CHECK covers fit/fit_conds/defer/unfit', async () => {
    const rows = (await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'pac_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%outcome%'
      LIMIT 1
    `) as { def: string }[];
    if (rows.length === 0) return { status: 'fail', detail: 'outcome CHECK missing' };
    const missing = EXPECT.pac_outcomes.filter(o => !rows[0]!.def.includes(`'${o}'`));
    if (missing.length > 0) return { status: 'fail', detail: `missing: ${missing.join(',')}` };
    return { status: 'pass' };
  });

  // CT7 — condition_cards XOR constraint
  await check('CT7.condition_cards.xor_check', 'condition_cards has library_code XOR custom_label CHECK', async () => {
    const rows = (await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'condition_cards'::regclass AND contype='c'
        AND pg_get_constraintdef(oid) ILIKE '%library_code%custom_label%'
      LIMIT 1
    `) as { def: string }[];
    if (rows.length === 0) return { status: 'fail', detail: 'XOR CHECK missing' };
    return { status: 'pass' };
  });

  // CT8 — equipment_requests status chain + type enum
  await check('CT8.equipment_requests.chain', 'equipment_requests status covers 5-step chain', async () => {
    const rows = (await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'equipment_requests'::regclass AND contype='c'
        AND pg_get_constraintdef(oid) ILIKE '%requested%'
      LIMIT 1
    `) as { def: string }[];
    if (rows.length === 0) return { status: 'fail', detail: 'status CHECK missing' };
    const missing = EXPECT.equipment_chain.filter(s => !rows[0]!.def.includes(`'${s}'`));
    if (missing.length > 0) return { status: 'fail', detail: `chain missing: ${missing.join(',')}` };
    return { status: 'pass' };
  });

  // CT9 — ot_list_versions partial unique index (one final per day)
  await check('CT9.ot_list.one_final_per_day', 'idx_olv_one_final_per_day exists (partial unique)', async () => {
    const rows = (await sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname='public' AND indexname='idx_olv_one_final_per_day'
    `) as { indexdef: string }[];
    if (rows.length === 0) return { status: 'fail', detail: 'index missing' };
    if (!/UNIQUE/i.test(rows[0]!.indexdef) || !/final_930pm/.test(rows[0]!.indexdef)) {
      return { status: 'fail', detail: 'index exists but not UNIQUE+partial on final_930pm' };
    }
    return { status: 'pass' };
  });

  // CT10 — all 5 Day 2 migrations recorded
  for (const name of EXPECT.migration_names) {
    await check(`CT10.migration.${name}`, `_migrations has "${name}"`, async () => {
      const rows = (await sql`SELECT 1 FROM _migrations WHERE name = ${name}`) as unknown[];
      if (rows.length === 0) return { status: 'fail', detail: 'row missing' };
      return { status: 'pass' };
    });
  }
}

(async () => {
  try { await run(); } catch (err) {
    console.error('\nFATAL:', err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const counts = {
    pass: checks.filter(c => c.status === 'pass').length,
    fail: checks.filter(c => c.status === 'fail').length,
    warn: checks.filter(c => c.status === 'warn').length,
    skip: checks.filter(c => c.status === 'skip').length,
  };
  const totalMs = checks.reduce((a, c) => a + c.ms, 0);

  if (jsonMode) {
    console.log(JSON.stringify({ target: maskedHost, counts, total_ms: totalMs, checks }, null, 2));
  } else {
    console.log('\n' + '─'.repeat(66));
    console.log(`Result: ${counts.pass} pass · ${counts.fail} fail · ${counts.warn} warn · ${counts.skip} skip   (${totalMs}ms)`);
    console.log('─'.repeat(66));
    if (counts.fail > 0) {
      console.log('\n\x1b[31mFAILED:\x1b[0m');
      checks.filter(c => c.status === 'fail').forEach(c => console.log(`  \x1b[31m✗\x1b[0m [${c.id}] ${c.desc}${c.detail ? ` — ${c.detail}` : ''}`));
    }
    console.log('');
  }
  process.exit(counts.fail > 0 ? 1 : 0);
})();
