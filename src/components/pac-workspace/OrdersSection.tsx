'use client';

// =============================================================================
// OrdersSection — PCW.2 live Orders panel
//
// Renders pac_orders rows with status chips + per-row status menu. Header
// shows "+ Add orders" → opens AddOrderModal (multi-select picker with SOP
// auto-suggest).
// =============================================================================

import { useCallback, useState } from 'react';
import { FlaskConical, Plus, Loader2, Check } from 'lucide-react';
import { AddOrderModal } from './AddOrderModal';
import type { PacOrderRow, PacOrderStatus, PacMode } from '@/lib/pac-workspace/types';

const ORDER_STATUS_FLOW: PacOrderStatus[] = ['requested', 'sample_drawn', 'in_lab', 'reported', 'reviewed'];

const STATUS_CHIP: Record<PacOrderStatus, string> = {
  requested:    'bg-gray-100 text-gray-700',
  sample_drawn: 'bg-amber-100 text-amber-800',
  in_lab:       'bg-blue-100 text-blue-700',
  reported:     'bg-indigo-100 text-indigo-700',
  reviewed:     'bg-green-100 text-green-700',
  cancelled:    'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<PacOrderStatus, string> = {
  requested:    'Requested',
  sample_drawn: 'Sample drawn',
  in_lab:       'In lab',
  reported:     'Reported',
  reviewed:     'Reviewed',
  cancelled:    'Cancelled',
};

interface Props {
  caseId: string;
  orders: PacOrderRow[];
  canWrite: boolean;
  pacMode: PacMode;
  onAdded: () => void;
  onUpdated: () => void;
  /**
   * PCW2.5 — when true, hide rows with kind='diagnostic'. v2 workspace
   * renders DiagnosticsSection above OrdersSection, so the orders list
   * here should only show kind='order' (or null for legacy rows).
   */
  excludeDiagnostic?: boolean;
}

export function OrdersSection({ caseId, orders: rawOrders, canWrite, pacMode, onAdded, onUpdated, excludeDiagnostic = false }: Props) {
  const orders = excludeDiagnostic
    ? rawOrders.filter((o) => o.kind !== 'diagnostic')
    : rawOrders;
  const [picking, setPicking] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const advance = useCallback(
    async (orderId: string, nextStatus: PacOrderStatus) => {
      setSavingId(orderId);
      try {
        const res = await fetch(`/api/pac-workspace/${caseId}/orders/${orderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        onUpdated();
      } catch (e) {
        console.error('orders patch:', e);
      } finally {
        setSavingId(null);
      }
    },
    [caseId, onUpdated],
  );

  const total = orders.length;
  const reviewed = orders.filter((o) => o.status === 'reviewed').length;

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <FlaskConical size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Orders</h3>
        <span className="text-[11px] text-gray-400">{total > 0 ? `${reviewed}/${total} reviewed` : '0 ordered'}</span>
        {canWrite && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="ml-auto text-xs bg-indigo-600 text-white px-2.5 py-1 rounded inline-flex items-center gap-1 hover:bg-indigo-700"
          >
            <Plus size={11} /> Add orders
          </button>
        )}
      </header>

      {orders.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No orders yet. {canWrite ? 'Add ASA-driven orders per SOP §6.2.' : ''}</p>
      ) : (
        <ul className="space-y-1.5">
          {orders.map((o) => {
            const idx = ORDER_STATUS_FLOW.indexOf(o.status);
            const next = idx >= 0 && idx < ORDER_STATUS_FLOW.length - 1 ? ORDER_STATUS_FLOW[idx + 1] : null;
            const terminal = o.status === 'reviewed' || o.status === 'cancelled';
            return (
              <li key={o.id} className="border border-gray-100 rounded-md p-2 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_CHIP[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">{o.order_label ?? prettyOrderType(o.order_type)}</span>
                  </div>
                  {o.notes && <p className="text-xs text-gray-500 mt-1 truncate">{o.notes}</p>}
                  {o.result_text && (
                    <p className="text-xs text-gray-700 mt-1">
                      <span className="text-gray-400">Result:</span> {o.result_text}
                    </p>
                  )}
                </div>
                {canWrite && !terminal && (
                  <div className="flex flex-col gap-1">
                    {next && (
                      <button
                        type="button"
                        disabled={savingId === o.id}
                        onClick={() => advance(o.id, next)}
                        className="text-[11px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-0.5 rounded disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {savingId === o.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                        Mark {STATUS_LABEL[next].toLowerCase()}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={savingId === o.id}
                      onClick={() => advance(o.id, 'cancelled')}
                      className="text-[11px] text-gray-500 hover:text-red-700 px-2 py-0.5 rounded disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {picking && (
        <AddOrderModal
          caseId={caseId}
          pacMode={pacMode}
          alreadyAdded={new Set(orders.map((o) => o.order_type))}
          onClose={() => setPicking(false)}
          onSaved={() => {
            setPicking(false);
            onAdded();
          }}
        />
      )}
    </section>
  );
}

function prettyOrderType(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
