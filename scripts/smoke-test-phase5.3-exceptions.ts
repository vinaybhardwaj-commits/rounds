/**
 * Phase 5.3 API smoke test — verifies the Dedup Hub Exceptions tab:
 *
 *   GET /api/admin/dedup/exceptions                  (list mode)
 *   GET /api/admin/dedup/exceptions?candidate_id=... (single-lookup mode)
 *
 * Also exercises the pure `computeExceptionFlags` helper exported from the
 * route so the flag computation logic is tested in isolation.
 *
 * Strategy: same CJS require.cache injection pattern as 5.1 / 5.2 — fake
 * `@/lib/auth` before any route module loads. All seeded data uses a unique
 * marker prefix so the test can run concurrently without collisions.
 *
 * Scenarios covered:
 *
 *   A. Auth gate
 *     A1. exceptions GET without auth → 403
 *     A2. exceptions GET with regular admin → 403
 *
 *   B. Validation
 *     B1. candidate_id with invalid UUID → 400
 *     B2. candidate_id not found → 404
 *     B3. limit=0 → 400
 *     B4. limit=501 → 400
 *     B5. offset=-1 → 400
 *     B6. types=foo → 400
 *
 *   C. Flag computation + listing (5 seeded candidates)
 *     C1. seed 5 candidates — 1 lsq_conflict, 1 uhid_collision,
 *         1 stage_regression, 1 idempotency_conflict, 1 clean
 *     C2. list GET returns 4 rows (clean is excluded)
 *     C3. each flagged candidate has the correct single flag set
 *     C4. counts dict totals match (1 + 1 + 1 + 1)
 *     C5. ?types=lsq_conflict → 1 row
 *     C6. ?types=lsq_conflict,uhid_collision → 2 rows
 *     C7. ?patient=<substring> → 1 row (by patient name)
 *     C8. ?limit=2&offset=0 → pagination
 *
 *   D. Single-candidate lookup
 *     D1. ?candidate_id=<lsq_id> → 200 with flags.lsq_conflict=true
 *     D2. ?candidate_id=<clean_id> → 200 with has_any_flag=false
 *     D3. ?candidate_id=<non-existent uuid> → 404
 *
 *   E. Resolution disappearance
 *     E1. mark the lsq candidate as 'merged' → list no longer includes it
 *
 *   F. Pure-function flag logic (computeExceptionFlags unit test)
 *     F1. null sides → idempotency_conflict
 *     F2. distinct lsq ids → lsq_conflict
 *     F3. matching lsq ids → no lsq_conflict
 *     F4. distinct uhids (case-insensitive) → uhid_collision
 *     F5. UHIDs with different casing → NOT a collision
 *     F6. stage gap ≥ 2 → stage_regression
 *     F7. stage gap < 2 → no stage_regression
 *     F8. one side archived → idempotency_conflict
 *     F9. one side has merged_into_id → idempotency_conflict
 *
 * All seeded rows are removed at end of test via a finally block.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/smoke-test-phase5.3-exceptions.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------------------
// STEP 0: Load .env.local manually
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
})();

// ---------------------------------------------------------------------------
// STEP 1: Inject fake `@/lib/auth` into require.cache BEFORE route load
// ---------------------------------------------------------------------------
const path = require('path');
const Module = require('module');

let mockUser: {
  profileId: string;
  email: string;
  role: string;
  status: string;
} | null = null;

const authPath = require.resolve('../src/lib/auth');
const fakeAuthExports = {
  getCurrentUser: async () => mockUser,
  verifyToken: async () => null,
  createToken: async () => '',
  getSessionCookie: async () => null,
  setSessionCookie: async () => undefined,
  clearSessionCookie: async () => undefined,
  hashPin: async () => '',
  verifyPin: async () => false,
  isValidEvenEmail: (e: string) => typeof e === 'string' && e.endsWith('@even.in'),
  isValidPin: (p: string) => /^\d{4}$/.test(p),
  isSuperuserEmail: () => false,
};

(require as any).cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: fakeAuthExports,
  children: [],
  parent: null,
  paths: Module._nodeModulePaths(path.dirname(authPath)),
};

// ---------------------------------------------------------------------------
// STEP 2: Require route + helpers AFTER cache injection
// ---------------------------------------------------------------------------
const exceptionsRoute = require('../src/app/api/admin/dedup/exceptions/route') as {
  GET: (req: any) => Promise<Response>;
  computeExceptionFlags: (a: any, b: any) => {
    lsq_conflict: boolean;
    uhid_collision: boolean;
    stage_regression: boolean;
    idempotency_conflict: boolean;
  };
  hasAnyFlag: (f: {
    lsq_conflict: boolean;
    uhid_collision: boolean;
    stage_regression: boolean;
    idempotency_conflict: boolean;
  }) => boolean;
};
const { GET: exceptionsGET, computeExceptionFlags, hasAnyFlag } = exceptionsRoute;

const { NextRequest } = require('next/server') as {
  NextRequest: new (input: string | URL, init?: RequestInit) => any;
};
const { createPatientThread } = require('../src/lib/db-v5') as {
  createPatientThread: (input: Record<string, unknown>) => Promise<{ id: string }>;
};
const { query, queryOne, execute } = require('../src/lib/db') as {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  queryOne: <T = any>(sql: string, params?: unknown[]) => Promise<T | null>;
  execute: (sql: string, params?: unknown[]) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------
interface CheckResult {
  label: string;
  pass: boolean;
  note?: string;
}
const results: CheckResult[] = [];
const record = (label: string, pass: boolean, note?: string) =>
  results.push({ label, pass, note });

const TEST_PREFIX = '__SMOKE_PHASE5_3_EXC_';
const createdThreadIds: string[] = [];
const createdCandidateIds: string[] = [];

async function getSuperAdminProfileId(): Promise<{ id: string; email: string }> {
  const row = await queryOne<{ id: string; email: string }>(
    `SELECT id, email FROM profiles WHERE role IS NOT NULL ORDER BY created_at ASC LIMIT 1`
  );
  if (!row) throw new Error('No profile found');
  return row;
}

function makeRequest(url: string): any {
  return new NextRequest(url, { method: 'GET' });
}

async function readJson<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function insertCandidate(
  newId: string,
  existingId: string,
  matchType: string,
  similarity: number
): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO dedup_candidates (
      new_thread_id, existing_thread_id, similarity, match_type, match_fields, status
    ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
    RETURNING id`,
    [newId, existingId, similarity, matchType, JSON.stringify({})]
  );
  return rows[0].id;
}

async function seedThread(args: {
  name: string;
  stage?: string;
  uhid?: string | null;
  lsq?: string | null;
  archived?: boolean;
  mergedIntoId?: string | null;
  creator: string;
}): Promise<string> {
  const t = await createPatientThread({
    patient_name: args.name,
    phone: `9988${Math.floor(Math.random() * 1_000_000)}`,
    created_by: args.creator,
    source_type: 'smoke',
    current_stage: args.stage ?? 'opd',
  });
  createdThreadIds.push(t.id);

  // Apply any extras that createPatientThread doesn't accept directly
  const extraClauses: string[] = [];
  const extraParams: unknown[] = [];
  let paramIdx = 1;
  if (args.uhid !== undefined && args.uhid !== null) {
    extraClauses.push(`uhid = $${paramIdx++}`);
    extraParams.push(args.uhid);
  }
  if (args.lsq !== undefined && args.lsq !== null) {
    extraClauses.push(`lsq_lead_id = $${paramIdx++}`);
    extraParams.push(args.lsq);
  }
  if (args.archived) {
    extraClauses.push(`archived_at = NOW()`);
  }
  if (args.mergedIntoId) {
    extraClauses.push(`merged_into_id = $${paramIdx++}`);
    extraParams.push(args.mergedIntoId);
  }
  if (extraClauses.length > 0) {
    extraParams.push(t.id);
    await execute(
      `UPDATE patient_threads SET ${extraClauses.join(', ')} WHERE id = $${paramIdx}`,
      extraParams
    );
  }

  return t.id;
}

async function main() {
  console.log('=== PHASE 5.3 EXCEPTIONS SMOKE TEST ===\n');

  const creator = await getSuperAdminProfileId();
  console.log('Using creator profile:', creator.id);
  const uniqueMarker = Math.floor(Math.random() * 1_000_000);

  // =========================================================================
  // F. Pure function unit tests — run first (no DB needed)
  // =========================================================================
  console.log('\n--- F. computeExceptionFlags unit tests ---');

  const f1 = computeExceptionFlags(null, null);
  record(
    'F1 — null sides → idempotency_conflict only',
    f1.idempotency_conflict === true &&
      f1.lsq_conflict === false &&
      f1.uhid_collision === false &&
      f1.stage_regression === false
  );

  const base = {
    id: 'x',
    patient_name: 'X',
    phone: null,
    whatsapp_number: null,
    city: null,
    uhid: null,
    source_type: null,
    lsq_lead_id: null,
    current_stage: null,
    archived_at: null,
    merged_into_id: null,
    created_at: null,
  };

  const f2 = computeExceptionFlags(
    { ...base, lsq_lead_id: 'LSQ-1' },
    { ...base, lsq_lead_id: 'LSQ-2' }
  );
  record('F2 — distinct LSQ ids → lsq_conflict', f2.lsq_conflict === true);

  const f3 = computeExceptionFlags(
    { ...base, lsq_lead_id: 'LSQ-1' },
    { ...base, lsq_lead_id: 'LSQ-1' }
  );
  record('F3 — matching LSQ ids → no lsq_conflict', f3.lsq_conflict === false);

  const f4 = computeExceptionFlags(
    { ...base, uhid: 'UHID-A' },
    { ...base, uhid: 'UHID-B' }
  );
  record('F4 — distinct UHIDs → uhid_collision', f4.uhid_collision === true);

  // Note: UHID compare is case-insensitive after trim — same value in diff cases
  // must NOT collide
  const f5 = computeExceptionFlags(
    { ...base, uhid: 'uhid-123' },
    { ...base, uhid: 'UHID-123' }
  );
  record('F5 — UHID case differences do NOT collide', f5.uhid_collision === false);

  const f6 = computeExceptionFlags(
    { ...base, current_stage: 'opd' }, // rank 0
    { ...base, current_stage: 'surgery' } // rank 4
  );
  record(
    'F6 — stage gap ≥ 2 (opd vs surgery) → stage_regression',
    f6.stage_regression === true
  );

  const f7 = computeExceptionFlags(
    { ...base, current_stage: 'opd' }, // rank 0
    { ...base, current_stage: 'pre_admission' } // rank 1
  );
  record(
    'F7 — stage gap < 2 (opd vs pre_admission) → no regression',
    f7.stage_regression === false
  );

  const archivedDate = '2025-01-01T00:00:00Z';
  const f8 = computeExceptionFlags(
    { ...base, archived_at: archivedDate },
    { ...base }
  );
  record(
    'F8 — archived side → idempotency_conflict',
    f8.idempotency_conflict === true
  );

  const f9 = computeExceptionFlags(
    { ...base, merged_into_id: 'some-uuid' },
    { ...base }
  );
  record(
    'F9 — merged_into_id set → idempotency_conflict',
    f9.idempotency_conflict === true
  );

  // hasAnyFlag smoke
  record('F10 — hasAnyFlag(null,null) is true', hasAnyFlag(f1) === true);
  record(
    'F11 — hasAnyFlag(all-false) is false',
    hasAnyFlag({
      lsq_conflict: false,
      uhid_collision: false,
      stage_regression: false,
      idempotency_conflict: false,
    }) === false
  );

  // =========================================================================
  // A. Auth gate
  // =========================================================================
  console.log('\n--- A. Auth gate ---');
  mockUser = null;

  const a1 = await exceptionsGET(
    makeRequest('http://test/api/admin/dedup/exceptions')
  );
  record('A1 — exceptions GET without auth returns 403', a1.status === 403, `status=${a1.status}`);

  mockUser = {
    profileId: creator.id,
    email: creator.email,
    role: 'admin',
    status: 'active',
  };
  const a2 = await exceptionsGET(
    makeRequest('http://test/api/admin/dedup/exceptions')
  );
  record('A2 — exceptions GET as regular admin returns 403', a2.status === 403, `status=${a2.status}`);

  mockUser = {
    profileId: creator.id,
    email: creator.email,
    role: 'super_admin',
    status: 'active',
  };

  // =========================================================================
  // B. Validation
  // =========================================================================
  console.log('\n--- B. Validation ---');

  const b1 = await exceptionsGET(
    makeRequest('http://test/api/admin/dedup/exceptions?candidate_id=not-a-uuid')
  );
  record('B1 — candidate_id invalid UUID returns 400', b1.status === 400, `status=${b1.status}`);

  const b2 = await exceptionsGET(
    makeRequest(
      'http://test/api/admin/dedup/exceptions?candidate_id=00000000-0000-0000-0000-000000000000'
    )
  );
  record('B2 — candidate_id not found returns 404', b2.status === 404, `status=${b2.status}`);

  const b3 = await exceptionsGET(
    makeRequest('http://test/api/admin/dedup/exceptions?limit=0')
  );
  record('B3 — limit=0 returns 400', b3.status === 400, `status=${b3.status}`);

  const b4 = await exceptionsGET(
    makeRequest('http://test/api/admin/dedup/exceptions?limit=501')
  );
  record('B4 — limit=501 returns 400', b4.status === 400, `status=${b4.status}`);

  const b5 = await exceptionsGET(
    makeRequest('http://test/api/admin/dedup/exceptions?offset=-1')
  );
  record('B5 — offset=-1 returns 400', b5.status === 400, `status=${b5.status}`);

  const b6 = await exceptionsGET(
    makeRequest('http://test/api/admin/dedup/exceptions?types=foo')
  );
  record('B6 — types=foo returns 400', b6.status === 400, `status=${b6.status}`);

  // =========================================================================
  // C. Seeded candidates + list
  // =========================================================================
  console.log('\n--- C. Happy-path listing with 5 seeded candidates ---');

  // Unique patient name for the patient filter test
  const uniquePatientName = `${TEST_PREFIX}unique_${uniqueMarker}`;

  // Candidate LSQ — two threads with distinct LSQ ids, same everything else
  const lsq_new = await seedThread({
    name: `${TEST_PREFIX}lsq_new_${uniqueMarker}`,
    creator: creator.id,
    lsq: `LSQ-A-${uniqueMarker}`,
    stage: 'opd',
  });
  const lsq_ex = await seedThread({
    name: `${TEST_PREFIX}lsq_ex_${uniqueMarker}`,
    creator: creator.id,
    lsq: `LSQ-B-${uniqueMarker}`,
    stage: 'opd',
  });
  const lsqCandId = await insertCandidate(lsq_new, lsq_ex, 'name_trgm', 0.85);
  createdCandidateIds.push(lsqCandId);

  // Candidate UHID — two threads with distinct UHIDs
  const uhid_new = await seedThread({
    name: `${TEST_PREFIX}uhid_new_${uniqueMarker}`,
    creator: creator.id,
    uhid: `UHID-A-${uniqueMarker}`,
    stage: 'opd',
  });
  const uhid_ex = await seedThread({
    name: `${TEST_PREFIX}uhid_ex_${uniqueMarker}`,
    creator: creator.id,
    uhid: `UHID-B-${uniqueMarker}`,
    stage: 'opd',
  });
  const uhidCandId = await insertCandidate(uhid_new, uhid_ex, 'name_trgm', 0.86);
  createdCandidateIds.push(uhidCandId);

  // Candidate STAGE — two threads with stages differing by >=2 ranks
  // opd (0) vs surgery (4) → gap 4
  const stage_new = await seedThread({
    name: `${TEST_PREFIX}stage_new_${uniqueMarker}`,
    creator: creator.id,
    stage: 'opd',
  });
  const stage_ex = await seedThread({
    name: `${TEST_PREFIX}stage_ex_${uniqueMarker}`,
    creator: creator.id,
    stage: 'surgery',
  });
  const stageCandId = await insertCandidate(stage_new, stage_ex, 'name_trgm', 0.87);
  createdCandidateIds.push(stageCandId);

  // Candidate IDEMPOTENCY — one side archived
  const idem_new = await seedThread({
    name: `${TEST_PREFIX}idem_new_${uniqueMarker}`,
    creator: creator.id,
    stage: 'opd',
  });
  const idem_ex = await seedThread({
    name: `${TEST_PREFIX}idem_ex_${uniqueMarker}`,
    creator: creator.id,
    stage: 'opd',
    archived: true,
  });
  const idemCandId = await insertCandidate(idem_new, idem_ex, 'name_trgm', 0.88);
  createdCandidateIds.push(idemCandId);

  // Candidate CLEAN — matching on name only, no flags
  const clean_new = await seedThread({
    name: `${uniquePatientName}_new`,
    creator: creator.id,
    stage: 'opd',
  });
  const clean_ex = await seedThread({
    name: `${uniquePatientName}_ex`,
    creator: creator.id,
    stage: 'opd',
  });
  const cleanCandId = await insertCandidate(clean_new, clean_ex, 'name_trgm', 0.89);
  createdCandidateIds.push(cleanCandId);

  // Fetch the ONLY candidates we just created — filter by match_fields? No,
  // we filter by patient prefix so we don't pick up ambient exceptions.
  // Easier: use patient filter to scope to our TEST_PREFIX.
  const c2res = await exceptionsGET(
    makeRequest(
      `http://test/api/admin/dedup/exceptions?patient=${encodeURIComponent(TEST_PREFIX)}`
    )
  );
  const c2body = await readJson<any>(c2res);
  const ourRows: any[] = c2body?.data?.exceptions || [];
  const ourIds = new Set(ourRows.map((r) => r.id));
  const c2pass =
    c2res.status === 200 &&
    ourIds.has(lsqCandId) &&
    ourIds.has(uhidCandId) &&
    ourIds.has(stageCandId) &&
    ourIds.has(idemCandId) &&
    !ourIds.has(cleanCandId);
  record(
    'C2 — list returns 4 flagged, excludes clean',
    c2pass,
    `rows=${ourRows.length} ids=${Array.from(ourIds).map((s: any) => String(s).slice(0, 8)).join(',')}`
  );

  // C3 — each flagged candidate has the correct single flag set
  const byId = new Map(ourRows.map((r) => [r.id, r]));
  const lsqRow = byId.get(lsqCandId);
  const uhidRow = byId.get(uhidCandId);
  const stageRow = byId.get(stageCandId);
  const idemRow = byId.get(idemCandId);

  record(
    'C3a — lsq candidate has only lsq_conflict',
    !!lsqRow &&
      lsqRow.flags.lsq_conflict === true &&
      lsqRow.flags.uhid_collision === false &&
      lsqRow.flags.stage_regression === false &&
      lsqRow.flags.idempotency_conflict === false,
    lsqRow ? JSON.stringify(lsqRow.flags) : 'missing'
  );
  record(
    'C3b — uhid candidate has only uhid_collision',
    !!uhidRow &&
      uhidRow.flags.uhid_collision === true &&
      uhidRow.flags.lsq_conflict === false &&
      uhidRow.flags.stage_regression === false &&
      uhidRow.flags.idempotency_conflict === false,
    uhidRow ? JSON.stringify(uhidRow.flags) : 'missing'
  );
  record(
    'C3c — stage candidate has only stage_regression',
    !!stageRow &&
      stageRow.flags.stage_regression === true &&
      stageRow.flags.lsq_conflict === false &&
      stageRow.flags.uhid_collision === false &&
      stageRow.flags.idempotency_conflict === false,
    stageRow ? JSON.stringify(stageRow.flags) : 'missing'
  );
  record(
    'C3d — idem candidate has only idempotency_conflict',
    !!idemRow &&
      idemRow.flags.idempotency_conflict === true &&
      idemRow.flags.lsq_conflict === false &&
      idemRow.flags.uhid_collision === false &&
      idemRow.flags.stage_regression === false,
    idemRow ? JSON.stringify(idemRow.flags) : 'missing'
  );

  // C4 — counts dict totals (at least 1 of each — there may be ambient
  // rows we don't control, so we assert "≥1" not "==1")
  const counts = c2body?.data?.counts || {};
  record(
    'C4 — counts dict has ≥1 of each flag type',
    (counts.lsq_conflict || 0) >= 1 &&
      (counts.uhid_collision || 0) >= 1 &&
      (counts.stage_regression || 0) >= 1 &&
      (counts.idempotency_conflict || 0) >= 1,
    JSON.stringify(counts)
  );

  // C5 — types=lsq_conflict narrows to lsq candidate
  const c5res = await exceptionsGET(
    makeRequest(
      `http://test/api/admin/dedup/exceptions?types=lsq_conflict&patient=${encodeURIComponent(TEST_PREFIX)}`
    )
  );
  const c5body = await readJson<any>(c5res);
  const c5rows: any[] = c5body?.data?.exceptions || [];
  const c5ids = new Set(c5rows.map((r) => r.id));
  record(
    'C5 — types=lsq_conflict narrows to lsq candidate only',
    c5ids.has(lsqCandId) && !c5ids.has(uhidCandId) && !c5ids.has(stageCandId) && !c5ids.has(idemCandId),
    `rows=${c5rows.length}`
  );

  // C6 — types=lsq_conflict,uhid_collision
  const c6res = await exceptionsGET(
    makeRequest(
      `http://test/api/admin/dedup/exceptions?types=lsq_conflict,uhid_collision&patient=${encodeURIComponent(TEST_PREFIX)}`
    )
  );
  const c6body = await readJson<any>(c6res);
  const c6rows: any[] = c6body?.data?.exceptions || [];
  const c6ids = new Set(c6rows.map((r) => r.id));
  record(
    'C6 — types=lsq_conflict,uhid_collision returns both',
    c6ids.has(lsqCandId) && c6ids.has(uhidCandId) && !c6ids.has(stageCandId),
    `rows=${c6rows.length}`
  );

  // C7 — patient filter with unique_* name returns 0 (clean is excluded, no
  // flagged candidate uses that name)
  const c7res = await exceptionsGET(
    makeRequest(
      `http://test/api/admin/dedup/exceptions?patient=${encodeURIComponent(uniquePatientName)}`
    )
  );
  const c7body = await readJson<any>(c7res);
  const c7rows: any[] = c7body?.data?.exceptions || [];
  record(
    'C7 — patient filter returns 0 (unique name only matches clean)',
    c7rows.length === 0,
    `rows=${c7rows.length}`
  );

  // C8 — pagination
  const c8res = await exceptionsGET(
    makeRequest(
      `http://test/api/admin/dedup/exceptions?patient=${encodeURIComponent(TEST_PREFIX)}&limit=2&offset=0`
    )
  );
  const c8body = await readJson<any>(c8res);
  const c8rows: any[] = c8body?.data?.exceptions || [];
  record(
    'C8 — limit=2 returns exactly 2 rows',
    c8res.status === 200 && c8rows.length === 2,
    `rows=${c8rows.length}`
  );

  // =========================================================================
  // D. Single-candidate lookup
  // =========================================================================
  console.log('\n--- D. Single-candidate lookup ---');

  const d1res = await exceptionsGET(
    makeRequest(`http://test/api/admin/dedup/exceptions?candidate_id=${lsqCandId}`)
  );
  const d1body = await readJson<any>(d1res);
  record(
    'D1 — lsq candidate single lookup returns flags.lsq_conflict=true',
    d1res.status === 200 &&
      d1body?.data?.exception?.flags?.lsq_conflict === true &&
      d1body?.data?.exception?.has_any_flag === true,
    `status=${d1res.status}`
  );

  const d2res = await exceptionsGET(
    makeRequest(`http://test/api/admin/dedup/exceptions?candidate_id=${cleanCandId}`)
  );
  const d2body = await readJson<any>(d2res);
  record(
    'D2 — clean candidate single lookup returns has_any_flag=false',
    d2res.status === 200 && d2body?.data?.exception?.has_any_flag === false,
    `status=${d2res.status} hasAny=${d2body?.data?.exception?.has_any_flag}`
  );

  // D3 — non-existent candidate
  const d3res = await exceptionsGET(
    makeRequest(
      `http://test/api/admin/dedup/exceptions?candidate_id=11111111-2222-3333-4444-555555555555`
    )
  );
  record('D3 — non-existent candidate_id returns 404', d3res.status === 404, `status=${d3res.status}`);

  // =========================================================================
  // E. Resolution disappearance
  // =========================================================================
  console.log('\n--- E. Resolution disappearance ---');

  await execute(
    `UPDATE dedup_candidates SET status = 'merged', resolved_at = NOW() WHERE id = $1`,
    [lsqCandId]
  );

  const e1res = await exceptionsGET(
    makeRequest(
      `http://test/api/admin/dedup/exceptions?patient=${encodeURIComponent(TEST_PREFIX)}`
    )
  );
  const e1body = await readJson<any>(e1res);
  const e1rows: any[] = e1body?.data?.exceptions || [];
  const e1ids = new Set(e1rows.map((r) => r.id));
  record(
    'E1 — resolved candidate disappears from list',
    !e1ids.has(lsqCandId) &&
      e1ids.has(uhidCandId) &&
      e1ids.has(stageCandId) &&
      e1ids.has(idemCandId),
    `remaining=${e1rows.length}`
  );
}

async function cleanup() {
  if (createdCandidateIds.length > 0) {
    try {
      await query(`DELETE FROM dedup_candidates WHERE id = ANY($1::uuid[])`, [
        createdCandidateIds,
      ]);
      console.log(`Cleanup: removed ${createdCandidateIds.length} dedup_candidates rows`);
    } catch (e) {
      console.error('Cleanup dedup_candidates failed:', e);
    }
  }
  if (createdThreadIds.length > 0) {
    try {
      await query(
        `DELETE FROM dedup_candidates WHERE new_thread_id = ANY($1::uuid[]) OR existing_thread_id = ANY($1::uuid[])`,
        [createdThreadIds]
      );
      await query(
        `DELETE FROM dedup_log WHERE source_thread_id = ANY($1::uuid[]) OR target_thread_id = ANY($1::uuid[])`,
        [createdThreadIds]
      );
      await query(`DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`, [createdThreadIds]);
      console.log(`Cleanup: removed ${createdThreadIds.length} patient_threads rows`);
    } catch (e) {
      console.error('Cleanup patient_threads failed:', e);
    }
  }
}

main()
  .then(async () => {
    await cleanup();
    console.log('\n=== RESULTS ===');
    let passed = 0;
    let failed = 0;
    for (const r of results) {
      const tag = r.pass ? '✓' : '✗';
      const note = r.note ? ` — ${r.note}` : '';
      console.log(`${tag} ${r.label}${note}`);
      if (r.pass) passed++;
      else failed++;
    }
    console.log(`\n${passed}/${results.length} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.error('SMOKE TEST FATAL:', e);
    await cleanup();
    process.exit(1);
  });
