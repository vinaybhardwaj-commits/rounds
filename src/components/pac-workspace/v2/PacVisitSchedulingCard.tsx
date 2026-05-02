'use client';

// =============================================================================
// PacVisitSchedulingCard — PCW2.7b
//
// Top-of-workspace card that schedules the actual PAC visit appointment
// (parent_type='pac_visit', parent_id=NULL). Distinct from v1's Mode picker
// which captures *how* the PAC happens; this captures *when* + *who*.
//
// PRD §15.3: "Coordinator schedules PAC visit for 4 May 14:00 with
// Dr. Manukumar, in-person OPD → pac_appointments row".
// =============================================================================

import { useState } from 'react';
import { Stethoscope } from 'lucide-react';
import type { PacAppointmentRow } from '@/lib/pac-workspace/types';
import { ScheduleChip } from './ScheduleChip';
import { ScheduleModal } from './ScheduleModal';

interface Props {
  caseId: string;
  appointments: PacAppointmentRow[];
  canWrite: boolean;
  onUpdated: () => void;
}

export function PacVisitSchedulingCard({ caseId, appointments, canWrite, onUpdated }: Props) {
  const [scheduling, setScheduling] = useState<{ existing: PacAppointmentRow | null } | null>(null);

  // Latest non-cancelled, non-rescheduled pac_visit appointment.
  const visitAppointments = appointments.filter((a) => a.parent_type === 'pac_visit');
  const current = visitAppointments.length > 0
    ? visitAppointments.reduce((best, a) =>
        (a.scheduled_at ?? '') > (best.scheduled_at ?? '') ? a : best
      )
    : null;

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Stethoscope size={16} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800">PAC visit</h3>
          {!current && (
            <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
              Not scheduled
            </span>
          )}
        </div>
        <ScheduleChip
          caseId={caseId}
          appointment={current}
          canWrite={canWrite}
          onSchedule={() => setScheduling({ existing: null })}
          onReschedule={(a) => setScheduling({ existing: a })}
          onChanged={onUpdated}
        />
      </header>
      <p className="text-xs text-gray-500">
        Schedule the anaesthetist&apos;s PAC visit. Distinct from the PAC
        mode picker below — pick the date / time / provider here so the
        deadline strip and (PCW2.8) GetStream system messages can fire.
      </p>

      {scheduling && (
        <ScheduleModal
          caseId={caseId}
          parent_type="pac_visit"
          parent_id={null}
          parent_label="PAC visit"
          existing={scheduling.existing}
          onClose={() => setScheduling(null)}
          onSubmitted={() => {
            setScheduling(null);
            onUpdated();
          }}
        />
      )}
    </section>
  );
}
