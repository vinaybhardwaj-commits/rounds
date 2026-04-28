// =============================================================================
// substitute.ts (v1.1 — 28 Apr 2026)
//
// Minimal {{var}} substitution layer for help-engine manifests.
//
// Resolves placeholders like:
//   {{user.primary_hospital_name}}        → "Even Hospital Race Course Road"
//   {{user.primary_hospital_short_name}}  → "EHRC"
//   {{user.primary_hospital_slug}}        → "ehrc"
//   {{user.role}}                         → "doctor"
//   {{user.role_scope}}                   → "hospital_bound" | "multi_hospital" | "central"
//   {{user.full_name}}                    → "Animesh Roy"
//
// Applied at render time (not load time) so the same manifest can be served
// to users at different hospitals with different primary affiliations.
//
// Unknown placeholders are left in place (no silent strip) so manifest
// authors can see typos when they read the rendered output. Missing values
// for known placeholders fall back to a sensible generic ("your hospital").
//
// Performance: O(n) regex.replace per text body — no concerns for ≤200KB
// manifest bodies. Substitution skipped entirely if no `{{` substring is
// present in the input.
// =============================================================================

export interface HelpUserVars {
  /** Display name (profiles.full_name). */
  full_name?: string | null;
  /** profiles.role (e.g. 'doctor', 'nurse', 'super_admin'). */
  role?: string | null;
  /** profiles.role_scope. */
  role_scope?: 'hospital_bound' | 'multi_hospital' | 'central' | null;
  /** hospitals.id (UUID). */
  primary_hospital_id?: string | null;
  /** hospitals.slug (e.g. 'ehrc'). */
  primary_hospital_slug?: string | null;
  /** hospitals.short_name (e.g. 'EHRC'). */
  primary_hospital_short_name?: string | null;
  /** hospitals.name (e.g. 'Even Hospital Race Course Road'). */
  primary_hospital_name?: string | null;
}

/**
 * Map of supported placeholder paths → resolved value (or fallback if missing).
 */
function buildVarMap(vars: HelpUserVars): Record<string, string> {
  return {
    'user.full_name': vars.full_name || 'You',
    'user.role': vars.role || 'staff member',
    'user.role_scope': vars.role_scope || 'hospital_bound',
    'user.primary_hospital_id': vars.primary_hospital_id || '',
    'user.primary_hospital_slug': vars.primary_hospital_slug || '',
    'user.primary_hospital_short_name':
      vars.primary_hospital_short_name ||
      (vars.primary_hospital_slug ? vars.primary_hospital_slug.toUpperCase() : 'your hospital'),
    'user.primary_hospital_name':
      vars.primary_hospital_name ||
      vars.primary_hospital_short_name ||
      'your hospital',
  };
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Substitute {{var}} placeholders in the given text.
 *
 * - Unknown placeholders are LEFT IN PLACE (no silent strip) so manifest
 *   authors notice typos.
 * - Empty input returned unchanged.
 * - Skips work if `{{` not present.
 */
export function substituteVars(text: string, vars: HelpUserVars): string {
  if (!text || text.indexOf('{{') === -1) return text;
  const map = buildVarMap(vars);
  return text.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (key in map) return map[key];
    // Unknown placeholder — leave as-is for visibility.
    return match;
  });
}

/**
 * Apply substitution to all string values in a manifest's sections object.
 * Returns a new object; does not mutate the input.
 */
export function substituteSections(
  sections: Record<string, string>,
  vars: HelpUserVars
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) {
    out[k] = typeof v === 'string' ? substituteVars(v, vars) : v;
  }
  return out;
}
