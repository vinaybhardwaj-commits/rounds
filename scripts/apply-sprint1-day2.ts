/**
 * scripts/apply-sprint1-day2.ts
 *
 * One-shot applier for Sprint 1 Day 2 migrations against whichever Neon branch
 * POSTGRES_URL points at (typically main via .env.local).
 *
 * Why this exists: the Neon SQL editor was flaky through the Chrome MCP
 * (bracket characters were dropping silently). This script reads the SAME
 * 5 SQL files in src/lib/ and pushes them via the Postgres HTTP driver —
 * no browser, no editor, no typing issues.
 *
 * What it runs (in this order, all idempotent):
 *   1. migration-existing-tables-hospital-id.sql
 *   2. migration-surgical-cases.sql
 *   3. migration-condition-library.sql          (includes 12-row SOP §6.3 seed)
 *   4. migration-equipment.sql
 *   5. migration-ot-list-versions.sql
 *
 * Safe to re-run. Each statement is executed individually via sql.query();
 * duplicates log as "already exists" and continue. Exit 0 on all green.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/apply-sprint1-day2.ts
 *
 * Author: Sprint 1 Day 2, 23 April 2026. Verified against main on same day:
 *   Target: ep-super-wind-an2rwooh.c-6.us-east-1.aws.neon.tech
 *   42 executed, 0 skipped, 0 failed.
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

const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connStr) { console.error('FATAL: POSTGRES_URL not set.'); process.exit(2); }
const sql = neon(connStr);
const maskedHost = (() => {
  try { const u = new URL(connStr); return `${u.hostname}${u.pathname}`; }
  catch { return '(unparseable)'; }
})();

const MIGRATIONS: Array<[string, string]> = [
  ['A: existing-tables hospital_id',       'migration-existing-tables-hospital-id.sql'],
  ['B: surgical_cases + lifecycle',        'migration-surgical-cases.sql'],
  ['C: pac_condition_library + 12 seed',   'migration-condition-library.sql'],
  ['D: equipment tables',                  'migration-equipment.sql'],
  ['E: ot_list_versions',                  'migration-ot-list-versions.sql'],
];

/**
 * Split SQL source into individual statements.
 *
 * Design notes:
 *   - Strips line comments FIRST (line by line). This is safe because our
 *     migrations never put `--` inside a string or a dollar-quoted body.
 *   - Then walks character-by-character, tracking:
 *     - single-quoted strings ('...')  — double '' is escaped quote, stays in
 *     - dollar-quoted bodies ($tag$...$tag$)  — for PL/pgSQL function bodies
 *   - Splits on top-level `;`. Returns trimmed non-empty statements.
 */
function splitStatements(source: string): string[] {
  const clean = source.split('\n').map(l => {
    const idx = l.indexOf('--');
    return idx === -1 ? l : l.substring(0, idx);
  }).join('\n');

  const out: string[] = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inDollar = false;
  let tag = '';

  while (i < clean.length) {
    const c = clean[i]!;

    if (inDollar) {
      const close = `$${tag}$`;
      if (clean.substr(i, close.length) === close) {
        buf += close; i += close.length; inDollar = false; tag = '';
        continue;
      }
      buf += c; i++; continue;
    }

    if (inSingle) {
      buf += c; i++;
      if (c === "'" && clean[i] === "'") { buf += "'"; i++; continue; }
      if (c === "'") inSingle = false;
      continue;
    }

    if (c === '$') {
      const end = clean.indexOf('$', i + 1);
      if (end !== -1) {
        const t = clean.substring(i + 1, end);
        if (/^[A-Za-z0-9_]*$/.test(t)) {
          inDollar = true; tag = t;
          buf += clean.substring(i, end + 1);
          i = end + 1;
          continue;
        }
      }
    }

    if (c === "'") { inSingle = true; buf += c; i++; continue; }

    if (c === ';') {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = ''; i++; continue;
    }

    buf += c; i++;
  }

  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

async function runStatement(stmt: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  try {
    // IMPORTANT: use sql.query() for function-call mode. The tagged-template
    // form (sql`...`) is for interpolated values; we have static SQL here.
    await (sql as any).query(stmt);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg) || /duplicate key/i.test(msg) || /duplicate object/i.test(msg)) {
      return { ok: true, skipped: true };
    }
    return { ok: false, error: msg.substring(0, 300) };
  }
}

(async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Rounds Sprint 1 Day 2 — Migration Applier                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Target: ${maskedHost}\n`);

  try { await sql`SELECT 1`; }
  catch (err) {
    console.error('FATAL: cannot reach DB —', err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const libDir = pathMod.join(__dirname, '..', 'src', 'lib');
  let totalExec = 0, totalSkip = 0, totalFail = 0;
  const failures: Array<{ migration: string; stmt: string; error: string }> = [];

  for (const [label, filename] of MIGRATIONS) {
    const file = pathMod.join(libDir, filename);
    if (!fs.existsSync(file)) {
      console.log(`\x1b[31m✗\x1b[0m ${label}: file missing (${file})`);
      totalFail++;
      failures.push({ migration: label, stmt: '(file missing)', error: `Path: ${file}` });
      continue;
    }
    const stmts = splitStatements(fs.readFileSync(file, 'utf8'));

    process.stdout.write(`\x1b[36m${label}\x1b[0m — ${stmts.length} stmts: `);
    let exec = 0, skip = 0, fail = 0;
    for (const stmt of stmts) {
      const r = await runStatement(stmt);
      if (r.ok) {
        if (r.skipped) { skip++; totalSkip++; process.stdout.write('·'); }
        else { exec++; totalExec++; process.stdout.write('.'); }
      } else {
        fail++; totalFail++; process.stdout.write('X');
        failures.push({ migration: label, stmt: stmt.substring(0, 200), error: r.error ?? '' });
      }
    }
    const icon = fail === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(` ${icon} ${exec} exec · ${skip} skip · ${fail} fail`);
  }

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`TOTAL: ${totalExec} executed · ${totalSkip} skipped · ${totalFail} failed`);
  console.log('─'.repeat(64));

  if (failures.length > 0) {
    console.log('\n\x1b[31mFAILURES:\x1b[0m');
    for (const f of failures) {
      console.log(`\n  [${f.migration}]`);
      console.log(`  STMT: ${f.stmt.replace(/\s+/g, ' ').substring(0, 160)}...`);
      console.log(`  ERROR: ${f.error}`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('\n\x1b[32m✅ All migrations applied successfully.\x1b[0m');
  console.log('Next: run scripts/smoke-sprint-1-case-tables.ts to verify.\n');
  process.exit(0);
})();
