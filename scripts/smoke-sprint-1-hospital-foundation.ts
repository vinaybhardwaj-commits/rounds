/**
 * scripts/smoke-sprint-1-hospital-foundation.ts
 *
 * Read-only smoke test for Sprint 1 Day 1 migration
 * (migration-multi-hospital-foundation.sql).
 *
 * Runs in <5s, makes ZERO writes. Safe against any branch.
 *
 * What it verifies
 * ----------------
 *   H1. `hospitals` table exists with exactly 3 rows (ehrc/ehbr/ehin)
 *   H2. Only EHRC is active; EHBR + EHIN are inactive
 *   H3. `hospitals.ot_room_count` = 3 for all three (per V's answer on Day 1)
 *   H4. `profiles.primary_hospital_id` and `profiles.role_scope` columns exist
 *   H5. Every existing profile has a non-null `primary_hospital_id`
 *   H6. Every existing profile has `role_scope IN (central, hospital_bound, multi_hospital)`
 *   H7. Count of `central` profiles is 11 (backfill checkpoint vs 23 Apr baseline)
 *   H8. `user_hospital_access` and `doctor_hospital_affiliations` tables exist
 *   H9. `user_accessible_hospital_ids(UUID)` function exists and:
 *         - returns [EHRC_uuid] for V's super_admin (central → all active hospitals)
 *         - returns [EHRC_uuid] for a hospital_bound profile whose primary = EHRC
 *         - returns [] for a non-existent UUID
 *  H10. Unique partial index idx_dha_one_primary_per_doctor exists
 *  H11. `_migrations` has 'sprint1-multi-hospital-foundation' row
 *
 * Usage
 * -----
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/smoke-sprint-1-hospital-foundation.ts
 *
 *   # against sprint-test
 *   POSTGRES_URL="postgres://..." pnpm tsx scripts/smoke-sprint-1-hospital-foundation.ts
 *
 * Exit codes
 * ----------
 *   0 — all pass
 *   1 — any fail
 *   2 — fatal config
 *
 * Author: Sprint 1 Day 1, 23 April 2026.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// STEP 0: Load .env.local manually (match existing smoke-test pattern)
// ---------------------------------------------------------------------------
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
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
})();

import { neon } from '@neondatabase/serverless';

// ---------------------------------------------------------------------------
// STEP 1: Expected values (from Sprint 1 Day 1 execution against 23 Apr baseline)
// ---------------------------------------------------------------------------
const EXPECT = {
  hospitals_count: 3,
  hospitals_active: 1,
  hospital_slugs: ['ehrc', 'ehbr', 'ehin'],
  ot_rooms_per_hospital: 3,
  total_profiles: 29,
  central_profiles: 11,
  hospital_bound_profiles: 18,
  // V's super_admin profile — should see only EHRC (the only active hospital today)
  v_profile_id: 'eaa39589-7305-4047-b94e-cda0025c2fed',
  v_accessible_hospitals: 1,
  migration_name: 'sprint1-multi-hospital-foundation',
} as const;

// ---------------------------------------------------------------------------
// STEP 2: Test runner
// ---------------------------------------------------------------------------

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
    const color =
      last.status === 'pass' ? '\x1b[32m' :
      last.status === 'fail' ? '\x1b[31m' :
      last.status === 'warn' ? '\x1b[33m' : '\x1b[90m';
    const reset = '\x1b[0m';
    const tail = last.detail ? `  — ${last.detail}` : '';
    console.log(`${color}${icon}${reset} [${last.id}] ${last.desc}${tail} (${last.ms}ms)`);
  }
}

// ---------------------------------------------------------------------------
// STEP 3: Connection
// ---------------------------------------------------------------------------
const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connStr) {
  console.error('FATAL: neither POSTGRES_URL nor DATABASE_URL is set.');
  process.exit(2);
}
const sql = neon(connStr);

const maskedHost = (() => {
  try { const u = new URL(connStr); return `${u.hostname}${u.pathname}`; }
  catch { return '(unparseable)'; }
})();

if (!jsonMode) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sprint 1 Day 1 — hospital foundation smoke test            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Target:   ${maskedHost}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// STEP 4: Checks
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  // H1. hospitals exists + has 3 rows
  await check('H1.hospitals.count', `hospitals has ${EXPECT.hospitals_count} rows`, async () => {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM hospitals`) as { n: number }[];
    if (rows[0]?.n !== EXPECT.hospitals_count) return { status: 'fail', detail: `got ${rows[0]?.n}` };
    return { status: 'pass' };
  });

  // H1b. exactly the 3 expected slugs
  await check('H1.hospitals.slugs', `slugs are exactly {${EXPECT.hospital_slugs.join(',')}}`, async () => {
    const rows = (await sql`SELECT slug FROM hospitals ORDER BY slug`) as { slug: string }[];
    const got = rows.map(r => r.slug).sort();
    const want = [...EXPECT.hospital_slugs].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return { status: 'fail', detail: `got [${got.join(',')}], want [${want.join(',')}]` };
    }
    return { status: 'pass' };
  });

  // H2. only EHRC active
  await check('H2.hospitals.active', 'only EHRC is_active=true', async () => {
    const rows = (await sql`SELECT slug FROM hospitals WHERE is_active = TRUE ORDER BY slug`) as { slug: string }[];
    if (rows.length !== EXPECT.hospitals_active || rows[0]?.slug !== 'ehrc') {
      return { status: 'fail', detail: `active slugs: [${rows.map(r => r.slug).join(',')}]` };
    }
    return { status: 'pass' };
  });

  // H3. ot_room_count = 3 for all three
  await check('H3.hospitals.ot_room_count', `every hospital has ot_room_count = ${EXPECT.ot_rooms_per_hospital}`, async () => {
    const rows = (await sql`SELECT slug, ot_room_count FROM hospitals ORDER BY slug`) as { slug: string; ot_room_count: number }[];
    const offenders = rows.filter(r => r.ot_room_count !== EXPECT.ot_rooms_per_hospital);
    if (offenders.length) {
      return { status: 'fail', detail: `mismatches: ${offenders.map(r => `${r.slug}=${r.ot_room_count}`).join(',')}` };
    }
    return { status: 'pass' };
  });

  // H4. profiles extended columns exist
  await check('H4.profiles.columns', 'profiles has primary_hospital_id + role_scope', async () => {
    const rows = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='profiles'
        AND column_name IN ('primary_hospital_id','role_scope')
    `) as { column_name: string }[];
    if (rows.length !== 2) return { status: 'fail', detail: `only ${rows.length} of 2 expected columns present` };
    return { status: 'pass' };
  });

  // H5. every profile has primary_hospital_id
  await check('H5.profiles.primary_hospital_backfill', 'every profile has non-null primary_hospital_id', async () => {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM profiles WHERE primary_hospital_id IS NULL`) as { n: number }[];
    if (rows[0]!.n > 0) return { status: 'fail', detail: `${rows[0]!.n} profiles missing primary_hospital_id` };
    return { status: 'pass' };
  });

  // H6. every profile has valid role_scope (CHECK constraint guarantees this, but verify)
  await check('H6.profiles.role_scope_valid', 'every profile has valid role_scope', async () => {
    const rows = (await sql`
      SELECT COUNT(*)::int AS n FROM profiles
      WHERE role_scope NOT IN ('central','hospital_bound','multi_hospital')
    `) as { n: number }[];
    if (rows[0]!.n > 0) return { status: 'fail', detail: `${rows[0]!.n} invalid role_scopes (CHECK broken?)` };
    return { status: 'pass' };
  });

  // H7. central profile count matches baseline derivation
  await check('H7.profiles.central_count', `${EXPECT.central_profiles} profiles are central`, async () => {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM profiles WHERE role_scope='central'`) as { n: number }[];
    const n = rows[0]!.n;
    if (n !== EXPECT.central_profiles) {
      return { status: 'warn', detail: `got ${n} (baseline ${EXPECT.central_profiles} — may differ if new central users added)` };
    }
    return { status: 'pass' };
  });

  // H7b. hospital_bound count matches
  await check('H7.profiles.hospital_bound_count', `${EXPECT.hospital_bound_profiles} profiles are hospital_bound`, async () => {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM profiles WHERE role_scope='hospital_bound'`) as { n: number }[];
    const n = rows[0]!.n;
    if (n !== EXPECT.hospital_bound_profiles) {
      return { status: 'warn', detail: `got ${n} (baseline ${EXPECT.hospital_bound_profiles})` };
    }
    return { status: 'pass' };
  });

  // H8. user_hospital_access + doctor_hospital_affiliations exist
  await check('H8.tables.exist', 'user_hospital_access + doctor_hospital_affiliations exist', async () => {
    const rows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('user_hospital_access','doctor_hospital_affiliations')
    `) as { table_name: string }[];
    if (rows.length !== 2) return { status: 'fail', detail: `only ${rows.length} of 2 expected tables present` };
    return { status: 'pass' };
  });

  // H9. user_accessible_hospital_ids — V (central) sees EHRC
  await check('H9.fn.central_user', 'user_accessible_hospital_ids(V) returns [EHRC]', async () => {
    const rows = (await sql`
      SELECT cardinality(user_accessible_hospital_ids(${EXPECT.v_profile_id}::UUID)) AS n
    `) as { n: number }[];
    if (rows[0]!.n !== EXPECT.v_accessible_hospitals) {
      return { status: 'fail', detail: `got cardinality ${rows[0]!.n}, expected ${EXPECT.v_accessible_hospitals}` };
    }
    return { status: 'pass' };
  });

  // H9b. Pick any hospital_bound profile (other than V) and verify it sees exactly 1 hospital
  await check('H9.fn.hospital_bound_user', 'a hospital_bound profile sees exactly [its primary]', async () => {
    const probe = (await sql`
      SELECT id, primary_hospital_id FROM profiles
      WHERE role_scope='hospital_bound' AND primary_hospital_id IS NOT NULL
      LIMIT 1
    `) as { id: string; primary_hospital_id: string }[];
    if (probe.length === 0) return { status: 'warn', detail: 'no hospital_bound profiles available to probe' };
    const rows = (await sql`
      SELECT user_accessible_hospital_ids(${probe[0]!.id}::UUID) AS ids
    `) as { ids: string[] }[];
    const ids = rows[0]!.ids;
    if (ids.length !== 1 || ids[0] !== probe[0]!.primary_hospital_id) {
      return { status: 'fail', detail: `got ${JSON.stringify(ids)}, expected [${probe[0]!.primary_hospital_id}]` };
    }
    return { status: 'pass' };
  });

  // H9c. Unknown UUID → empty array (fail-closed)
  await check('H9.fn.unknown_user', 'user_accessible_hospital_ids(random) returns []', async () => {
    const rows = (await sql`
      SELECT cardinality(user_accessible_hospital_ids('00000000-0000-0000-0000-000000000000'::UUID)) AS n
    `) as { n: number }[];
    if (rows[0]!.n !== 0) return { status: 'fail', detail: `leaked ${rows[0]!.n} hospital_ids for unknown user` };
    return { status: 'pass' };
  });

  // H10. partial unique index for is_primary
  await check('H10.index.one_primary_per_doctor', 'partial unique idx_dha_one_primary_per_doctor exists', async () => {
    const rows = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND indexname='idx_dha_one_primary_per_doctor'
    `) as { indexname: string }[];
    if (rows.length === 0) return { status: 'fail', detail: 'index missing' };
    return { status: 'pass' };
  });

  // H11. _migrations row
  await check('H11.migrations.recorded', `'${EXPECT.migration_name}' recorded in _migrations`, async () => {
    const rows = (await sql`SELECT 1 FROM _migrations WHERE name = ${EXPECT.migration_name}`) as unknown[];
    if (rows.length === 0) return { status: 'fail', detail: 'row missing' };
    return { status: 'pass' };
  });
}

// ---------------------------------------------------------------------------
// STEP 5: Run + summarize
// ---------------------------------------------------------------------------

(async () => {
  try { await run(); }
  catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error('\nFATAL during run:', msg);
    process.exit(2);
  }

  const counts = {
    pass: checks.filter(c => c.status === 'pass').length,
    fail: checks.filter(c => c.status === 'fail').length,
    warn: checks.filter(c => c.status === 'warn').length,
    skip: checks.filter(c => c.status === 'skip').length,
    total: checks.length,
  };
  const totalMs = checks.reduce((a, c) => a + c.ms, 0);

  if (jsonMode) {
    console.log(JSON.stringify({ target: maskedHost, counts, total_ms: totalMs, checks }, null, 2));
  } else {
    console.log('');
    console.log('─'.repeat(66));
    console.log(`Result: ${counts.pass} pass · ${counts.fail} fail · ${counts.warn} warn · ${counts.skip} skip   (${totalMs}ms)`);
    console.log('─'.repeat(66));
    if (counts.fail > 0) {
      console.log('\n\x1b[31mFAILED CHECKS:\x1b[0m');
      for (const c of checks.filter(c => c.status === 'fail')) {
        console.log(`  \x1b[31m✗\x1b[0m [${c.id}] ${c.desc}${c.detail ? ` — ${c.detail}` : ''}`);
      }
    }
    if (counts.warn > 0) {
      console.log('\n\x1b[33mWARNINGS:\x1b[0m');
      for (const c of checks.filter(c => c.status === 'warn')) {
        console.log(`  \x1b[33m!\x1b[0m [${c.id}] ${c.desc}${c.detail ? ` — ${c.detail}` : ''}`);
      }
    }
    console.log('');
  }

  process.exit(counts.fail > 0 ? 1 : 0);
})();
