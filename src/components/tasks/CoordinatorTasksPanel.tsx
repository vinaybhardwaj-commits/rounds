'use client';

// =============================================================================
// Rounds — CoordinatorTasksPanel (25 Apr 2026, Phase 3b)
//
// Surfaces auto-tasks from the `tasks` table inside TasksView. Distinct from
// the existing readiness-items flow (which is also visible in this view) —
// these are workflow-driver tasks scoped per case + role.
//
// Each task row shows: title, patient name, case procedure, due date, source
// pill, and a context-aware action button.
//
// Action button is mapped from source_ref:
//   case:initiate_pac      → 'Schedule PAC' → opens SchedulePacModal
//   case:verify_preop      → 'Open case' → routes to case detail (no inline modal yet)
//   default                → 'Open case' if case_id is set, else no-op
//
// On task action that mutates state (like Schedule PAC), the parent route
// closes the task automatically via the transition route's task-closure side
// effect. We re-fetch on close so the row disappears.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ClipboardList, ExternalLink, Stethoscope } from 'lucide-react';
import SchedulePacModal from '@/components/drawer/SchedulePacModal';

interface TaskRow {
  id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  owner_role: string | null;
  due_at: string | null;
  status: string;
  source: string;
  source_ref: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  hospital_slug: string | null;
  patient_name: string | null;
  patient_thread_id: string | null;
  case_state: string | null;
  case_planned_procedure: string | null;
  case_planned_surgery_date: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

export default function CoordinatorTasksPanel() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pacModalCaseId, setPacModalCaseId] = useState<string | null>(null);
  const [pacModalCaseState, setPacModalCaseState] = useState<string>('draft');
  const [pacModalPatientName, setPacModalPatientName] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/tasks?status=pending&limit=100')
      .then((r) => r.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data)) setRows(body.data);
        else setError(body?.error || 'Failed to load tasks');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openSchedulePac = (task: TaskRow) => {
    if (!task.case_id) return;
    setPacModalCaseId(task.case_id);
    setPacModalCaseState(task.case_state || 'draft');
    setPacModalPatientName(task.patient_name || null);
  };
  const closeSchedulePac = () => {
    setPacModalCaseId(null);
    setPacModalCaseState('draft');
    setPacModalPatientName(null);
  };
  const onScheduled = () => {
    closeSchedulePac();
    reload();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading coordinator tasks…
      </div>
    );
  }
  if (error) {
    return <p className="py-12 text-center text-sm text-red-600">Error: {error}</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-gray-400">
        <ClipboardList size={32} />
        <p className="text-sm">No coordinator tasks pending.</p>
        <p className="text-xs">Auto-tasks from marketing handoffs and case scheduling appear here.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {rows.map((t) => {
          const isInitiatePac = t.source_ref === 'case:initiate_pac';
          const isVerifyPreop = t.source_ref === 'case:verify_preop';
          return (
            <li
              key={t.id}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{t.title}</span>
                    {t.source === 'auto' && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-purple-700">
                        auto
                      </span>
                    )}
                    {t.owner_role && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-700">
                        {t.owner_role.replace(/_/g, ' ')}
                      </span>
                    )}
                    {t.hospital_slug && (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sky-700">
                        {t.hospital_slug}
                      </span>
                    )}
                  </div>
                  {t.patient_name && (
                    <p className="mt-1 text-xs text-gray-700">
                      Patient: <span className="font-medium">{t.patient_name}</span>
                      {t.case_planned_procedure && <> · {t.case_planned_procedure}</>}
                      {t.case_planned_surgery_date && <> · planned {new Date(t.case_planned_surgery_date).toLocaleDateString()}</>}
                    </p>
                  )}
                  {t.description && (
                    <p className="mt-1 text-xs text-gray-600 line-clamp-3">{t.description}</p>
                  )}
                  <p className="mt-1 text-[11px] text-gray-400">
                    {t.due_at ? <>Due {fmt(t.due_at)} · </> : null}created {fmt(t.created_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {isInitiatePac && t.case_id && (
                    <button
                      type="button"
                      onClick={() => openSchedulePac(t)}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Stethoscope size={12} /> Schedule PAC
                    </button>
                  )}
                  {isVerifyPreop && t.case_id && (
                    <a
                      href={`/case/${t.case_id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <ExternalLink size={12} /> Open case
                    </a>
                  )}
                  {!isInitiatePac && !isVerifyPreop && t.case_id && (
                    <a
                      href={`/case/${t.case_id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <ExternalLink size={12} /> Open
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pacModalCaseId && (
        <SchedulePacModal
          caseId={pacModalCaseId}
          patientName={pacModalPatientName}
          currentState={pacModalCaseState}
          isOpen={true}
          onClose={closeSchedulePac}
          onScheduled={onScheduled}
        />
      )}
    </>
  );
}
