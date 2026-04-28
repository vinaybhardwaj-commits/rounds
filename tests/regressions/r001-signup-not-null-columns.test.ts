// r001 — Catches the v1.1 #6 bug: MH.1 made profiles.primary_hospital_id
// NOT NULL, but the /api/auth/signup INSERT never set it. Every signup
// 500'd silently for ~3 days until V noticed. This test does a real
// signup POST; if any future schema change reintroduces the bug, this
// test fails immediately.

import { describe, it, expect } from 'vitest';
import { base } from './_helpers';

describe('r001 — signup with valid body returns 200 or 409 (not 500)', () => {
  it('POST /api/auth/signup with deterministic test email', async () => {
    const email = 'qa-bot-r001@even.in';
    const res = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        full_name: 'QA Bot R001',
        pin: '0000',
        role: 'staff',
      }),
    });
    const body = await res.json().catch(() => ({}));
    // Acceptable: 200 (first run, account created), 409 (already exists), 403 (rejected).
    // NOT acceptable: 500 (the regression we're guarding against).
    expect([200, 201, 409, 403]).toContain(res.status);
    expect(body.error || '').not.toMatch(/null value in column/i);
    expect(body.error || '').not.toMatch(/violates not-null constraint/i);
  });
});
