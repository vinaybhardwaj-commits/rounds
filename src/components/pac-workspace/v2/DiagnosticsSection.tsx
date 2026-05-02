'use client';

// =============================================================================
// DiagnosticsSection — PCW2.5
//
// Splits diagnostic-kind pac_orders rows out of the v1 OrdersSection. Renders
// per-row: order label, status chip, result preview (if present), and an
// "Enter result" CTA. Clicking the CTA opens ResultEntryModal which:
//   1. POSTs to /orders/[orderId]/result with type-aware input
//   2. Backend writes pac_facts → fires Layer 3 cutoff rules (PCW2.2)
//   3. Inbox reloads to surface any new ASA-review / defer suggestions
//
// Mounted by PACWorkspaceView when usePacWorkspaceV2Enabled() is true.
// =============================================================================

import { useState } from 'react';
import { FlaskConical, CheckCircle2 } from 'lucide-react';
import type { PacOrderRow } from '@/lib/pac-workspace/types';
import {
  getResultMapping,
  FREE_TEXT_FALLBACK,
} from '@/lib/pac-workspace/result-mapping';
import { ResultEntryModal } from './ResultEntryModal';

interface Props {
  caseId: string;
  orders: PacOrderRow[];
  canWrite: boolean;
  onUpdated: () => void;
}

const STATUS_CHIP: Record<string, string> = {
  requested: 'bg-gray-100 text-gray-700',
  sample_drawn: 'bg-amber-100 text-amber-800',
  in_lab: 'bg-blue-100 text-blue-700',
  reported: 'bg-indigo-100 text-indigo-700',
  reviewed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  sample_drawn: 'Sample drawn',
  in_lab: 'In lab',
  reported: 'Reported',
  reviewed: 'Reviewed',
  cancelled: 'Cancelled',
};

function previewValue(o: PacOrderRow): string | null {
  const v = o.result_value as Record<string, unknown> | null | undefined;
  if (!v) return null;
  const shape = v.shape as string | undefined;
  if (shape === 'numeric' && typeof v.value === 'number') {
    const mapping = getResultMapping(o.order_type);
    const unit = mapping?.unit ? ` ${mapping.unit}` : '';
    return `${v.value}${unit}`;
  }
  if (shape === 'numeric_pair') {
    return `${v.systolic}/${v.diastolic} mmHg`;
  }
  if (shape === 'abnormality') {
    return v.abnormal ? 'Abnormal' : 'Normal';
  }
  if (shape === 'free_text_with_abnormality') {
    const flag = v.abnormal ? ' · ⚠️ abnormal' : '';
    return `${(v.text as string) ?? '(no text)'}${flag}`;
  }
  if (shape === 'free_text' && typeof v.text === 'string') {
    return v.text;
  }
  // already_done evidence shape from PCW2.4b ({text: '7.2'})
  if (typeof v.text === 'string') return v.text;
  return null;
}

export function DiagnosticsSection({ caseId, orders, canWrite, onUpdated }: Props) {
  const [modalOrder, setModalOrder] = useState<PacOrderRow | null>(null);
  const diagnostics = orders.filter((o) => o.kind === 'diagnostic');

  if (diagnostics.length === 0) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <header className="flex items-center gap-2 mb-2">
          <FlaskConical size={16} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800">Diagnostics</h3>
          <span className="ml-auto text-[11px] text-gray-400">0 diagnostic orders</span>
        </header>
        <p className="text-xs text-gray-500">
          No diagnostic orders yet. Accept a Smart Suggestion above to add CBC, RFT,
          ECG, etc. — or use the manual Add picker in the Orders section below.
        </p>
      </section>
    );
  }

  const reviewed = diagnostics.filter((o) => o.status === 'reviewed' || o.status === 'reported').length;

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <FlaskConical size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Diagnostics</h3>
        <span className="ml-auto text-[11px] text-gray-500">
          {reviewed}/{diagnostics.length} with results
        </span>
      </header>

      <ul className="divide-y divide-gray-100">
        {diagnostics.map((o) => {
          const mapping = getResultMapping(o.order_type) ?? FREE_TEXT_FALLBACK;
          const preview = previewValue(o);
          const hasResult = !!o.result_value || !!o.result_received_at;
          const status = (o.status as keyof typeof STATUS_CHIP) ?? 'requested';

          return (
            <li key={o.id} className="flex items-start gap-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">
                    {o.order_label || mapping.label || o.order_type}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${STATUS_CHIP[status] ?? STATUS_CHIP.requested}`}>
                    {STATUS_LABEL[status] ?? status}
                  </span>
                  {hasResult && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-700">
                      <CheckCircle2 size={11} /> result captured
                    </span>
                  )}
                </div>
                {preview && (
                  <div className="mt-0.5 text-xs text-gray-700 font-mono">
                    {preview}
                  </div>
                )}
                {o.notes && (
                  <div className="mt-0.5 text-[11px] text-gray-500 italic">
                    {o.notes}
                  </div>
                )}
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setModalOrder(o)}
                  disabled={!canWrite}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {hasResult ? 'Update result' : 'Enter result'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {modalOrder && (
        <ResultEntryModal
          caseId={caseId}
          order={modalOrder}
          onClose={() => setModalOrder(null)}
          onSubmitted={() => {
            setModalOrder(null);
            onUpdated();
          }}
        />
      )}
    </section>
  );
}
