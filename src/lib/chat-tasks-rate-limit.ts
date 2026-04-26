// =============================================================================
// chat-tasks-rate-limit.ts  (CT.3 — Chat Tasks PRD v1.4 §6.6)
//
// In-process sliding-window rate limiter for POST /api/chat-tasks. 10
// task-creations per profile per 60-second window. On hit, returns the
// number of seconds the caller should wait before retrying (used to set
// the Retry-After response header).
//
// Storage: per-process Map. Each profile_id key holds a buffer of the
// last MAX_PER_WINDOW timestamps. On every check we drop entries older
// than WINDOW_MS, count what's left, accept-or-deny.
//
// Scope: per Vercel function instance. If the deploy ever scales
// horizontally and per-instance buckets cause inconsistent throttling,
// CT.17 swaps this for a shared Redis token bucket. Acceptable for v1.
//
// Memory: each profile's buffer caps at MAX_PER_WINDOW entries (10) by
// virtue of the deny-after-max check, so no unbounded growth even under
// adversarial load. Cold instance starts empty (a request to a new
// instance can use up its window from scratch — acceptable since cold
// instances also throttle organically).
// =============================================================================

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

const buckets = new Map<string, number[]>();

export interface RateLimitOk {
  ok: true;
  /** How many slots are still available in the current window (informational). */
  remaining: number;
}

export interface RateLimitDenied {
  ok: false;
  /** Seconds until the oldest entry in the window expires (rounded up, min 1). */
  retryAfterSeconds: number;
  /** How many recent attempts triggered the deny — useful for telemetry. */
  recentCount: number;
}

export type RateLimitResult = RateLimitOk | RateLimitDenied;

/**
 * Check the rate limit for a profile. If `ok`, the caller is recorded as
 * having used a slot at `now`. If denied, no slot is recorded — caller
 * should retry after `retryAfterSeconds`.
 */
export function checkRateLimit(profileId: string): RateLimitResult {
  const now = Date.now();
  const fresh = (buckets.get(profileId) ?? []).filter((ts) => now - ts < WINDOW_MS);

  if (fresh.length >= MAX_PER_WINDOW) {
    const oldest = fresh[0];
    const retryAfterMs = WINDOW_MS - (now - oldest);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      recentCount: fresh.length,
    };
  }

  fresh.push(now);
  buckets.set(profileId, fresh);
  return { ok: true, remaining: MAX_PER_WINDOW - fresh.length };
}

/**
 * Test/diagnostic helper — clears all buckets. Not intended for production
 * code paths; useful in dev REPL or smoke scripts.
 */
export function _resetRateLimitBuckets(): void {
  buckets.clear();
}

/**
 * Inspect a profile's current bucket without mutating it. Useful for
 * telemetry / debug endpoints. Returns the number of recent (un-expired)
 * attempts within the window.
 */
export function inspectRateLimit(profileId: string): { recentCount: number; windowMs: number; max: number } {
  const now = Date.now();
  const fresh = (buckets.get(profileId) ?? []).filter((ts) => now - ts < WINDOW_MS);
  return { recentCount: fresh.length, windowMs: WINDOW_MS, max: MAX_PER_WINDOW };
}
