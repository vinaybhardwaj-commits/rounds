// r007 — Catches v1.1 #9 multi-hospital-departments-not-cloned bug.
// After v1.1 #9 migration, departments table must have 19 rows for EHBR
// (mirroring the 19 EHRC depts). Asserted via /api/admin/database/query authed
// SELECT (super_admin only endpoint).

import { describe, it, expect } from 'vitest';
import { getSessionOrSkip, base } from './_helpers';

describe('r007 — EHBR has 19 active department rows in DB', () => {
  it('SELECT count via /api/admin/database/query returns >= 19 for ehbr', async () => {
    const cookie = await getSessionOrSkip(); if (!cookie) { console.warn("[skip] no auth cookie"); return; }
    const sql = `SELECT COUNT(*)::int AS cnt FROM departments d JOIN hospitals h ON h.id = d.hospital_id WHERE h.slug = 'ehbr' AND d.is_active = true LIMIT 1`;
    const res = await fetch(`${base}/api/admin/database/query`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const rows = body.data?.rows || body.data || [];
    const cnt = rows[0]?.cnt;
    expect(typeof cnt).toBe('number');
    expect(cnt).toBeGreaterThanOrEqual(19);
  });
});
