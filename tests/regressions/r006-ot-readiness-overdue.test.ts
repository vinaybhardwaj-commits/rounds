// r006 — Same bug class as r005 in /api/ot/readiness/overdue.

import { describe, it, expect } from 'vitest';
import { getSessionOrSkip, base } from './_helpers';

describe('r006 — GET /api/ot/readiness/overdue authed returns 200', () => {
  it('returns 200 with array data', async () => {
    const cookie = await getSessionOrSkip(); if (!cookie) { console.warn("[skip] no auth cookie"); return; }
    const res = await fetch(`${base}/api/ot/readiness/overdue`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
