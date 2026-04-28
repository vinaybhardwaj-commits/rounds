// r003 — Catches v1.1 #7 patients-import stub-doctor NOT NULL bug
// (LSQ stub doctor INSERT never set primary_hospital_id).

import { describe, it, expect } from 'vitest';
import { getSessionOrSkip, base } from './_helpers';

describe('r003 — patients import returns 400 not 500 on empty body', () => {
  it('POST /api/patients/import with no file', async () => {
    const cookie = await getSessionOrSkip(); if (!cookie) { console.warn("[skip] no auth cookie"); return; }
    const res = await fetch(`${base}/api/patients/import`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: new FormData(),
    });
    expect(res.status).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status);
  });
});
