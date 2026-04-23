/**
 * scripts/seed-doctor-affiliations.ts
 *
 * Seeds doctor_hospital_affiliations for any existing profile whose role
 * looks like a doctor (doctor, consultant, specialist, resident,
 * senior_resident, anaesthesiologist). All get EHRC as their primary.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING on the (profile_id, hospital_id)
 * unique constraint. Safe to re-run after adding new doctor profiles later.
 *
 * Today (23 Apr 2026) no profiles have doctor-shaped roles in the EHRC
 * instance, so this script will report 0 affiliations seeded and exit clean.
 * It exists so that (a) the pattern is in place for future doctor onboarding
 * and (b) Sprint 4 (EHBR) and Sprint 5 (EHIN) can re-run it after seeding
 * their doctor accounts.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/seed-doctor-affiliations.ts
 *
 * Author: Sprint 1 Day 4, 23 April 2026.
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

/**
 * Roles we treat as "doctor" for Picker B. Matches the broader set used in
 * hospital staffing models (per memory reference_ehrc_role_terminology).
 */
const DOCTOR_ROLE_PATTERNS = [
  'doctor',
  'consultant',
  'specialist',
  'resident',
  'senior_resident',
  'anaesthesiologist',
  'anaesthetist',
  'surgeon',
  'rmo',
  'registrar',
];

const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connStr) { console.error('FATAL: POSTGRES_URL not set.'); process.exit(2); }
const sql = neon(connStr);

(async () => {
  console.log('\nseed-doctor-affiliations.ts — Sprint 1 Day 4');
  console.log('Target:', new URL(connStr).hostname, '\n');

  // Fetch EHRC hospital id — bail if foundation migration hasn't landed.
  const ehrc = (await (sql as any).query(
    `SELECT id FROM hospitals WHERE slug = 'ehrc' LIMIT 1`
  ));
  const ehrcRows = ehrc.rows ?? ehrc;
  if (!ehrcRows || ehrcRows.length === 0) {
    console.error('FATAL: hospitals.slug="ehrc" not found. Run migration-multi-hospital-foundation.sql first.');
    process.exit(2);
  }
  const ehrcId = ehrcRows[0].id as string;
  console.log('EHRC hospital id:', ehrcId);

  // Find doctor-like profiles.
  const doctorsResp = (await (sql as any).query(
    `SELECT id, name, email, role FROM profiles
     WHERE role = ANY($1::text[])
     ORDER BY name`,
    [DOCTOR_ROLE_PATTERNS]
  ));
  const doctors = doctorsResp.rows ?? doctorsResp;
  console.log(`Found ${doctors.length} doctor-like profiles.`);

  if (doctors.length === 0) {
    console.log('\nNo doctor-role profiles exist yet. This is expected for EHRC as of 23 Apr 2026.');
    console.log('Re-run this script after seeding doctor accounts (Sprint 2+ or on-demand).\n');
    process.exit(0);
  }

  let seeded = 0;
  let skipped = 0;
  for (const d of doctors) {
    try {
      const r = (await (sql as any).query(
        `INSERT INTO doctor_hospital_affiliations (profile_id, hospital_id, is_primary)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (profile_id, hospital_id) DO NOTHING
         RETURNING id`,
        [d.id, ehrcId]
      ));
      const rows = r.rows ?? r;
      if (rows && rows.length > 0) {
        console.log(`  ✓ seeded: ${d.name || d.email || d.id} (${d.role})`);
        seeded++;
      } else {
        console.log(`  · skipped (already exists): ${d.name || d.email || d.id}`);
        skipped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ failed: ${d.name || d.id} — ${msg.substring(0, 120)}`);
    }
  }

  console.log(`\n── Result: ${seeded} seeded, ${skipped} skipped, ${doctors.length - seeded - skipped} failed ──`);
  console.log('\nNext: re-run after adding EHBR / EHIN doctors (Sprints 4–5).\n');
  process.exit(0);
})();
