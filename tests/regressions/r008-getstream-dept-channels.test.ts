// r008 — Catches v1.1 #9 sidebar-grouping bug. After v1.1 #9 + the 30→100
// queryChannels limit bump, the system should hold ≥38 active dept rows
// across all hospitals (19 EHRC + 19 EHBR). Asserted via a lightweight
// SELECT (does NOT call seed-channels — that would create real channels
// on every test run).

import { describe, it, expect } from 'vitest';
import { getSessionOrSkip, base } from './_helpers';

describe('r008 — at least 38 active department rows across all hospitals', () => {
  it('SELECT count via /api/admin/database/query returns >= 38 across all hospitals', async () => {
    const cookie = await getSessionOrSkip(); if (!cookie) { console.warn("[skip] no auth cookie"); return; }
    const sql = `SELECT COUNT(*)::int AS cnt FROM departments WHERE is_active = true LIMIT 1`;
    const res = await fetch(`${base}/api/admin/database/query`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const rows = body.data?.rows || body.data || [];
    const cnt = rows[0]?.cnt;
    expect(typeof cnt).toBe('number');
    expect(cnt).toBeGreaterThanOrEqual(38);
  });
});
