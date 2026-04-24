/**
 * scripts/smoke-sprint-3.ts
 *
 * Read-only smoke test for Sprint 3 schema + state machine. Verifies:
 *   S3-1.  tasks table has source CHECK = manual|auto
 *   S3-2.  tasks idx_tasks_auto_dedup partial unique exists
 *   S3-3.  pre_op_verifications table populated by verify endpoint shape
 *   S3-4.  ot_list_versions partial unique idx_olv_one_final_per_day exists
 *   S3-5.  ot_list_versions version_type CHECK has provisional_6pm + final_930pm
 *   S3-6.  case_state_events covers all 16 state values via from_state/to_state
 *          (we don't validate every CHECK; just confirm the table exists + has
 *          rows ≥ 0 — historical events accumulate as the case model gets used)
 *   S3-7.  surgical_cases.state CHECK covers all 16 lifecycle states
 *   S3-8.  user_accessible_hospital_ids() function exists (carried from Sprint 1)
 *   S3-9.  hospitals row count = 3 (frozen) + EHRC active
 *   S3-10. _migrations has both sprint2-departments-hospital-id + sprint3-tasks-table
 *
 * Usage: POSTGRES_URL=... pnpm tsx scripts/smoke-sprint-3.ts
 *
 * Author: Sprint 3 Day 15, 24 April 2026.
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
if (!url) { console.error('POSTGRES_URL not set'); process.exit(2); }
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
  console.log('║  Sprint 3 — schema + state machine smoke                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  const target = new URL(url.replace('postgresql://', 'https://')).hostname;
  console.log(`Target:   ${target}\n`);

  await run('S3-1.tasks.source_check', async () => {
    const r: any = await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'tasks' AND c.conname LIKE '%source%'`;
    const def = (r[0] as any)?.def ?? '';
    if (!def.includes('manual') || !def.includes('auto')) return 'tasks.source CHECK missing manual/auto';
    return null;
  });

  await run('S3-2.tasks.idx_tasks_auto_dedup', async () => {
    const r: any = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'tasks' AND indexname = 'idx_tasks_auto_dedup'`;
    return r.length === 1 ? null : 'idx_tasks_auto_dedup partial unique missing';
  });

  await run('S3-3.pre_op_verifications.shape', async () => {
    const r: any = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'pre_op_verifications'`;
    const names = new Set((r as any[]).map((x) => x.column_name));
    for (const need of ['case_id', 'rmo_profile_id', 'verified_at', 'checklist', 'issues_flagged']) {
      if (!names.has(need)) return `pre_op_verifications.${need} missing`;
    }
    return null;
  });

  await run('S3-4.ot_list_versions.idx_olv_one_final_per_day', async () => {
    const r: any = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'ot_list_versions' AND indexname = 'idx_olv_one_final_per_day'`;
    return r.length === 1 ? null : 'idx_olv_one_final_per_day missing';
  });

  await run('S3-5.ot_list_versions.version_type_check', async () => {
    const r: any = await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'ot_list_versions' AND c.conname LIKE '%version_type%'`;
    const def = (r[0] as any)?.def ?? '';
    for (const v of ['provisional_6pm', 'final_930pm']) {
      if (!def.includes(v)) return `version_type CHECK missing ${v}`;
    }
    return null;
  });

  await run('S3-6.case_state_events.exists', async () => {
    const r: any = await sql`SELECT to_regclass('public.case_state_events') AS t`;
    return r[0].t ? null : 'case_state_events table missing';
  });

  await run('S3-7.surgical_cases.state_check_16_values', async () => {
    const r: any = await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'surgical_cases' AND c.conname LIKE '%state%'`;
    const def = (r[0] as any)?.def ?? '';
    const expect = ['draft','intake','pac_scheduled','pac_done','fit','fit_conds','defer','unfit','optimizing','scheduled','confirmed','verified','in_theatre','completed','postponed','cancelled'];
    for (const v of expect) {
      if (!def.includes(`'${v}'`)) return `surgical_cases.state CHECK missing ${v}`;
    }
    return null;
  });

  await run('S3-8.user_accessible_hospital_ids.fn_exists', async () => {
    const r: any = await sql`SELECT proname FROM pg_proc WHERE proname = 'user_accessible_hospital_ids'`;
    return r.length >= 1 ? null : 'user_accessible_hospital_ids() function missing';
  });

  await run('S3-9.hospitals.frozen_baseline', async () => {
    const r: any = await sql`SELECT slug, is_active FROM hospitals ORDER BY slug`;
    if (r.length !== 3) return `hospitals count = ${r.length}, expected 3`;
    const ehrc = (r as any[]).find((h) => h.slug === 'ehrc');
    if (!ehrc?.is_active) return 'EHRC must be active';
    return null;
  });

  await run('S3-10.migrations.s2_s3_present', async () => {
    const r: any = await sql`SELECT name FROM _migrations WHERE name IN ('sprint2-departments-hospital-id','sprint3-tasks-table')`;
    return (r as any[]).length === 2 ? null : `expected both sprint2-departments-hospital-id + sprint3-tasks-table; got ${(r as any[]).map((x) => x.name).join(',')}`;
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
