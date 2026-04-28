// r005 — Catches v1.1 #8 OT readiness SQL bug. Authed GET must return 200,
// not 500 from a broken JOIN (ot_readiness_items has surgery_posting_id,
// not patient_thread_id) or from selecting a non-existent ri.due_date column.

import { describe, it, expect } from 'vitest';
import { getSessionOrSkip, base } from './_helpers';

describe('r005 — GET /api/ot/readiness/mine authed returns 200', () => {
  it('returns 200 with success envelope', async () => {
    const cookie = await getSessionOrSkip(); if (!cookie) { console.warn("[skip] no auth cookie"); return; }
    const res = await fetch(`${base}/api/ot/readiness/mine`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 200 with count_only=true', async () => {
    const cookie = await getSessionOrSkip(); if (!cookie) { console.warn("[skip] no auth cookie"); return; }
    const res = await fetch(`${base}/api/ot/readiness/mine?count_only=true`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('count');
  });
});
