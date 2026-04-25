// ============================================
// Shared role validation utilities
// Single source of truth for valid UserRole values.
// ============================================

import type { UserRole } from '@/types';

/**
 * All valid roles in the system. Keep in sync with UserRole type in types/index.ts.
 */
export const VALID_ROLES: readonly UserRole[] = [
  'super_admin',
  'department_head',
  'staff',
  'ip_coordinator',
  'anesthesiologist',
  'ot_coordinator',
  'nurse',
  'billing_executive',
  'insurance_coordinator',
  'pharmacist',
  'physiotherapist',
  'marketing_executive',
  'clinical_care',
  'pac_coordinator',
  'administrator',
  'medical_administrator',
  'operations_manager',
  'unit_head',
  'marketing',
  'guest',
] as const;

/**
 * Check if a string is a valid UserRole.
 */
export function isValidRole(role: string): role is UserRole {
  return VALID_ROLES.includes(role as UserRole);
}

// =============================================================================
// 25 Apr 2026 — super_admin universal-pass policy.
//
// Per V's directive: superusers (role='super_admin') see everything and can do
// everything every other role can do. This is a deliberate testability
// affordance (V is the GM and runs UAT across all team roles), not a security
// loophole.
//
// All role gates (API routes, UI conditionals, form submissionRoles) should
// use these helpers instead of bare `Set.has(user.role)` / `role === 'X'`.
// That way:
//   1. super_admin universally passes WITHOUT every gate site having to
//      remember to include 'super_admin' in its allow-set.
//   2. If a gate is added without super_admin in the allow-set, the helper
//      still lets super_admin through. No more silent regressions like the
//      ones we hit on the case lifecycle.
// =============================================================================

/**
 * Returns true if the caller's role is allowed to perform the action.
 * super_admin universally passes. Accepts either an array or a Set.
 */
export function hasRole(
  role: string | null | undefined,
  allowed: readonly string[] | Set<string>
): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  if (allowed instanceof Set) return allowed.has(role);
  return allowed.includes(role);
}

/**
 * Returns true if the caller is super_admin. Use this at UI surfaces that
 * want to render a "viewing-as-super_admin" indicator or expose dev-only
 * actions; do NOT use for action gates (use hasRole instead).
 */
export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === 'super_admin';
}
