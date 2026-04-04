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
