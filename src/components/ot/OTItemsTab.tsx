'use client';

// ============================================
// OTItemsTab — Action-first OT readiness items
// for the current user. Grouped by surgery date.
// One-tap confirm, bulk confirm for coordinators.
// Embedded inside TasksView as a sub-tab.
// ============================================

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Check, CheckCheck, AlertTriangle, ChevronDown, ChevronUp, Clock, User } from 'lucide-react';
import type { OTReadinessItem } from '@/types';
import { OT_ITEM_STATUS_LABELS, OT_CATEGORY_LABELS } from '@/types';

interface OTItem extends OTReadinessItem {
  // Joined fields from the API
  procedure_name?: string;
  patient_name?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  ot_room?: number;
  primary_surgeon_name?: string;
}

interface OTItemsTabProps {
  userRole: string;
  userId: string;
  onNavigateToPatient?: (patientThreadId: string) => void;
}

// Roles that can bulk confirm
const COORDINATOR_ROLES = ['ot_coordinator', 'super_admin', 'department_head'];

export function OTItemsTab({ userRole, userId, onNavigateToPatient }: OTItemsTabProps) {
  const [items, setItems] = useState<OTItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);

  const canBulkConfirm = COORDINATOR_ROLES.includes(userRole);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/ot/readiness/mine');
      const data = await res.json();
      if (data.success) {
        setItems(data.data?.items || data.data || []);
      }
    } catch (err) {
      console.error('[OTItemsTab] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // ── Group by surgery date ──
  const groupedByDate = useMemo(() => {
    const map = new Map<string, OTItem[]>();
    for (const item of items) {
      const rawDate = item.scheduled_date || 'Unknown';
      const date = rawDate !== 'Unknown' && rawDate.length > 10 ? rawDate.slice(0, 10) : rawDate;
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(item);
    }
    // Sort dates ascending
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [items]);

  // ── Confirm single item ──
  const handleConfirm = useCallback(async (itemId: string) => {
    setConfirmingId(itemId);
    try {
      const res = await fetch(`/api/ot/readiness/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
      const data = await res.json();
      if (data.success) {
        // Remove from local list
        setItems(prev => prev.filter(i => i.id !== itemId));
        // Notify AppShell to refresh badge count
        window.dispatchEvent(new Event('ot-items-changed'));
      }
    } catch (err) {
      console.error('[OTItemsTab] confirm error:', err);
    } finally {
      setConfirmingId(null);
    }
  }, []);

  // ── Bulk confirm ──
  const handleBulkConfirm = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkConfirming(true);

    // Group by surgery_posting_id for the bulk API
    const byPosting = new Map<string, string[]>();
    for (const item of items) {
      if (selectedIds.has(item.id)) {
        const postingId = item.surgery_posting_id;
        if (!byPosting.has(postingId)) byPosting.set(postingId, []);
        byPosting.get(postingId)!.push(item.id);
      }
    }

    try {
      await Promise.all(
        [...byPosting.entries()].map(([postingId, itemIds]) =>
          fetch('/api/ot/readiness/bulk-confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surgery_posting_id: postingId, item_ids: itemIds }),
          })
        )
      );
      // Remove confirmed items
      setItems(prev => prev.filter(i => !selectedIds.has(i.id)));
      setSelectedIds(new Set());
      setBulkMode(false);
      // Notify AppShell to refresh badge count
      window.dispatchEvent(new Event('ot-items-changed'));
    } catch (err) {
      console.error('[OTItemsTab] bulk confirm error:', err);
    } finally {
      setBulkConfirming(false);
    }
  }, [items, selectedIds]);

  // ── Toggle select ──
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.filter(i => i.status === 'pending').map(i => i.id)));
  }, [items]);

  // Pending count
  const pendingCount = items.filter(i => i.status === 'pending').length;

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-20" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-8 text-center">
        <Check size={32} className="text-green-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-600">All clear!</p>
        <p className="text-xs text-gray-400 mt-1">No OT items need your action</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Bulk action bar */}
      {canBulkConfirm && pendingCount > 1 && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between shrink-0">
          {bulkMode ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="text-[11px] font-medium text-blue-700 underline"
                >
                  Select all ({pendingCount})
                </button>
                <span className="text-[11px] text-blue-500">
                  {selectedIds.size} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setBulkMode(false); setSelectedIds(new Set()); }}
                  className="text-[11px] text-gray-500 px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkConfirm}
                  disabled={selectedIds.size === 0 || bulkConfirming}
                  className="flex items-center gap-1 text-[11px] font-medium text-white bg-green-600 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  <CheckCheck size={12} />
                  {bulkConfirming ? 'Confirming...' : `Confirm ${selectedIds.size}`}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setBulkMode(true)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-blue-700"
            >
              <CheckCheck size={13} />
              Bulk Confirm
            </button>
          )}
        </div>
      )}

      {/* Items grouped by date */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {[...groupedByDate.entries()].map(([date, dateItems]) => (
          <DateGroup
            key={date}
            date={date}
            items={dateItems}
            bulkMode={bulkMode}
            selectedIds={selectedIds}
            confirmingId={confirmingId}
            onConfirm={handleConfirm}
            onToggleSelect={toggleSelect}
            onNavigateToPatient={onNavigateToPatient}
          />
        ))}
      </div>
    </div>
  );
}


// ── Date group with collapsible header ──

function DateGroup({
  date,
  items,
  bulkMode,
  selectedIds,
  confirmingId,
  onConfirm,
  onToggleSelect,
  onNavigateToPatient,
}: {
  date: string;
  items: OTItem[];
  bulkMode: boolean;
  selectedIds: Set<string>;
  confirmingId: string | null;
  onConfirm: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onNavigateToPatient?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const pendingCount = items.filter(i => i.status === 'pending').length;

  const displayDate = (() => {
    const today = new Date();
    const d = new Date(date + 'T00:00:00');
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const tom = new Date(today);
    tom.setDate(tom.getDate() + 1);
    const tomStr = `${tom.getFullYear()}-${String(tom.getMonth() + 1).padStart(2, '0')}-${String(tom.getDate()).padStart(2, '0')}`;
    if (date === todayStr) return 'Today';
    if (date === tomStr) return 'Tomorrow';
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  })();

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-1.5"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-600">{displayDate}</span>
          {pendingCount > 0 && (
            <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp size={14} className="text-gray-400" />
          : <ChevronDown size={14} className="text-gray-400" />
        }
      </button>

      {expanded && (
        <div className="space-y-2">
          {items.map(item => (
            <OTItemCard
              key={item.id}
              item={item}
              bulkMode={bulkMode}
              isSelected={selectedIds.has(item.id)}
              isConfirming={confirmingId === item.id}
              onConfirm={onConfirm}
              onToggleSelect={onToggleSelect}
              onNavigateToPatient={onNavigateToPatient}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ── Single OT item card ──

function OTItemCard({
  item,
  bulkMode,
  isSelected,
  isConfirming,
  onConfirm,
  onToggleSelect,
  onNavigateToPatient,
}: {
  item: OTItem;
  bulkMode: boolean;
  isSelected: boolean;
  isConfirming: boolean;
  onConfirm: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onNavigateToPatient?: (id: string) => void;
}) {
  const isPending = item.status === 'pending';
  const isOverdue = isPending && item.due_by && new Date(item.due_by) < new Date();
  const categoryLabel = OT_CATEGORY_LABELS[item.item_category] || item.item_category;

  return (
    <div
      className={`bg-white rounded-xl border p-3 transition-colors ${
        isOverdue ? 'border-red-200 bg-red-50/30' : 'border-gray-100'
      } ${isSelected ? 'ring-2 ring-blue-300' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* Bulk select checkbox */}
        {bulkMode && isPending && (
          <button
            onClick={() => onToggleSelect(item.id)}
            className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
              isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
            }`}
          >
            {isSelected && <Check size={12} className="text-white" />}
          </button>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] font-medium text-gray-400 uppercase">{categoryLabel}</span>
            {isOverdue && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-600">
                <AlertTriangle size={10} />
                Overdue
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-gray-900">{item.item_label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
            {item.procedure_name && <span className="truncate">{item.procedure_name}</span>}
            {item.patient_name && <span className="truncate max-w-[120px]">{item.patient_name}</span>}
            {item.scheduled_time && (
              <span className="flex items-center gap-0.5">
                <Clock size={9} /> {String(item.scheduled_time).slice(0, 5)}
              </span>
            )}
            {item.ot_room && <span>OT{item.ot_room}</span>}
          </div>
        </div>

        {/* Action button */}
        {isPending && !bulkMode && (
          <button
            onClick={() => onConfirm(item.id)}
            disabled={isConfirming}
            className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
          >
            <Check size={12} />
            {isConfirming ? '...' : 'Confirm'}
          </button>
        )}

        {/* Non-pending status */}
        {!isPending && (
          <span className="shrink-0 text-[10px] font-medium text-gray-400 px-2 py-1">
            {OT_ITEM_STATUS_LABELS[item.status] || item.status}
          </span>
        )}
      </div>
    </div>
  );
}
