'use client';

// =============================================================================
// ClearancesSection — PCW.2 live Clearances panel.
// Same shape as OrdersSection but for pac_clearances.
// =============================================================================

import { useCallback, useState } from 'react';
import { ShieldCheck, Plus, Loader2, Check } from 'lucide-react';
import { AddClearanceModal } from './AddClearanceModal';
import type { PacClearanceRow, PacClearanceStatus, PacMode, PacAppointmentRow } from '@/lib/pac-workspace/types';
import { ScheduleChip } from './v2/ScheduleChip';
import { ScheduleModal } from './v2/ScheduleModal';

const STATUS_CHIP: Record<PacClearanceStatus, string> = {
  requested:               'bg-gray-100 text-gray-700',
  specialist_reviewing:    'bg-blue-100 text-blue-700',
  cleared:                 'bg-green-100 text-green-700',
  cleared_with_conditions: 'bg-amber-100 text-amber-800',
  declined:                'bg-red-100 text-red-700',
  cancelled:               'bg-gray-200 text-gray-600',
};

const STATUS_LABEL: Record<PacClearanceStatus, string> = {
  requested:               'Requested',
  specialist_reviewing:    'Reviewing',
  cleared:                 'Cleared',
  cleared_with_conditions: 'Cleared (cond.)',
  declined:                'Declined',
  cancelled:               'Cancelled',
};

const FORWARD_OPTIONS: PacClearanceStatus[] = [
  'specialist_reviewing', 'cleared', 'cleared_with_conditions', 'declined',
];

interface Props {
  caseId: string;
  clearances: PacClearanceRow[];
  canWrite: boolean;
  pacMode: PacMode;
  onAdded: () => void;
  onUpdated: () => void;
  /** PCW2.7b — when true, renders an inline ScheduleChip per clearance row. */
  appointments?: import('@/lib/pac-workspace/types').PacAppointmentRow[];
}

export function ClearancesSection({ caseId, clearances, canWrite, pacMode, onAdded, onUpdated, appointments = [] }: Props) {
  const [picking, setPicking] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [conditionsForId, setConditionsForId] = useState<string | null>(null);
  const [conditionsDraft, setConditionsDraft] = useState('');

  const patch = useCallback(
    async (clearanceId: string, body: Record<string, unknown>) => {
      setSavingId(clearanceId);
      try {
        const res = await fetch(`/api/pac-workspace/${caseId}/clearances/${clearanceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        onUpdated();
      } catch (e) {
        console.error('clearance patch:', e);
      } finally {
        setSavingId(null);
      }
    },
    [caseId, onUpdated],
  );

  const cleared = clearances.filter(
    (c) => c.status === 'cleared' || c.status === 'cleared_with_conditions',
  ).length;

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <ShieldCheck size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Clearances</h3>
        <span className="text-[11px] text-gray-400">
          {clearances.length > 0 ? `${cleared}/${clearances.length} cleared` : '0 requested'}
        </span>
        {canWrite && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="ml-auto text-xs bg-indigo-600 text-white px-2.5 py-1 rounded inline-flex items-center gap-1 hover:bg-indigo-700"
          >
            <Plus size={11} /> Request clearance
          </button>
        )}
      </header>

      {clearances.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">
          No clearances requested. {canWrite ? 'SOP §6.3 auto-suggests by comorbidity.' : ''}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {clearances.map((c) => {
            const terminal = c.status === 'cleared' || c.status === 'cleared_with_conditions' || c.status === 'declined' || c.status === 'cancelled';
            const editingConditions = conditionsForId === c.id;
            return (
              <li key={c.id} className="border border-gray-100 rounded-md p-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_CHIP[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {c.specialty_label ?? prettySpecialty(c.specialty)}
                      </span>
                      {c.assigned_to_name && (
                        <span className="text-[11px] text-gray-500">→ {c.assigned_to_name}</span>
                      )}
                    </div>
                    {c.conditions_text && (
                      <p className="text-xs text-amber-800 mt-1 bg-amber-50 px-2 py-1 rounded">
                        Conditions: {c.conditions_text}
                      </p>
                    )}
                    {c.notes && <p className="text-xs text-gray-500 mt-1">{c.notes}</p>}
                    {/* PCW2.7b — inline scheduling chip when v2 passes appointments. */}
                    {appointments.length > 0 && (
                      <ClearanceScheduleSlot
                        caseId={caseId}
                        clearanceId={c.id}
                        clearanceLabel={c.specialty_label ?? prettySpecialty(c.specialty)}
                        appointments={appointments}
                        canWrite={canWrite}
                        onChanged={onUpdated}
                      />
                    )}
                  </div>
                  {canWrite && !terminal && (
                    <div className="flex flex-col gap-1">
                      {FORWARD_OPTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={savingId === c.id || c.status === s}
                          onClick={() => {
                            if (s === 'cleared_with_conditions') {
                              setConditionsForId(c.id);
                              setConditionsDraft(c.conditions_text ?? '');
                            } else {
                              patch(c.id, { status: s });
                            }
                          }}
                          className="text-[11px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-0.5 rounded disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {savingId === c.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={savingId === c.id}
                        onClick={() => patch(c.id, { status: 'cancelled' })}
                        className="text-[11px] text-gray-500 hover:text-red-700 px-2 py-0.5 rounded disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {editingConditions && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      autoFocus
                      value={conditionsDraft}
                      onChange={(e) => setConditionsDraft(e.target.value)}
                      placeholder="Conditions (e.g. continue ramipril, hold metformin)"
                      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        await patch(c.id, { status: 'cleared_with_conditions', conditions_text: conditionsDraft });
                        setConditionsForId(null);
                      }}
                      className="text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700"
                    >
                      Save conditions
                    </button>
                    <button
                      type="button"
                      onClick={() => setConditionsForId(null)}
                      className="text-xs text-gray-500 hover:text-gray-700"
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
        <AddClearanceModal
          caseId={caseId}
          pacMode={pacMode}
          alreadyAdded={new Set(clearances.map((c) => c.specialty))}
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

function prettySpecialty(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// PCW2.7b — Inline scheduling slot inside a clearance row. Mounts a
// ScheduleChip + ScheduleModal scoped to this clearance.
function ClearanceScheduleSlot({
  caseId,
  clearanceId,
  clearanceLabel,
  appointments,
  canWrite,
  onChanged,
}: {
  caseId: string;
  clearanceId: string;
  clearanceLabel: string;
  appointments: PacAppointmentRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [scheduling, setScheduling] = useState<{ existing: PacAppointmentRow | null } | null>(null);
  const matching = appointments.filter(
    (a) => a.parent_type === 'clearance' && a.parent_id === clearanceId
  );
  const current =
    matching.length > 0
      ? matching.reduce((best, a) =>
          (a.scheduled_at ?? '') > (best.scheduled_at ?? '') ? a : best
        )
      : null;
  return (
    <div className="mt-1.5">
      <ScheduleChip
        caseId={caseId}
        appointment={current}
        canWrite={canWrite}
        onSchedule={() => setScheduling({ existing: null })}
        onReschedule={(a) => setScheduling({ existing: a })}
        onChanged={onChanged}
      />
      {scheduling && (
        <ScheduleModal
          caseId={caseId}
          parent_type="clearance"
          parent_id={clearanceId}
          parent_label={clearanceLabel}
          existing={scheduling.existing}
          onClose={() => setScheduling(null)}
          onSubmitted={() => {
            setScheduling(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
