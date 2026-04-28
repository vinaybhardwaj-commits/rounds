// Shared helpers for QA Gates regression suite.
// Auth strategy (in order):
//   1. TEST_SESSION_COOKIE env var (manual override; bypasses rate limits)
//   2. Auto-login via TEST_USER_EMAIL + TEST_USER_PIN (subject to /api/auth/
//      login's 5-per-15-min rate limit)
// Cached in globalThis so all test files share the session (singleFork mode).

const RAW_BASE = process.env.BASE_URL;
const BASE_URL = (RAW_BASE && RAW_BASE.startsWith('http')) ? RAW_BASE : 'https://rounds-sqxh.vercel.app';
const TEST_SESSION_COOKIE = process.env.TEST_SESSION_COOKIE;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'vinay.bhardwaj@even.in';
const TEST_USER_PIN = process.env.TEST_USER_PIN || '1234';

declare global {
  // eslint-disable-next-line no-var
  var __qa_cookie__: string | null | undefined;
  // eslint-disable-next-line no-var
  var __qa_login_promise__: Promise<string> | null | undefined;
  // eslint-disable-next-line no-var
  var __qa_auth_failed__: boolean | undefined;
}

async function loginOnce(): Promise<string> {
  // Manual override wins
  if (TEST_SESSION_COOKIE) {
    return TEST_SESSION_COOKIE.startsWith('rounds_session=')
      ? TEST_SESSION_COOKIE
      : `rounds_session=${TEST_SESSION_COOKIE}`;
  }
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USER_EMAIL, pin: TEST_USER_PIN }),
  });
  if (!res.ok) {
    throw new Error(
      `Login failed: ${res.status}. ` +
      `Set TEST_SESSION_COOKIE env var to bypass rate limit ` +
      `(e.g., TEST_SESSION_COOKIE='rounds_session=eyJhbGc...'). ` +
      `URL: ${BASE_URL}/api/auth/login`
    );
  }
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/rounds_session=[^;]+/);
  if (!match) throw new Error('No rounds_session cookie in login response');
  return match[0];
}

export async function getSession(): Promise<string> {
  if (globalThis.__qa_cookie__) return globalThis.__qa_cookie__;
  if (globalThis.__qa_auth_failed__) {
    throw new Error('Session unavailable (previous login failed; set TEST_SESSION_COOKIE to retry)');
  }
  if (!globalThis.__qa_login_promise__) {
    globalThis.__qa_login_promise__ = loginOnce()
      .then((c) => {
        globalThis.__qa_cookie__ = c;
        return c;
      })
      .catch((e) => {
        globalThis.__qa_auth_failed__ = true;
        throw e;
      });
  }
  return globalThis.__qa_login_promise__;
}

/**
 * Use in test bodies that NEED auth: skips the test gracefully if no cookie
 * is available (instead of failing). Returns the cookie or null.
 */
export async function getSessionOrSkip(): Promise<string | null> {
  try {
    return await getSession();
  } catch {
    return null;
  }
}

export const base = BASE_URL;
