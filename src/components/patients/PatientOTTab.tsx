'use client';

// =============================================================================
// PatientOTTab — full OT planning view as a dedicated patient-chart tab
// 25 Apr 2026
//
// Sibling to PatientFilesTab. Renders the embedded CaseDrawer (mode="drawer")
// for the patient's active surgical_case, plus a header with state pill +
// quick-action deep links to OT surfaces (Equipment Kanban, Anaesthetist
// Queue, OT Calendar, Full Case View).
//
// State management:
//   - Fetches the patient's active case (same /api/cases query as
//     OTPlanningPanel) and renders accordingly.
//   - If no case exists, shows the same "Create surgical case" empty state
//     as the panel — consistent UX.
//
// This tab is gated by the parent: PatientDetailView only renders the OT tab
// button when the patient is at admitted+ stage OR a case exists. (Avoids
// noise on pre_admission patients.)
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { ExternalLink, ClipboardList, Calendar, Stethoscope, AlertCircle } from 'lucide-react';
// 26 Apr 2026 audit fix (P2-3): client-side nav, no full reload.
import Link from 'next/link';
import CaseDrawer from '../drawer/CaseDrawer';

interface CaseRow {
  id: string;
  state: string;
  hospital_slug: string;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  urgency: string | null;
  created_at: string;
}

interface PatientOTTabProps {
  patientThreadId: string;
  patientName: string;
  patientStage: string;
}

const STATE_TONE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  intake: 'bg-gray-100 text-gray-800',
  pac_scheduled: 'bg-amber-100 text-amber-900',
  pac_done: 'bg-amber-100 text-amber-900',
  fit: 'bg-emerald-100 text-emerald-800',
  fit_conds: 'bg-emerald-100 text-emerald-800',
  defer: 'bg-orange-100 text-orange-800',
  unfit: 'bg-red-100 text-red-800',
  optimizing: 'bg-orange-100 text-orange-800',
  scheduled: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-blue-100 text-blue-800',
  verified: 'bg-indigo-100 text-indigo-800',
  in_theatre: 'bg-purple-100 text-purple-800',
  completed: 'bg-emerald-100 text-emerald-800',
  postponed: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-red-100 text-red-800',
};

function StatePill({ state }: { state: string }) {
  const tone = STATE_TONE[state] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {state.replace(/_/g, ' ').toUpperCase()}
    </span>
  );
}

export function PatientOTTab({ patientThreadId, patientName, patientStage }: PatientOTTabProps) {
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [checked, setChecked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setChecked(false);
    setError(null);
    fetch(`/api/cases?patient_thread_id=${encodeURIComponent(patientThreadId)}&limit=1`)
      .then((r) => r.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data) && body.data.length > 0) {
          setCaseRow(body.data[0] as CaseRow);
        } else {
          setCaseRow(null);
        }
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [patientThreadId]);

  useEffect(() => { load(); }, [load]);

  const createCase = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_thread_id: patientThreadId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [patientThreadId, load]);

  if (!checked) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">Loading OT case…</div>
    );
  }

  if (!caseRow) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <Stethoscope className="h-6 w-6 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-base font-semibold text-amber-900">No surgical case yet</h3>
              <p className="mt-1.5 text-sm text-amber-800">
                {patientName} is at the <strong>{patientStage.replace(/_/g, ' ')}</strong> stage but
                doesn&apos;t have a surgical case tracking row yet. Create one to start using the
                OT planning surfaces (PAC, Equipment, OT Calendar).
              </p>
              <button
                type="button"
                onClick={createCase}
                disabled={creating}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-amber-700 bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create surgical case'}
              </button>
              {error && (
                <div className="mt-3 flex items-start gap-1.5 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Populated state: full embedded CaseDrawer + sticky header with deep-links.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header: state pill + quick metadata + deep-link buttons */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Stethoscope className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900">Surgical Case</h2>
              <StatePill state={caseRow.state} />
              {caseRow.urgency && caseRow.urgency !== 'elective' && (
                <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-800">
                  {caseRow.urgency}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/case/${caseRow.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
              >
                <ExternalLink className="h-3 w-3" /> Full case page
              </Link>
              <Link
                href="/equipment-kanban"
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <ClipboardList className="h-3 w-3" /> Equipment Kanban
              </Link>
              <Link
                href="/anaesthetist-queue"
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Stethoscope className="h-3 w-3" /> Anaesthetist Queue
              </Link>
              <Link
                href="/ot-calendar"
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Calendar className="h-3 w-3" /> OT Calendar
              </Link>
            </div>
          </div>

          {/* Quick metadata row */}
          {(caseRow.planned_procedure || caseRow.planned_surgery_date) && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-600">
              {caseRow.planned_procedure && (
                <span><strong className="text-gray-800">Procedure:</strong> {caseRow.planned_procedure}</span>
              )}
              {caseRow.planned_surgery_date && (
                <span><strong className="text-gray-800">Date:</strong> {new Date(caseRow.planned_surgery_date).toLocaleDateString()}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content: full embedded CaseDrawer in drawer mode (Track 1/2/3 expanded) */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="mx-auto max-w-5xl p-4">
          <CaseDrawer caseId={caseRow.id} mode="drawer" />
        </div>
      </div>
    </div>
  );
}
