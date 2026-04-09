/**
 * Phase 5.2 API smoke test — verifies the Dedup Hub Activity Log routes:
 *
 *   GET /api/admin/dedup/activity
 *   GET /api/admin/dedup/activity/export
 *
 * Strategy: same CJS require.cache injection pattern as 5.1 — pre-populate
 * `@/lib/auth` with a controllable fake before any route module loads. This
 * lets us hit auth-gated routes in-process without running a dev server.
 *
 * Scenarios covered:
 *
 *   A. Auth gate
 *     A1. activity GET without auth → 403
 *     A2. activity GET with regular admin → 403
 *     A3. export GET without auth → 403
 *
 *   B. Validation
 *     B1. activity GET with invalid from → 400
 *     B2. activity GET with invalid actions value → 400
 *     B3. activity GET with limit=0 → 400
 *     B4. activity GET with negative offset → 400
 *
 *   C. Happy path — list with enrichment + action counts + pagination
 *     C1. seed 6 dedup_log rows (3 merge, 2 link, 1 ignore) referencing real
 *         patient threads, then GET → returns exactly our 6 rows via a
 *         scoped endpoint filter
 *     C2. entries are ordered by created_at DESC
 *     C3. source + target enrichment populated from patient_threads
 *     C4. action_counts reflects the seeded distribution
 *     C5. actions=merge filter narrows to 3 rows
 *     C6. patient=<name> filter matches either side
 *     C7. actor=<name> filter matches
 *     C8. endpoint=<substr> filter matches
 *     C9. limit=2 offset=0 returns first 2 + has_more=true
 *     C10. limit=2 offset=4 returns last 2 + has_more=false
 *     C11. from >= now → 0 entries
 *     C12. metadata JSON round-trips correctly through JSONB
 *
 *   D. CSV export
 *     D1. export GET returns 200 + text/csv content-type
 *     D2. filename header present with date range
 *     D3. row count = header (1) + seeded rows (6)
 *     D4. CSV cells are quoted and double-quotes escaped
 *     D5. filters pass through (endpoint filter narrows the export)
 *     D6. export with 0 matching rows still returns valid CSV (header only)
 *     D7. export honors date window filter
 *
 * All seeded rows are removed at end of test via a finally block.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/smoke-test-phase5.2-activity.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------------------
// STEP 0: Load .env.local manually — same fallback pattern other smoke tests
// use. Matches the 5.1 suite so the test can be run the same way.
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
// STEP 1: Inject a fake `@/lib/auth` into require.cache BEFORE any route
// handler loads. Same pattern as 5.1 API smoke test.
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
// STEP 2: Require routes + helpers AFTER the cache injection.
// ---------------------------------------------------------------------------
const { GET: activityGET } = require('../src/app/api/admin/dedup/activity/route') as {
  GET: (req: any) => Promise<Response>;
};
const { GET: exportGET } = require('../src/app/api/admin/dedup/activity/export/route') as {
  GET: (req: any) => Promise<Response>;
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

const TEST_PREFIX = '__SMOKE_PHASE5_2_ACT_';
const ENDPOINT_TAG_BASE = '__smoke_p52_act_';
const createdThreadIds: string[] = [];
const createdLogIds: string[] = [];

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

async function insertLog(row: {
  action: string;
  source: string | null;
  target: string | null;
  reason: string;
  metadata: Record<string, unknown>;
  actor: string | null;
  actor_name: string | null;
  endpoint: string;
  created_at: Date;
  match_layer?: number | null;
  similarity?: number | null;
}): Promise<string> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO dedup_log (
      action, source_thread_id, target_thread_id, match_layer, similarity,
      reason, metadata, actor_id, actor_name, endpoint, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
    RETURNING id`,
    [
      row.action,
      row.source,
      row.target,
      row.match_layer ?? null,
      row.similarity ?? null,
      row.reason,
      JSON.stringify(row.metadata),
      row.actor,
      row.actor_name,
      row.endpoint,
      row.created_at.toISOString(),
    ]
  );
  return inserted[0].id;
}

async function main() {
  console.log('=== PHASE 5.2 ACTIVITY LOG SMOKE TEST ===\n');

  const creator = await getSuperAdminProfileId();
  console.log('Using creator profile:', creator.id);
  const uniqueMarker = Math.floor(Math.random() * 1_000_000);
  const endpointTag = `${ENDPOINT_TAG_BASE}${uniqueMarker}`;
  const actorName = `smoke_actor_${uniqueMarker}@even.in`;

  // =========================================================================
  // A. Auth gate
  // =========================================================================
  console.log('\n--- A. Auth gate ---');
  mockUser = null;

  const a1res = await activityGET(
    makeRequest('http://test/api/admin/dedup/activity')
  );
  record(
    'A1 — activity GET without auth returns 403',
    a1res.status === 403,
    `status=${a1res.status}`
  );

  mockUser = {
    profileId: creator.id,
    email: creator.email,
    role: 'admin',
    status: 'active',
  };
  const a2res = await activityGET(
    makeRequest('http://test/api/admin/dedup/activity')
  );
  record(
    'A2 — activity GET as regular admin returns 403',
    a2res.status === 403,
    `status=${a2res.status}`
  );

  mockUser = null;
  const a3res = await exportGET(
    makeRequest('http://test/api/admin/dedup/activity/export')
  );
  record(
    'A3 — export GET without auth returns 403',
    a3res.status === 403,
    `status=${a3res.status}`
  );

  // Promote to super_admin for the rest of the suite
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

  const b1res = await activityGET(
    makeRequest('http://test/api/admin/dedup/activity?from=not-a-date')
  );
  record(
    'B1 — invalid from returns 400',
    b1res.status === 400,
    `status=${b1res.status}`
  );

  const b2res = await activityGET(
    makeRequest('http://test/api/admin/dedup/activity?actions=merge,explode')
  );
  record(
    'B2 — invalid action value returns 400',
    b2res.status === 400,
    `status=${b2res.status}`
  );

  const b3res = await activityGET(
    makeRequest('http://test/api/admin/dedup/activity?limit=0')
  );
  record(
    'B3 — limit=0 returns 400',
    b3res.status === 400,
    `status=${b3res.status}`
  );

  const b4res = await activityGET(
    makeRequest('http://test/api/admin/dedup/activity?offset=-1')
  );
  record(
    'B4 — negative offset returns 400',
    b4res.status === 400,
    `status=${b4res.status}`
  );

  // =========================================================================
  // C. Happy path — list with enrichment
  // =========================================================================
  console.log('\n--- C. Happy path listing ---');

  // Seed 6 patient threads (3 pairs) so we have something real to enrich.
  const threads: string[] = [];
  for (let i = 0; i < 6; i++) {
    const t = await createPatientThread({
      patient_name: `${TEST_PREFIX}pt_${i}_${uniqueMarker}`,
      phone: `9999${String(uniqueMarker).padStart(6, '0')}${i}`,
      created_by: creator.id,
      source_type: 'smoke',
    });
    threads.push(t.id);
    createdThreadIds.push(t.id);
  }

  const now = new Date();
  const seeds = [
    // 3 merges — latest first
    {
      action: 'merge',
      source: threads[0],
      target: threads[1],
      reason: `${TEST_PREFIX}merge_A`,
      endpoint: `${endpointTag}/merge`,
      created_at: new Date(now.getTime() - 1000 * 60 * 5), // 5 min ago
      metadata: { merged_fields: ['a', 'b', 'c'], fk_counts: { tasks: 2 } },
    },
    {
      action: 'merge',
      source: threads[2],
      target: threads[3],
      reason: `${TEST_PREFIX}merge_B`,
      endpoint: `${endpointTag}/merge`,
      created_at: new Date(now.getTime() - 1000 * 60 * 10),
      metadata: { merged_fields: ['d'], fk_counts: {} },
    },
    {
      action: 'merge',
      source: threads[4],
      target: threads[5],
      reason: `${TEST_PREFIX}merge_C`,
      endpoint: `${endpointTag}/merge`,
      created_at: new Date(now.getTime() - 1000 * 60 * 15),
      metadata: { merged_fields: [], fk_counts: {} },
    },
    // 2 links
    {
      action: 'link',
      source: null,
      target: threads[0],
      reason: `${TEST_PREFIX}link_A`,
      endpoint: `${endpointTag}/patients`,
      created_at: new Date(now.getTime() - 1000 * 60 * 20),
      metadata: { layer: 1 },
      match_layer: 1,
    },
    {
      action: 'link',
      source: null,
      target: threads[2],
      reason: `${TEST_PREFIX}link_B`,
      endpoint: `${endpointTag}/lsq/sync`,
      created_at: new Date(now.getTime() - 1000 * 60 * 25),
      metadata: { layer: 1, 'quote"with"quotes': 'yes' },
      match_layer: 1,
    },
    // 1 ignore
    {
      action: 'ignore',
      source: threads[4],
      target: null,
      reason: `${TEST_PREFIX}ignore_A`,
      endpoint: `${endpointTag}/kx/import`,
      created_at: new Date(now.getTime() - 1000 * 60 * 30),
      metadata: { collision: true },
    },
  ];

  for (const s of seeds) {
    const id = await insertLog({
      action: s.action,
      source: s.source,
      target: s.target,
      reason: s.reason,
      metadata: s.metadata,
      actor: creator.id,
      actor_name: actorName,
      endpoint: s.endpoint,
      created_at: s.created_at,
      match_layer: (s as any).match_layer ?? null,
    });
    createdLogIds.push(id);
  }
  console.log(`Seeded ${createdLogIds.length} dedup_log rows`);

  // C1 — fetch scoped to our endpoint tag (avoids polluting on prod data)
  const c1res = await activityGET(
    makeRequest(`http://test/api/admin/dedup/activity?endpoint=${endpointTag}&limit=50`)
  );
  const c1 = await readJson(c1res);
  record(
    'C1 — scoped GET returns exactly 6 seeded rows',
    c1res.status === 200 && c1.success && c1.data.total === 6 && c1.data.entries.length === 6,
    `status=${c1res.status} total=${c1.data?.total} len=${c1.data?.entries?.length}`
  );

  // C2 — descending order
  if (c1.success && c1.data.entries.length >= 2) {
    const descending = c1.data.entries.every((e: any, i: number, arr: any[]) => {
      if (i === 0) return true;
      return new Date(arr[i - 1].created_at).getTime() >= new Date(e.created_at).getTime();
    });
    record('C2 — entries ordered by created_at DESC', descending);
  } else {
    record('C2 — entries ordered by created_at DESC', false, 'not enough rows');
  }

  // C3 — source + target enrichment present
  const mergeEntries = c1.data?.entries?.filter((e: any) => e.action === 'merge') ?? [];
  const allEnriched =
    mergeEntries.length === 3 &&
    mergeEntries.every(
      (e: any) =>
        e.source &&
        e.target &&
        typeof e.source.patient_name === 'string' &&
        typeof e.target.patient_name === 'string' &&
        e.source.patient_name.startsWith(TEST_PREFIX) &&
        e.target.patient_name.startsWith(TEST_PREFIX)
    );
  record('C3 — merge rows enriched with both patient names', allEnriched);

  // C4 — action_counts
  const counts = c1.data?.action_counts ?? {};
  record(
    'C4 — action_counts: merge=3',
    counts.merge === 3,
    `got ${counts.merge}`
  );
  record(
    'C4 — action_counts: link=2',
    counts.link === 2,
    `got ${counts.link}`
  );
  record(
    'C4 — action_counts: ignore=1',
    counts.ignore === 1,
    `got ${counts.ignore}`
  );

  // C5 — actions=merge narrows
  const c5res = await activityGET(
    makeRequest(`http://test/api/admin/dedup/activity?endpoint=${endpointTag}&actions=merge`)
  );
  const c5 = await readJson(c5res);
  record(
    'C5 — actions=merge filter returns exactly 3',
    c5.success && c5.data.total === 3 && c5.data.entries.every((e: any) => e.action === 'merge'),
    `total=${c5.data?.total}`
  );

  // C6 — patient= substring filter
  // Use the last 8 chars of the first seeded thread's patient name — unique enough
  const firstName = mergeEntries[0]?.source?.patient_name ?? '';
  const fragment = firstName.slice(-12);
  const c6res = await activityGET(
    makeRequest(
      `http://test/api/admin/dedup/activity?endpoint=${endpointTag}&patient=${encodeURIComponent(fragment)}`
    )
  );
  const c6 = await readJson(c6res);
  record(
    'C6 — patient name filter matches',
    c6.success && c6.data.total >= 1 && c6.data.total <= 2, // source OR target may match
    `total=${c6.data?.total} fragment=${fragment}`
  );

  // C7 — actor= filter
  const c7res = await activityGET(
    makeRequest(
      `http://test/api/admin/dedup/activity?endpoint=${endpointTag}&actor=${encodeURIComponent(`smoke_actor_${uniqueMarker}`)}`
    )
  );
  const c7 = await readJson(c7res);
  record(
    'C7 — actor substring filter narrows to seeded rows',
    c7.success && c7.data.total === 6,
    `total=${c7.data?.total}`
  );

  // C8 — endpoint substring is already what we filter everything by — tighten
  // it to one sub-path
  const c8res = await activityGET(
    makeRequest(`http://test/api/admin/dedup/activity?endpoint=${endpointTag}/lsq/sync`)
  );
  const c8 = await readJson(c8res);
  record(
    'C8 — endpoint substring narrows correctly',
    c8.success && c8.data.total === 1 && c8.data.entries[0].reason === `${TEST_PREFIX}link_B`,
    `total=${c8.data?.total}`
  );

  // C9 — limit=2 offset=0
  const c9res = await activityGET(
    makeRequest(`http://test/api/admin/dedup/activity?endpoint=${endpointTag}&limit=2&offset=0`)
  );
  const c9 = await readJson(c9res);
  record(
    'C9 — limit=2 offset=0 returns 2 with has_more=true',
    c9.success && c9.data.entries.length === 2 && c9.data.has_more === true && c9.data.total === 6,
    `len=${c9.data?.entries?.length} has_more=${c9.data?.has_more}`
  );

  // C10 — limit=2 offset=4
  const c10res = await activityGET(
    makeRequest(`http://test/api/admin/dedup/activity?endpoint=${endpointTag}&limit=2&offset=4`)
  );
  const c10 = await readJson(c10res);
  record(
    'C10 — limit=2 offset=4 returns 2 with has_more=false',
    c10.success && c10.data.entries.length === 2 && c10.data.has_more === false,
    `len=${c10.data?.entries?.length} has_more=${c10.data?.has_more}`
  );

  // C11 — from = future → 0 entries (scoped to our endpoint)
  const future = new Date(now.getTime() + 1000 * 60 * 60).toISOString();
  const c11res = await activityGET(
    makeRequest(
      `http://test/api/admin/dedup/activity?endpoint=${endpointTag}&from=${encodeURIComponent(future)}`
    )
  );
  const c11 = await readJson(c11res);
  record(
    'C11 — future-only window returns 0 entries',
    c11.success && c11.data.total === 0 && c11.data.entries.length === 0,
    `total=${c11.data?.total}`
  );

  // C12 — metadata JSON round-trip (the link_B row has a tricky key)
  const linkB = c1.data?.entries?.find((e: any) => e.reason === `${TEST_PREFIX}link_B`);
  record(
    'C12 — metadata JSON round-trips (object)',
    !!linkB && typeof linkB.metadata === 'object' && linkB.metadata.layer === 1,
    `metadata=${JSON.stringify(linkB?.metadata)}`
  );
  record(
    'C12 — metadata preserves escaped-quote keys',
    !!linkB && linkB.metadata?.['quote"with"quotes'] === 'yes',
    `keys=${linkB ? Object.keys(linkB.metadata) : 'none'}`
  );

  // =========================================================================
  // D. CSV export
  // =========================================================================
  console.log('\n--- D. CSV export ---');

  const d1res = await exportGET(
    makeRequest(`http://test/api/admin/dedup/activity/export?endpoint=${endpointTag}`)
  );
  record(
    'D1 — export returns 200 with text/csv content-type',
    d1res.status === 200 && (d1res.headers.get('content-type') || '').startsWith('text/csv'),
    `status=${d1res.status} ct=${d1res.headers.get('content-type')}`
  );

  // D2 — filename header
  const cd = d1res.headers.get('content-disposition') || '';
  record(
    'D2 — Content-Disposition has attachment + filename',
    cd.startsWith('attachment') && cd.includes('.csv') && cd.includes('dedup-activity-'),
    `cd=${cd}`
  );

  // D3 — row count check
  const csvText = await d1res.text();
  const lines = csvText.trim().split(/\r?\n/);
  record(
    'D3 — CSV has header + 6 data rows = 7 lines',
    lines.length === 7,
    `lines=${lines.length}`
  );

  // D4 — quoting + escape
  // Find the link_B row. The metadata JSON.stringify produces embedded
  // backslash-escaped quotes (\") in the key `quote"with"quotes`, and then
  // CSV escaping doubles every " → "". So we should see:
  //   - `""yes""` as the CSV-escaped value string
  //   - `\""` pattern inside the metadata (JSON-escaped quote followed by
  //     the CSV doubling)
  const linkLine = lines.find((l) => l.includes(`${TEST_PREFIX}link_B`));
  const hasYesQuoted = !!linkLine && linkLine.includes('""yes""');
  const hasEscapedMetadataQuotes = !!linkLine && /\\""/.test(linkLine);
  record(
    'D4 — CSV cells double internal quotes ("" wrapping + "" escape)',
    hasYesQuoted && hasEscapedMetadataQuotes,
    `yes=${hasYesQuoted} esc=${hasEscapedMetadataQuotes}`
  );

  // D5 — filter pass-through
  const d5res = await exportGET(
    makeRequest(
      `http://test/api/admin/dedup/activity/export?endpoint=${endpointTag}&actions=merge`
    )
  );
  const d5text = await d5res.text();
  const d5lines = d5text.trim().split(/\r?\n/);
  record(
    'D5 — export honors action filter (header + 3 merges)',
    d5res.status === 200 && d5lines.length === 4,
    `lines=${d5lines.length}`
  );

  // D6 — future window → 0 matches → header-only CSV
  const d6res = await exportGET(
    makeRequest(
      `http://test/api/admin/dedup/activity/export?endpoint=${endpointTag}&from=${encodeURIComponent(future)}`
    )
  );
  const d6text = await d6res.text();
  const d6lines = d6text.trim().split(/\r?\n/);
  record(
    'D6 — empty window still produces valid CSV (header only)',
    d6res.status === 200 && d6lines.length === 1 && d6lines[0].includes('created_at'),
    `lines=${d6lines.length}`
  );

  // D7 — date window filter: only rows older than 22 minutes
  const narrowFrom = new Date(now.getTime() - 1000 * 60 * 22).toISOString();
  const narrowTo = new Date(now.getTime()).toISOString();
  const d7res = await exportGET(
    makeRequest(
      `http://test/api/admin/dedup/activity/export?endpoint=${endpointTag}&from=${encodeURIComponent(narrowFrom)}&to=${encodeURIComponent(narrowTo)}`
    )
  );
  const d7text = await d7res.text();
  const d7lines = d7text.trim().split(/\r?\n/);
  // Rows at 5/10/15/20 min are in window → 4 data rows + header = 5
  record(
    'D7 — date window filter limits export to in-window rows',
    d7res.status === 200 && d7lines.length === 5,
    `lines=${d7lines.length} (expected 5)`
  );
}

async function cleanup() {
  if (createdLogIds.length > 0) {
    try {
      await query(`DELETE FROM dedup_log WHERE id = ANY($1::uuid[])`, [createdLogIds]);
      console.log(`Cleanup: removed ${createdLogIds.length} dedup_log rows`);
    } catch (e) {
      console.error('Cleanup dedup_log failed:', e);
    }
  }
  if (createdThreadIds.length > 0) {
    try {
      // Any dedup_log rows referencing these threads (but not our seeded ones)
      // get nulled so the DELETE can proceed. dedup_log has FK? Check whether
      // it does — from the schema inspection it does not enforce FK, so a
      // direct DELETE is safe.
      await query(
        `DELETE FROM dedup_log WHERE source_thread_id = ANY($1::uuid[]) OR target_thread_id = ANY($1::uuid[])`,
        [createdThreadIds]
      );
      await query(`DELETE FROM patient_threads WHERE id = ANY($1::uuid[])`, [
        createdThreadIds,
      ]);
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
