// ============================================
// OT Surgery Readiness — Status Computation
// ============================================

import type { OTReadinessItem, OTReadinessItemStatus, OverallReadiness } from '@/types';

/**
 * Compute overall readiness from individual item statuses.
 * Priority: blocked > flagged > pending > all confirmed = ready
 */
export function computeOverallReadiness(items: Pick<OTReadinessItem, 'status'>[]): OverallReadiness {
  const active = items.filter(i => i.status !== 'not_applicable');

  if (active.length === 0) return 'not_ready';
  if (active.some(i => i.status === 'blocked')) return 'blocked';
  if (active.some(i => i.status === 'flagged')) return 'not_ready';
  if (active.some(i => i.status === 'pending')) return 'partial';
  if (active.every(i => i.status === 'confirmed')) return 'ready';

  return 'not_ready';
}

/**
 * Count items by status for donut chart / progress display.
 */
export function countByStatus(items: Pick<OTReadinessItem, 'status'>[]): Record<OTReadinessItemStatus, number> {
  const counts: Record<OTReadinessItemStatus, number> = {
    pending: 0, confirmed: 0, not_applicable: 0, flagged: 0, blocked: 0,
  };
  for (const item of items) {
    counts[item.status]++;
  }
  return counts;
}

/**
 * Get confirmed/total counts (excluding N/A) for progress display.
 */
export function getReadinessProgress(items: Pick<OTReadinessItem, 'status'>[]): {
  confirmed: number;
  total: number;
  percentage: number;
} {
  const active = items.filter(i => i.status !== 'not_applicable');
  const confirmed = active.filter(i => i.status === 'confirmed').length;
  const total = active.length;
  return {
    confirmed,
    total,
    percentage: total === 0 ? 0 : Math.round((confirmed / total) * 100),
  };
}

/**
 * Check if all items for a specific role are confirmed.
 */
export function isRoleComplete(items: Pick<OTReadinessItem, 'status' | 'responsible_role'>[], role: string): boolean {
  const roleItems = items.filter(i => i.responsible_role === role && i.status !== 'not_applicable');
  return roleItems.length > 0 && roleItems.every(i => i.status === 'confirmed');
}
