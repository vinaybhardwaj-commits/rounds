'use client';

// ============================================
// ReadinessAccordion — Category accordion sections
// with role-aware auto-expand, confirm buttons,
// and audit detail for confirmed items.
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, AlertTriangle, Ban, Minus, RotateCcw } from 'lucide-react';
import type { OTReadinessItem } from '@/types';
import { OT_CATEGORY_LABELS, OT_ITEM_STATUS_COLORS, OT_ITEM_STATUS_ICONS } from '@/types';

interface ReadinessAccordionProps {
  items: OTReadinessItem[];
  userRole: string;
  userId: string;
  surgeryPostingId: string;
  onRefresh: () => void;
}

interface CategoryGroup {
  category: string;
  label: string;
  items: OTReadinessItem[];
  confirmed: number;
  total: number; // excludes N/A
  allDone: boolean;
  hasMyItems: boolean;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  confirmed: <Check size={12} className="text-green-600" />,
  pending: <span className="w-3 h-3 rounded-full border-2 border-amber-400 inline-block" />,
  flagged: <AlertTriangle size={12} className="text-red-500" />,
  blocked: <Ban size={12} className="text-red-600" />,
  not_applicable: <Minus size={12} className="text-gray-400" />,
};

export function ReadinessAccordion({
  items,
  userRole,
  userId,
  surgeryPostingId,
  onRefresh,
}: ReadinessAccordionProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmNotes, setConfirmNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Group items by category
  const groups: CategoryGroup[] = React.useMemo(() => {
    const map = new Map<string, OTReadinessItem[]>();
    for (const item of items) {
      const cat = item.item_category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }

    const result: CategoryGroup[] = [];
    for (const [category, catItems] of map) {
      const activeItems = catItems.filter(i => i.status !== 'not_applicable');
      const confirmed = activeItems.filter(i => i.status === 'confirmed').length;
      const hasMyItems = catItems.some(i =>
        i.status === 'pending' &&
        (i.responsible_role === userRole || i.responsible_user_id === userId)
      );

      result.push({
        category,
        label: OT_CATEGORY_LABELS[category as keyof typeof OT_CATEGORY_LABELS] || category,
        items: catItems.sort((a, b) => a.sort_order - b.sort_order),
        confirmed,
        total: activeItems.length,
        allDone: confirmed === activeItems.length && activeItems.length > 0,
        hasMyItems,
      });
    }

    return result;
  }, [items, userRole, userId]);

  // Auto-expand categories with my pending items on mount
  useEffect(() => {
    const autoExpand = new Set<string>();
    for (const g of groups) {
      if (g.hasMyItems) autoExpand.add(g.category);
    }
    if (autoExpand.size > 0) setExpandedCategories(autoExpand);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const isMyItem = (item: OTReadinessItem) =>
    item.responsible_role === userRole || item.responsible_user_id === userId;

  const handleAction = useCallback(async (itemId: string, action: string, opts?: Record<string, unknown>) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/ot/readiness/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...opts }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setConfirmingId(null);
      setConfirmNotes('');
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  }, [onRefresh]);

  return (
    <div className="space-y-1">
      {groups.map(group => {
        const isOpen = expandedCategories.has(group.category);
        return (
          <div key={group.category}>
            {/* Category header */}
            <button
              onClick={() => toggleCategory(group.category)}
              className="w-full flex items-center justify-between py-2 px-1 text-left hover:bg-gray-50 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  size={14}
                  className={`text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                />
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  {group.label}
                </span>
                <span className="text-[10px] text-gray-400">
                  ({group.confirmed}/{group.total})
                </span>
              </div>
              {group.allDone && (
                <span className="text-[10px] text-green-600 font-medium">✅</span>
              )}
              {group.hasMyItems && !group.allDone && (
                <span className="text-[10px] text-amber-600 font-medium">Action needed</span>
              )}
            </button>

            {/* Items list */}
            {isOpen && (
              <div className="pl-5 pb-2 space-y-0.5">
                {group.items.map(item => {
                  const isMine = isMyItem(item);
                  const isConfirming = confirmingId === item.id;

                  return (
                    <div key={item.id} className="py-1.5">
                      <div className="flex items-start gap-2">
                        {/* Status icon */}
                        <span className="mt-0.5 shrink-0">
                          {STATUS_ICONS[item.status] || STATUS_ICONS.pending}
                        </span>

                        {/* Item content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs ${item.status === 'confirmed' ? 'text-gray-500' : 'text-gray-800'}`}>
                              {item.item_label}
                            </span>
                            {item.is_dynamic && (
                              <span className="text-[9px] bg-blue-50 text-blue-600 px-1 rounded">added</span>
                            )}
                          </div>

                          {/* Confirmed details */}
                          {item.status === 'confirmed' && item.confirmed_by_name && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {item.confirmed_by_name}
                              {item.confirmed_at && `, ${new Date(item.confirmed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                              {item.asa_score_given && ` · ASA ${item.asa_score_given}`}
                            </p>
                          )}
                          {item.confirmation_notes && item.status === 'confirmed' && (
                            <p className="text-[10px] text-gray-400 italic mt-0.5">{item.confirmation_notes}</p>
                          )}

                          {/* Flagged/blocked detail */}
                          {(item.status === 'flagged' || item.status === 'blocked') && item.status_detail && (
                            <p className="text-[10px] text-red-500 mt-0.5">{item.status_detail}</p>
                          )}

                          {/* Pending due info */}
                          {item.status === 'pending' && item.due_by && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {item.responsible_role && <span>{item.responsible_role} · </span>}
                              {new Date(item.due_by) < new Date()
                                ? <span className="text-red-500 font-medium">overdue</span>
                                : <span>due {formatTimeUntil(new Date(item.due_by))}</span>
                              }
                              {item.escalated && <span className="text-red-500 ml-1">⚠ L{item.escalation_level}</span>}
                            </p>
                          )}

                          {/* Inline confirm dialog */}
                          {isConfirming && (
                            <div className="mt-2 bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                              <p className="text-xs font-medium text-gray-700 mb-1.5">
                                Confirm &ldquo;{item.item_label}&rdquo;?
                              </p>
                              <input
                                type="text"
                                placeholder="Notes (optional)"
                                value={confirmNotes}
                                onChange={e => setConfirmNotes(e.target.value)}
                                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 mb-2 focus:outline-none focus:border-blue-300"
                              />
                              {actionError && (
                                <p className="text-[10px] text-red-500 mb-1.5">{actionError}</p>
                              )}
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => { setConfirmingId(null); setConfirmNotes(''); setActionError(null); }}
                                  className="text-xs text-gray-500 px-3 py-1 rounded-lg hover:bg-gray-100"
                                  disabled={actionLoading}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleAction(item.id, 'confirm', { notes: confirmNotes || undefined })}
                                  disabled={actionLoading}
                                  className="text-xs font-medium text-white bg-green-600 px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50"
                                >
                                  {actionLoading ? 'Confirming...' : 'Confirm ✓'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action button — only for my pending items */}
                        {item.status === 'pending' && isMine && !isConfirming && (
                          <button
                            onClick={() => { setConfirmingId(item.id); setActionError(null); }}
                            className="shrink-0 text-[11px] font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors"
                          >
                            Confirm ✓
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTimeUntil(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const hours = Math.round(diff / (1000 * 60 * 60));
  if (hours < 1) return 'in < 1h';
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
