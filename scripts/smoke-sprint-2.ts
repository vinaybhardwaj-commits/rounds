/**
 * scripts/smoke-sprint-2.ts
 *
 * Read-only smoke test for Sprint 2 + early-Sprint-3 schema. Verifies:
 *   S2-1. departments.hospital_id column exists + every row has it set
 *   S2-2. sprint2-departments-hospital-id migration recorded
 *   S2-3. pac_events.scheduled_at does NOT exist (was latent bug)
 *   S2-4. condition_cards has note / completed_at / completed_by (renamed)
 *   S2-5. equipment_requests has item_type / item_label / vendor_name (not name/vendor)
 *   S2-6. equipment_requests.status CHECK covers the 5-step chain
 *   S2-7. equipment_requests.item_type CHECK covers 5 values
 *   S2-8. departments still has 19 rows (frozen)
 *   S2-9. pac_condition_library still has 12 rows (frozen)
 *  S2-10. hospitals still has 3 rows (frozen)
 *  S2-11. All surgical_cases have hospital_id = EHRC (single-hospital era)
 *  S2-12. Sprint 3 tasks table exists
 *  S2-13. tasks.status CHECK covers pending/in_progress/done/cancelled
 *  S2-14. tasks.source CHECK covers manual/auto
 *  S2-15. pre_op_verifications has no unique constraint on case_id (idempotency
 *         enforced at endpoint, not DB)
 *
 * Usage:
 *   POSTGRES_URL="..." pnpm tsx scripts/smoke-sprint-2.ts
 *
 * Exit 0 = all pass, 1 = any fail.
 *
 * Author: Sprint 3 Day 11.5, 24 April 2026.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from 'fs';
import * as pathMod from 'path';
(() => {
  const envPath = pathMod.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[key]) process.env[key] = v;
  }
})();

import { neon } from '@neondatabase/serverless';

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error('POSTGRES_URL not set');
  process.exit(2);
}
const sql = neon(url);

interface Check { id: string; ok: boolean; detail: string; ms: number }
const checks: Check[] = [];

async function run(id: string, fn: () => Promise<string | null>): Promise<void> {
  const t0 = Date.now();
  try {
    const err = await fn();
    checks.push({ id, ok: err === null, detail: err ?? 'ok', ms: Date.now() - t0 });
  } catch (e: any) {
    checks.push({ id, ok: false, detail: `exception: ${e.message}`, ms: Date.now() - t0 });
  }
}

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sprint 2 + early S3 — smoke test                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  const target = new URL(url.replace('postgresql://', 'https://')).hostname;
  console.log(`Target:   ${target}\n`);

  await run('S2-1.departments.hospital_id', async () => {
    const r: any = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'hospital_id'`;
    if (r.length !== 1) return 'departments.hospital_id column missing';
    const nulls: any = await sql`SELECT COUNT(*)::int AS n FROM departments WHERE hospital_id IS NULL`;
    if (nulls[0].n !== 0) return `${nulls[0].n} departments with NULL hospital_id`;
    return null;
  });

  await run('S2-2.migration.sprint2-departments-hospital-id', async () => {
    const r: any = await sql`SELECT name FROM _migrations WHERE name = 'sprint2-departments-hospital-id'`;
    return r.length === 1 ? null : 'migration row missing';
  });

  await run('S2-3.pac_events.no-scheduled_at', async () => {
    const r: any = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'pac_events' AND column_name = 'scheduled_at'`;
    return r.length === 0 ? null : 'pac_events.scheduled_at should NOT exist';
  });

  await run('S2-4.condition_cards.columns', async () => {
    const r: any = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'condition_cards'`;
    const names = new Set((r as any[]).map((x) => x.column_name));
    for (const need of ['note', 'completed_at', 'completed_by']) {
      if (!names.has(need)) return `condition_cards.${need} missing`;
    }
    return null;
  });

  await run('S2-5.equipment_requests.columns', async () => {
    const r: any = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'equipment_requests'`;
    const names = new Set((r as any[]).map((x) => x.column_name));
    for (const need of ['item_type', 'item_label', 'vendor_name', 'quantity', 'auto_verified']) {
      if (!names.has(need)) return `equipment_requests.${need} missing`;
    }
    return null;
  });

  await run('S2-6.equipment_requests.status_check', async () => {
    const r: any = await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'equipment_requests' AND c.conname LIKE '%status%'`;
    const def = (r[0] as any)?.def ?? '';
    for (const v of ['requested', 'vendor_confirmed', 'in_transit', 'delivered', 'verified_ready']) {
      if (!def.includes(v)) return `status CHECK missing value ${v}`;
    }
    return null;
  });

  await run('S2-7.equipment_requests.item_type_check', async () => {
    const r: any = await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'equipment_requests' AND c.conname LIKE '%item_type%'`;
    const def = (r[0] as any)?.def ?? '';
    for (const v of ['specialty', 'rental', 'implant', 'blood', 'imaging']) {
      if (!def.includes(v)) return `item_type CHECK missing value ${v}`;
    }
    return null;
  });

  await run('S2-8.departments.count=19', async () => {
    const r: any = await sql`SELECT COUNT(*)::int AS n FROM departments`;
    return r[0].n === 19 ? null : `departments count = ${r[0].n}, expected 19`;
  });

  await run('S2-9.pac_condition_library.count=12', async () => {
    const r: any = await sql`SELECT COUNT(*)::int AS n FROM pac_condition_library WHERE is_active = true`;
    return r[0].n === 12 ? null : `library active count = ${r[0].n}, expected 12`;
  });

  await run('S2-10.hospitals.count=3', async () => {
    const r: any = await sql`SELECT COUNT(*)::int AS n FROM hospitals`;
    return r[0].n === 3 ? null : `hospitals count = ${r[0].n}, expected 3`;
  });

  await run('S2-11.surgical_cases.all-ehrc', async () => {
    const r: any = await sql`SELECT COUNT(*)::int AS n FROM surgical_cases sc JOIN hospitals h ON h.id = sc.hospital_id WHERE h.slug != 'ehrc'`;
    return r[0].n === 0 ? null : `${r[0].n} surgical_cases have non-EHRC hospital`;
  });

  await run('S3-12.tasks-table-exists', async () => {
    const r: any = await sql`SELECT to_regclass('public.tasks') AS t`;
    return r[0].t ? null : 'tasks table does not exist';
  });

  await run('S3-13.tasks.status_check', async () => {
    const r: any = await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'tasks' AND c.conname LIKE '%status%'`;
    const def = (r[0] as any)?.def ?? '';
    for (const v of ['pending', 'in_progress', 'done', 'cancelled']) {
      if (!def.includes(v)) return `tasks.status CHECK missing value ${v}`;
    }
    return null;
  });

  await run('S3-14.tasks.source_check', async () => {
    const r: any = await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'tasks' AND c.conname LIKE '%source%'`;
    const def = (r[0] as any)?.def ?? '';
    for (const v of ['manual', 'auto']) {
      if (!def.includes(v)) return `tasks.source CHECK missing value ${v}`;
    }
    return null;
  });

  await run('S3-15.pre_op_verifications.no-unique-case_id', async () => {
    // Endpoint-level idempotency — we don't expect a unique constraint on case_id.
    const r: any = await sql`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'pre_op_verifications' AND c.contype = 'u'
    `;
    const hasCase = (r as any[]).some((row) => (row.def as string).includes('(case_id)'));
    return hasCase ? 'unique(case_id) exists — endpoint idempotency check is redundant' : null;
  });

  let pass = 0, fail = 0, totalMs = 0;
  for (const c of checks) {
    const mark = c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${mark} [${c.id}] ${c.detail} (${c.ms}ms)`);
    totalMs += c.ms;
    if (c.ok) pass++; else fail++;
  }
  console.log('\n──────────────────────────────────────────────────────────────────');
  console.log(`Result: ${pass} pass · ${fail} fail   (${totalMs}ms)`);
  console.log('──────────────────────────────────────────────────────────────────\n');
  process.exit(fail > 0 ? 1 : 0);
})();
