// =============================================================================
// admin-hospital-scope.ts (MH.3)
//
// Helper that returns the list of hospital IDs an admin can see based on their
// role. Used by admin list endpoints (analytics, users, billing) to filter
// data the way each admin tier expects:
//
//   super_admin     → all is_active hospitals (cross-hospital view)
//   department_head → all is_active hospitals (current design — they're
//                     cross-hospital admins; v3 may scope them per-hospital)
//   hospital_admin  → only their primary_hospital_id (per Q9)
//   anyone else     → empty array (caller should treat as 403)
//
// Use AFTER withTenancy already resolved auth+tenancy. This helper is for the
// admin-page-specific scope question (which is broader/narrower than the
// general user_accessible_hospital_ids).
// =============================================================================

import { query } from '@/lib/db';

export interface AdminHospitalScope {
  /** UUIDs the admin can see. Empty array = 403 (no data). */
  hospitalIds: string[];
  /** True if the admin spans all hospitals (super_admin / department_head). */
  isCrossHospital: boolean;
  /** The admin's role for downstream messaging / per-page customization. */
  role: string;
}

export async function getAdminHospitalScope(
  userRole: string,
  primaryHospitalId: string,
): Promise<AdminHospitalScope> {
  if (userRole === 'super_admin' || userRole === 'department_head') {
    // Cross-hospital admins see all is_active hospitals.
    const rows = await query<{ id: string }>(
      `SELECT id::text FROM hospitals WHERE is_active = TRUE`,
    );
    return {
      hospitalIds: rows.map(r => r.id),
      isCrossHospital: true,
      role: userRole,
    };
  }

  if (userRole === 'hospital_admin') {
    // Hospital-scoped admin: just their primary hospital.
    return {
      hospitalIds: [primaryHospitalId],
      isCrossHospital: false,
      role: userRole,
    };
  }

  // Not an admin role — caller should have rejected before reaching here.
  return { hospitalIds: [], isCrossHospital: false, role: userRole };
}

/**
 * Convenience: return true if the role is allowed on the /admin/* surface
 * at all. Mirrors the middleware allow-list in middleware.ts.
 */
export function isAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'department_head' || role === 'hospital_admin';
}
