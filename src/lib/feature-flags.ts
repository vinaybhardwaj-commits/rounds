// =============================================================================
// Feature flag helpers — server-side reads from app_settings table
// 1 May 2026 (sub-sprint D.1)
//
// Used for both API route guards and SSR page guards. Client-side reads
// happen via /api/settings/flags + the FeatureFlagsProvider context (D.3).
//
// app_settings is a key/value table with JSONB values, so this layer
// normalizes the JSONB → typed primitive. For boolean flags, both the
// JSONB literal `true`/`false` and the string `"true"`/`"false"` are
// accepted — coercion is generous.
// =============================================================================
import { queryOne } from '@/lib/db';

/**
 * Read a boolean feature flag from app_settings.
 *
 * @param key — the setting key (e.g. 'ot_planning_enabled')
 * @param defaultValue — returned if the row is missing or DB read fails.
 *                       For OT Planning, default false (hidden).
 */
export async function getFeatureFlag(key: string, defaultValue = false): Promise<boolean> {
  try {
    const row = await queryOne<{ value: unknown }>(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
      [key],
    );
    if (!row) return defaultValue;
    const v = row.value;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true';
    if (typeof v === 'number') return v !== 0;
    return defaultValue;
  } catch (err) {
    console.warn(`[feature-flags] getFeatureFlag(${key}) failed; using default ${defaultValue}:`, err instanceof Error ? err.message : err);
    return defaultValue;
  }
}

/**
 * Read all feature flags as an object. Used by /api/settings/flags to
 * hydrate the client-side FeatureFlagsProvider in one round-trip.
 * Returns booleans only — non-boolean settings (strings, numbers,
 * objects) are coerced via the same rules as getFeatureFlag.
 */
export async function getAllFeatureFlags(): Promise<Record<string, boolean>> {
  try {
    const rows = await queryOne<{ flags: Record<string, unknown> }>(
      `SELECT jsonb_object_agg(key, value) AS flags FROM app_settings`,
    );
    if (!rows?.flags) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(rows.flags)) {
      if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string') out[k] = v === 'true';
      else if (typeof v === 'number') out[k] = v !== 0;
    }
    return out;
  } catch (err) {
    console.warn('[feature-flags] getAllFeatureFlags failed; returning empty:', err instanceof Error ? err.message : err);
    return {};
  }
}

/** Convenience for the most-used flag — defaults to false (OT hidden). */
export async function isOtPlanningEnabled(): Promise<boolean> {
  return getFeatureFlag('ot_planning_enabled', false);
}
