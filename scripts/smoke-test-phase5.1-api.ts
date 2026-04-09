/**
 * Phase 5.1 API smoke test — verifies the three Dedup Hub HTTP routes:
 *
 *   GET  /api/admin/dedup/candidates
 *   POST /api/admin/dedup/merge
 *   POST /api/admin/dedup/dismiss
 *
 * Strategy: tsx runs .ts files through a CJS loader (our package.json has no
 * `"type": "module"` field). That means `require.cache` is live and we can
 * inject a fake auth module *before* any route handler loads. We also replace
 * the GetStream helpers so the merge route's best-effort rename doesn't
 * reach out to the real Stream API.
 *
 * Scenarios covered:
 *
 *   A. Forbidden / no auth
 *     A1. candidates GET with null user → 403
 *     A2. merge POST with null user → 403
 *     A3. dismiss POST with null user → 403
 *
 *   B. Validation (happy auth)
 *     B1. merge POST with non-UUID winnerId → 400
 *     B2. merge POST with non-UUID loserId → 400
 *     B3. merge POST with winnerId == loserId → 400
 *     B4. merge POST with malformed JSON body → 400
 *     B5. dismiss POST with non-UUID candidateId → 400
 *     B6. candidates GET with invalid status param → 400
 *
 *   C. Happy-path merge via the HTTP route (real DB writes)
 *     C1. GET pending → seeded candidate present with correct recommendation
 *     C2. merge POST returns success + channelAction = 'missing'
 *     C3. DB reflects the merge (COALESCE fields, merged_into_id, archive_type)
 *     C4. GET ?status=merged shows the candidate resolved
 *
 *   D. Dismiss happy path
 *     D1. dismiss POST returns success + clearedFlag logic fires
 *     D2. candidate status flipped to distinct + is_possible_duplicate cleared
 *     D3. second dismiss on the same candidate returns 409
 *
 * All seeded rows are hard-deleted at the end via createdIds tracking.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/smoke-test-phase5.1-api.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------------------
// STEP 1: Inject a fake `@/lib/auth` into require.cache BEFORE any route
// handler loads. We resolve the path first (no side-effects), then stuff a
// fake module object into the cache at that key. Any subsequent `require`
// from the route handlers via `@/lib/auth` or a relative path resolves to
// the same absolute path → hits our fake.
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
  // Everything else the routes don't touch — but expose enough stubs so
  // transitive imports don't crash if anything new shows up.
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

// Also replace getstream so the merge route's best-effort rename is a no-op.
const streamPath = require.resolve('../src/lib/getstream');
const fakeStreamExports = {
  updatePatientChannel: async () => undefined,
  sendSystemMessage: async () => undefined,
  createPatientChannel: async () => undefined,
  deletePatientChannel: async () => undefined,
};
(require as any).cache[streamPath] = {
  id: streamPath,
  filename: streamPath,
  loaded: true,
  exports: fakeStreamExports,
  children: [],
  parent: null,
  paths: Module._nodeModulePaths(path.dirname(streamPath)),
};

// ---------------------------------------------------------------------------
// STEP 2: Now require routes + helpers. This MUST come after the cache
// injection — dynamic require, not top-level import.
// ---------------------------------------------------------------------------
const { GET: candidatesGET } = require('../src/app/api/admin/dedup/candidates/route') as {
  GET: (req: any) => Promise<Response>;
};
const { POST: mergePOST } = require('../src/app/api/admin/dedup/merge/route') as {
  POST: (req: any) => Promise<Response>;
};
const { POST: dismissPOST } = require('../src/app/api/admin/dedup/dismiss/route') as {
  POST: (req: any) => Promise<Response>;
};
const { NextRequest } = require('next/server') as {
  NextRequest: new (input: string | URL, init?: RequestInit) => any;
};
const { createPatientThread } = require('../src/lib/db-v5') as {
  createPatientThread: (
    input: Record<string, unknown>
  ) => Promise<{ id: string }>;
};
const { query, queryOne, execute } = require('../src/lib/db') as {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  queryOne: <T = any>(sql: string, params?: unknown[]) => Promise<T | null>;
  execute: (sql: string, params?: unknown[]) => Promise<void>;
};

// ---------------------------------------------------------------------------
interface CheckResult {
  label: string;
  pass: boolean;
  note?: string;
}
const results: CheckResult[] = [];
const record = (label: string, pass: boolean, note?: string) =>
  results.push({ label, pass, note });

const TEST_PREFIX = '__SMOKE_PHASE5_1_API_';
const createdIds: string[] = [];

async function getSuperAdminProfileId(): Promise<{ id: string; email: string }> {
  const row = await queryOne<{ id: string; email: string }>(
    `SELECT id, email FROM profiles WHERE role IS NOT NULL ORDER BY created_at ASC LIMIT 1`
  );
  if (!row) throw new Error('No profile found');
  return row;
}

function makeRequest(
  url: string,
  init: { method?: string; body?: unknown } = {}
): any {
  const bodyInit =
    init.body === undefined
      ? undefined
      : typeof init.body === 'string'
        ? init.body
        : JSON.stringify(init.body);
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    body: bodyInit,
    headers: bodyInit !== undefined ? { 'content-type': 'application/json' } : undefined,
  });
}

async function readJson<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function main() {
  console.log('=== PHASE 5.1 API SMOKE TEST ===\n');

  const creator = await getSuperAdminProfileId();
  console.log('Using creator profile:', creator.id);
  const uniqueMarker = Math.floor(Math.random() * 1_000_000);

  // =========================================================================
  // A. Forbidden / no auth
  // =========================================================================
  console.log('\n--- A. Forbidden / no-auth ---');
  mockUser = null;

  const a1res = await candidatesGET(
    makeRequest('http://test/api/admin/dedup/candidates')
  );
  record('A1 — candidates GET without auth returns 403', a1res.status === 403, `status=${a1res.status}`);

  const a2res = await mergePOST(
    makeRequest('http://test/api/admin/dedup/merge', {
      method: 'POST',
      body: { winnerId: '00000000-0000-0000-0000-000000000000', loserId: '00000000-0000-0000-0000-000000000001' },
    })
  );
  record('A2 — merge POST without auth returns 403', a2res.status === 403, `status=${a2res.status}`);

  const a3res = await dismissPOST(
    makeRequest('http://test/api/admin/dedup/dismiss', {
      method: 'POST',
      body: { candidateId: '00000000-0000-0000-0000-000000000000' },
    })
  );
  record('A3 — dismiss POST without auth returns 403', a3res.status === 403, `status=${a3res.status}`);

  // Promote mock user to super_admin for the rest of the suite
  mockUser = {
    profileId: creator.id,
    email: creator.email,
    role: 'super_admin',
    status: 'active',
  };

  // =========================================================================
  // B. Validation
  // =========================================================================
  console.log('\n--- B. Validation errors ---');

  const b1res = await mergePOST(
    makeRequest('http://test/api/admin/dedup/merge', {
      method: 'POST',
      body: { winnerId: 'not-a-uuid', loserId: '00000000-0000-0000-0000-000000000001' },
    })
  );
  record('B1 — merge POST non-UUID winnerId returns 400', b1res.status === 400, `status=${b1res.status}`);

  const b2res = await mergePOST(
    makeRequest('http://test/api/admin/dedup/merge', {
      method: 'POST',
      body: { winnerId: '00000000-0000-0000-0000-000000000000', loserId: 42 },
    })
  );
  record('B2 — merge POST non-UUID loserId returns 400', b2res.status === 400, `status=${b2res.status}`);

  const sameId = '11111111-1111-1111-1111-111111111111';
  const b3res = await mergePOST(
    makeRequest('http://test/api/admin/dedup/merge', {
      method: 'POST',
      body: { winnerId: sameId, loserId: sameId },
    })
  );
  record('B3 — merge POST winnerId==loserId returns 400', b3res.status === 400, `status=${b3res.status}`);

  const b4res = await mergePOST(
    makeRequest('http://test/api/admin/dedup/merge', {
      method: 'POST',
      body: 'not-json-at-all{{{',
    })
  );
  record('B4 — merge POST with malformed JSON returns 400', b4res.status === 400, `status=${b4res.status}`);

  const b5res = await dismissPOST(
    makeRequest('http://test/api/admin/dedup/dismiss', {
      method: 'POST',
      body: { candidateId: 'clearly-not-a-uuid' },
    })
  );
  record('B5 — dismiss POST non-UUID candidateId returns 400', b5res.status === 400, `status=${b5res.status}`);

  const b6res = await candidatesGET(
    makeRequest('http://test/api/admin/dedup/candidates?status=garbage')
  );
  record('B6 — candidates GET with invalid status returns 400', b6res.status === 400, `status=${b6res.status}`);

  // =========================================================================
  // C. Happy-path merge via the HTTP route
  // =========================================================================
  console.log('\n--- C. Happy-path merge via route ---');

  // Older thread — created first, should win by "older wins" tiebreaker
  const olderThread = await createPatientThread({
    patient_name: `${TEST_PREFIX}C_Older_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
    phone: '9' + String(uniqueMarker).padStart(9, '2'),
  });
  createdIds.push(olderThread.id);

  // Small sleep to guarantee distinct created_at ordering
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Newer thread — created second, should be the "loser" by default
  const newerThread = await createPatientThread({
    patient_name: `${TEST_PREFIX}C_Newer_${uniqueMarker}`,
    current_stage: 'pre_admission',
    created_by: creator.id,
    source_type: 'manual',
    email: `newer_${uniqueMarker}@smoke.test`,
    city: 'Mumbai',
  });
  createdIds.push(newerThread.id);

  const candRows = await query<{ id: string }>(
    `INSERT INTO dedup_candidates (new_thread_id, existing_thread_id, similarity, match_type, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [newerThread.id, olderThread.id, 0.9, 'name_trgm']
  );
  const candidateId = candRows[0].id;

  // C1: GET pending candidates → includes our row with older as recommended
  const c1res = await candidatesGET(
    makeRequest('http://test/api/admin/dedup/candidates?status=pending&limit=500')
  );
  record('C1.1 — candidates GET returns 200', c1res.status === 200, `status=${c1res.status}`);
  const c1body = await readJson<{
    success: boolean;
    data: {
      candidates: Array<{
        id: string;
        recommended_winner_id: string;
        newer: { id: string };
        existing: { id: string };
        status: string;
      }>;
    };
  }>(c1res);
  record('C1.2 — response success=true', c1body.success === true);
  const ours = c1body.data.candidates.find((c) => c.id === candidateId);
  record('C1.3 — our seeded candidate appears in the list', !!ours, `found=${!!ours}`);
  record(
    'C1.4 — recommended_winner_id = older thread (created first)',
    ours?.recommended_winner_id === olderThread.id,
    `recommended=${ours?.recommended_winner_id}  expected=${olderThread.id}`
  );
  record(
    'C1.5 — candidate status still pending before merge',
    ours?.status === 'pending',
    `status=${ours?.status}`
  );

  // C2: Merge via the POST route using the recommendation
  const c2res = await mergePOST(
    makeRequest('http://test/api/admin/dedup/merge', {
      method: 'POST',
      body: {
        winnerId: olderThread.id,
        loserId: newerThread.id,
        reason: 'API smoke test — C2 happy path',
        candidateId,
      },
    })
  );
  record('C2.1 — merge POST returns 200', c2res.status === 200, `status=${c2res.status}`);
  const c2body = await readJson<{
    success: boolean;
    data: {
      winnerId: string;
      loserId: string;
      mergedFields: string[];
      channelAction: string;
      candidateId: string | null;
    };
  }>(c2res);
  record('C2.2 — merge response success=true', c2body.success === true);
  record(
    'C2.3 — merge returns correct winner/loser ids',
    c2body.data?.winnerId === olderThread.id && c2body.data?.loserId === newerThread.id
  );
  record(
    'C2.4 — merged fields include email + city from newer thread',
    Array.isArray(c2body.data?.mergedFields) &&
      c2body.data.mergedFields.includes('email') &&
      c2body.data.mergedFields.includes('city'),
    `mergedFields=${c2body.data?.mergedFields?.join(',')}`
  );
  record(
    'C2.5 — channelAction = missing (no getstream id on seeded rows)',
    c2body.data?.channelAction === 'missing',
    `channelAction=${c2body.data?.channelAction}`
  );
  record(
    'C2.6 — candidateId echoed back in merge response',
    c2body.data?.candidateId === candidateId,
    `returned=${c2body.data?.candidateId}`
  );

  // C3: DB side-effects visible via direct query
  const winnerAfter = await queryOne<{
    email: string | null;
    city: string | null;
    returning_patient_count: number | string | null;
  }>(
    `SELECT email, city, returning_patient_count FROM patient_threads WHERE id = $1`,
    [olderThread.id]
  );
  record(
    'C3.1 — winner row picked up email from loser',
    winnerAfter?.email === `newer_${uniqueMarker}@smoke.test`,
    `email=${winnerAfter?.email}`
  );
  record(
    'C3.2 — winner row picked up city=Mumbai',
    winnerAfter?.city === 'Mumbai',
    `city=${winnerAfter?.city}`
  );
  record(
    'C3.3 — winner returning_patient_count bumped',
    Number(winnerAfter?.returning_patient_count) === 1,
    `count=${winnerAfter?.returning_patient_count}`
  );
  const loserAfter = await queryOne<{
    merged_into_id: string | null;
    archive_type: string | null;
  }>(
    `SELECT merged_into_id, archive_type FROM patient_threads WHERE id = $1`,
    [newerThread.id]
  );
  record(
    'C3.4 — loser merged_into_id = winner id',
    loserAfter?.merged_into_id === olderThread.id,
    `merged_into_id=${loserAfter?.merged_into_id}`
  );
  record(
    'C3.5 — loser archive_type = merged',
    loserAfter?.archive_type === 'merged',
    `archive_type=${loserAfter?.archive_type}`
  );

  // C4: candidate flipped to merged and visible via ?status=merged
  const c4res = await candidatesGET(
    makeRequest('http://test/api/admin/dedup/candidates?status=merged&limit=500')
  );
  record('C4.1 — candidates GET ?status=merged returns 200', c4res.status === 200, `status=${c4res.status}`);
  const c4body = await readJson<{
    data: { candidates: Array<{ id: string; status: string }> };
  }>(c4res);
  const ours4 = c4body.data.candidates.find((c) => c.id === candidateId);
  record(
    'C4.2 — our candidate now appears in merged list',
    !!ours4 && ours4.status === 'merged',
    `found=${!!ours4} status=${ours4?.status}`
  );

  // =========================================================================
  // D. Dismiss happy path
  // =========================================================================
  console.log('\n--- D. Dismiss happy path ---');
  const dThread1 = await createPatientThread({
    patient_name: `${TEST_PREFIX}D_T1_${uniqueMarker}`,
    current_stage: 'opd',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(dThread1.id);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const dThread2 = await createPatientThread({
    patient_name: `${TEST_PREFIX}D_T2_${uniqueMarker}`,
    current_stage: 'opd',
    created_by: creator.id,
    source_type: 'manual',
  });
  createdIds.push(dThread2.id);

  // Mark new thread as is_possible_duplicate = true so the clear-flag logic fires
  await execute(
    `UPDATE patient_threads SET is_possible_duplicate = TRUE WHERE id = $1`,
    [dThread2.id]
  );

  const dCand = await query<{ id: string }>(
    `INSERT INTO dedup_candidates (new_thread_id, existing_thread_id, similarity, match_type, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [dThread2.id, dThread1.id, 0.7, 'name_trgm']
  );
  const dCandidateId = dCand[0].id;

  const d1res = await dismissPOST(
    makeRequest('http://test/api/admin/dedup/dismiss', {
      method: 'POST',
      body: {
        candidateId: dCandidateId,
        resolution: 'distinct',
        reason: 'API smoke — not a duplicate',
      },
    })
  );
  record('D1.1 — dismiss POST returns 200', d1res.status === 200, `status=${d1res.status}`);
  const d1body = await readJson<{
    success: boolean;
    data: { resolution: string; clearedFlag: boolean };
  }>(d1res);
  record('D1.2 — response success=true', d1body.success === true);
  record(
    'D1.3 — resolution echoed back as distinct',
    d1body.data?.resolution === 'distinct',
    `resolution=${d1body.data?.resolution}`
  );
  record(
    'D1.4 — clearedFlag = true (no other pending candidates for new thread)',
    d1body.data?.clearedFlag === true,
    `clearedFlag=${d1body.data?.clearedFlag}`
  );

  // D2: candidate row should be status=distinct
  const dCandAfter = await queryOne<{ status: string; resolved_at: string | null }>(
    `SELECT status, resolved_at FROM dedup_candidates WHERE id = $1`,
    [dCandidateId]
  );
  record(
    'D2.1 — candidate status flipped to distinct',
    dCandAfter?.status === 'distinct',
    `status=${dCandAfter?.status}`
  );
  record('D2.2 — candidate resolved_at set', !!dCandAfter?.resolved_at);

  // is_possible_duplicate cleared on dThread2
  const dThread2After = await queryOne<{ is_possible_duplicate: boolean }>(
    `SELECT is_possible_duplicate FROM patient_threads WHERE id = $1`,
    [dThread2.id]
  );
  record(
    'D2.3 — new thread is_possible_duplicate cleared',
    dThread2After?.is_possible_duplicate === false,
    `flag=${dThread2After?.is_possible_duplicate}`
  );

  // D3: A second dismiss on the same candidate returns 409
  const d3res = await dismissPOST(
    makeRequest('http://test/api/admin/dedup/dismiss', {
      method: 'POST',
      body: { candidateId: dCandidateId, resolution: 'distinct' },
    })
  );
  record(
    'D3.1 — second dismiss on already-resolved candidate returns 409',
    d3res.status === 409,
    `status=${d3res.status}`
  );

  // =========================================================================
  // CLEANUP
  // =========================================================================
  console.log('\n--- Cleanup ---');
  try {
    if (createdIds.length > 0) {
      await query(
        `DELETE FROM dedup_log
          WHERE source_thread_id = ANY($1::uuid[])
             OR target_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM dedup_candidates
          WHERE new_thread_id = ANY($1::uuid[])
             OR existing_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `UPDATE patient_threads SET merged_into_id = NULL WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      console.log(`Cleanup: removed ${createdIds.length} seeded patient rows`);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n=== PHASE 5.1 API TEST RESULTS ===');
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
  console.error('API SMOKE TEST FATAL:', e);
  if (createdIds.length > 0) {
    try {
      await query(
        `DELETE FROM dedup_log
          WHERE source_thread_id = ANY($1::uuid[])
             OR target_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM dedup_candidates
          WHERE new_thread_id = ANY($1::uuid[])
             OR existing_thread_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `UPDATE patient_threads SET merged_into_id = NULL WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(
        `DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`,
        [createdIds]
      );
      console.log(`Crash cleanup: removed ${createdIds.length} rows`);
    } catch {
      /* noop */
    }
  }
  process.exit(1);
});
