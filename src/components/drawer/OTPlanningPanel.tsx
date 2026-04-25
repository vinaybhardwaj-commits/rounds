'use client';

// =============================================================================
// OTPlanningPanel — universal OT/Surgery navigation surface for the patient chart
// 25 Apr 2026
//
// Replaces the older CasePanel which only rendered when a surgical_case existed.
// Diagnosis (V's session 25 Apr): only 3 of 415 active patients had cases →
// 32 admitted+ patients had no OT-planning UI at all. Backfill ran; this panel
// now always renders for those patients.
//
// Behaviors:
//   - Patient at OPD / pre_admission with NO case: render nothing (case isn't
//     relevant yet)
//   - Patient at admitted+ with NO case: render empty state with a "Create
//     surgical case" button (POST /api/cases) — covers any future patient
//     edge case where backfill missed
//   - Patient with an active case: render the state pill + a row of deep-link
//     buttons (Equipment Kanban, Anaesthetist Queue, OT Calendar, Full Case
//     Drawer) + the embedded CaseDrawer (mode="panel") below
//
// Universal: works for every patient — backfilled, future, LSQ-imported,
// Marketing-Handoff-driven, manually-created.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { ExternalLink, Stethoscope, ClipboardList, Calendar, AlertCircle } from 'lucide-react';
// 26 Apr 2026 audit fix (P2-3): client-side nav, no full reload.
import Link from 'next/link';
import CaseDrawer from './CaseDrawer';

interface MinimalCase {
  id: string;
  state: string;
  hospital_slug: string;
  created_at: string;
}

interface OTPlanningPanelProps {
  patientThreadId: string;
  patientStage: string;
}

const STAGES_WITH_OT = new Set([
  'admitted', 'pre_op', 'surgery', 'post_op', 'post_op_care', 'discharge',
]);

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
  const label = state.replace(/_/g, ' ').toUpperCase();
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

export default function OTPlanningPanel({ patientThreadId, patientStage }: OTPlanningPanelProps) {
  const [caseRow, setCaseRow] = useState<MinimalCase | null>(null);
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
          const c = body.data[0] as MinimalCase;
          setCaseRow(c);
        } else {
          setCaseRow(null);
        }
      })
      .catch(() => {
        // Non-fatal — empty state will render
      })
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
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Reload to pick up the new case
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [patientThreadId, load]);

  // Don't render at all on early stages without a case (avoids noise).
  if (!checked) return null;
  if (!caseRow && !STAGES_WITH_OT.has(patientStage)) return null;

  // Empty state: admitted+ but no case (could happen for new patients
  // post-backfill if some ingest path missed creating a case).
  if (!caseRow) {
    return (
      <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <Stethoscope className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-amber-900">No surgical case yet</h3>
            <p className="mt-1 text-xs text-amber-800">
              This patient is at the {patientStage.replace(/_/g, ' ')} stage but doesn&apos;t have a surgical case
              tracking row yet. Create one to start using the OT planning surfaces (PAC, Equipment, OT Calendar).
            </p>
            <button
              type="button"
              onClick={createCase}
              disabled={creating}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-amber-700 bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create surgical case'}
            </button>
            {error && (
              <div className="mt-2 flex items-start gap-1.5 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Populated state: deep-link row + embedded CaseDrawer.
  return (
    <div className="mx-4 mb-3 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-900">OT Planning</h3>
          <StatePill state={caseRow.state} />
        </div>
      </div>

      {/* Deep-link row — quick access to OT surfaces */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3">
        <Link
          href={`/case/${caseRow.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          <ExternalLink className="h-3 w-3" /> Full case view
        </Link>
        <Link
          href="/equipment-kanban"
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          title="View this case in the Equipment Kanban (filter by patient name)"
        >
          <ClipboardList className="h-3 w-3" /> Equipment Kanban
        </Link>
        <Link
          href="/anaesthetist-queue"
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          title="Anaesthetist Queue — pre-PAC + post-PAC publish"
        >
          <Stethoscope className="h-3 w-3" /> Anaesthetist Queue
        </Link>
        <Link
          href="/ot-calendar"
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          title="OT scheduling calendar"
        >
          <Calendar className="h-3 w-3" /> OT Calendar
        </Link>
      </div>

      {/* Embedded CaseDrawer in panel mode — Track 1/2/3 summary */}
      <CaseDrawer
        caseId={caseRow.id}
        mode="panel"
        fullViewHref={`/case/${caseRow.id}`}
      />
    </div>
  );
}
