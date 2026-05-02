'use client';

// =============================================================================
// PACWorkspaceView — PCW.1 client surface
//
// Fetches /api/pac-workspace/[caseId] on mount and renders:
//   • Pin banner with patient identity, case state, urgency, hospital
//   • SLA chip (green / amber / red, computed client-side from sla_deadline_at)
//   • Mode picker (LIVE in PCW.1) — PUT /api/pac-workspace/[caseId]/mode
//   • Disabled placeholder sections for Orders / Clearances / Checklist /
//     Exam / Publish (PCW.2-4 wire each in turn).
//   • Back link to /ot-management (preserves OT module nav)
//
// PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Stethoscope,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Lock,
  Clock,
  FlaskConical,
  ShieldCheck,
  ListChecks,
  ClipboardCheck,
} from 'lucide-react';
import {
  PAC_MODE_LABELS,
  VALID_PAC_MODES,
  type PacMode,
  type PacWorkspacePayload,
} from '@/lib/pac-workspace/types';
import { OrdersSection } from './OrdersSection';
import { ClearancesSection } from './ClearancesSection';
import { ChecklistSection } from './ChecklistSection';
import { AnaesthetistPublishSection } from './AnaesthetistPublishSection';
import { SuggestionsInbox } from './v2/SuggestionsInbox';
import { DiagnosticsSection } from './v2/DiagnosticsSection';
import { PacVisitSchedulingCard } from './v2/PacVisitSchedulingCard';
import { usePacWorkspaceV2Enabled } from '@/components/FeatureFlagsProvider';

const PAC_WRITE_ROLES = new Set([
  'super_admin',
  'ip_coordinator',
  'pac_coordinator',
  'anesthesiologist',
]);

interface Props {
  caseId: string;
  userRole: string;
}

export function PACWorkspaceView({ caseId, userRole }: Props) {
  const [payload, setPayload] = useState<PacWorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const canWrite = PAC_WRITE_ROLES.has(userRole);
  const v2Enabled = usePacWorkspaceV2Enabled();
  // PCW2.6 — bumped on every workspace reload so SuggestionsInbox refetches.
  // Fixes the PCW2.5 paper-cut where result entry didn't trigger inbox reload.
  const [inboxReloadKey, setInboxReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pac-workspace/${caseId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setPayload(json.data as PacWorkspacePayload);
      // PCW2.6 — bump inbox reload key so SuggestionsInbox refetches its
      // own /suggestions endpoint after every PACWorkspaceView reload.
      setInboxReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const setMode = useCallback(
    async (mode: PacMode) => {
      if (!canWrite) return;
      setSavingMode(true);
      setError(null);
      try {
        const res = await fetch(`/api/pac-workspace/${caseId}/mode`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        // Re-fetch full payload so checklist_state reflects re-seed.
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingMode(false);
      }
    },
    [canWrite, caseId, load],
  );

  if (loading && !payload) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading PAC workspace…
        </div>
      </main>
    );
  }

  if (error && !payload) {
    return <ErrorPanel caseId={caseId} message={error} onRetry={load} />;
  }

  if (!payload) {
    return <ErrorPanel caseId={caseId} message="Workspace returned no data." onRetry={load} />;
  }

  const { patient, progress } = payload;
  const sla = sla_status(progress.sla_deadline_at);
  const ageSex = patient.age && patient.gender ? `${patient.gender.charAt(0).toUpperCase()}/${patient.age}` : '';

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/?tab=ot"
            className="text-sm text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
            aria-label="Back to OT module"
          >
            <ArrowLeft size={16} /> OT module
          </Link>
          <span className="text-gray-300">·</span>
          <div className="flex items-center gap-2 text-sm text-gray-700 font-medium">
            <Stethoscope size={14} /> PAC Workspace
          </div>
          <span className="ml-auto text-[11px] text-gray-400">
            Updated {new Date(progress.updated_at).toLocaleString()}
          </span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {error && (
          <div className="border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-sm flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Pin banner */}
        <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-gray-900 truncate">
                {patient.patient_name || 'Unnamed'}
                {patient.uhid && <span className="text-gray-500 font-normal"> · {patient.uhid}</span>}
                {ageSex && <span className="text-gray-500 font-normal"> · {ageSex}</span>}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                {patient.hospital_name}
                {patient.planned_procedure && <span> · {patient.planned_procedure}</span>}
                {patient.surgeon_name && <span> · Surgeon {patient.surgeon_name}</span>}
              </div>
              <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 uppercase tracking-wide">
                  {patient.case_state.replace(/_/g, ' ')}
                </span>
                {patient.urgency && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 uppercase tracking-wide">
                    {patient.urgency}
                  </span>
                )}
                <span className={`px-1.5 py-0.5 rounded uppercase tracking-wide ${SLA_CHIP[sla.level]}`}>
                  <Clock size={10} className="inline-block mr-0.5 -mt-0.5" /> {sla.label}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 uppercase tracking-wide">
                  {progress.sub_state.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* PCW2.4a — Smart Suggestions inbox (gated on pac_workspace_v2_enabled).
            When the flag is OFF, users see the v1 workspace exactly as before.
            When ON, the inbox renders above the mode picker per PRD §8.1. */}
        {v2Enabled && <SuggestionsInbox caseId={caseId} reloadKey={inboxReloadKey} />}

        {/* Mode picker — LIVE in PCW.1 */}
        <ModeSection
          currentMode={progress.pac_mode}
          canWrite={canWrite}
          saving={savingMode}
          onChange={setMode}
        />

        {payload.patient_context && (
          <PatientContextBanner ctx={payload.patient_context} />
        )}

        {/* PCW2.5 — Diagnostics section (kind='diagnostic' rows). Renders
            above the v1 Orders section when v2 flag is on. v1 OrdersSection
            then receives excludeDiagnostic=true so the same rows don't
            appear twice. When the flag is off, the v1 Orders section
            shows everything as before. */}
        {v2Enabled && (
          <PacVisitSchedulingCard
            caseId={caseId}
            appointments={payload.appointments ?? []}
            canWrite={canWrite}
            onUpdated={load}
          />
        )}

        {v2Enabled && (
          <DiagnosticsSection
            caseId={caseId}
            orders={payload.orders}
            appointments={payload.appointments ?? []}
            canWrite={canWrite}
            onUpdated={load}
          />
        )}

        {/* PCW.2 LIVE sections */}
        <OrdersSection
          caseId={caseId}
          orders={payload.orders}
          canWrite={canWrite}
          pacMode={progress.pac_mode}
          onAdded={load}
          onUpdated={load}
          excludeDiagnostic={v2Enabled}
        />
        <ClearancesSection
          caseId={caseId}
          clearances={payload.clearances}
          canWrite={canWrite}
          pacMode={progress.pac_mode}
          onAdded={load}
          onUpdated={load}
          appointments={v2Enabled ? (payload.appointments ?? []) : undefined}
        />
        <ChecklistSection
          caseId={caseId}
          templateCode={progress.checklist_template}
          items={progress.checklist_state}
          plannedSurgeryDate={patient.planned_surgery_date}
          canWrite={canWrite}
          onUpdated={load}
        />
        <AnaesthetistPublishSection
          caseId={caseId}
          caseState={patient.case_state}
          subState={progress.sub_state}
          canPublish={userRole === 'super_admin' || userRole === 'anesthesiologist'}
          onPublished={load}
        />

        <p className="text-[11px] text-gray-400 text-center pt-2 pb-6">
          PCW.4 · anaesthetist publish live · workspace replaces PacPublishModal
          {payload.channel_id ? ` · live channel ${payload.channel_id}` : ' · live channel offline'}
        </p>
      </div>
    </main>
  );
}

// =============================================================================
// Mode section
// =============================================================================

function ModeSection({
  currentMode,
  canWrite,
  saving,
  onChange,
}: {
  currentMode: PacMode;
  canWrite: boolean;
  saving: boolean;
  onChange: (mode: PacMode) => void;
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <Stethoscope size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">PAC mode</h3>
        <span className="ml-auto text-[11px] text-gray-400">{saving && 'Saving…'}</span>
        {!canWrite && (
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
            <Lock size={11} /> read-only
          </span>
        )}
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {VALID_PAC_MODES.map((m) => {
          const selected = m === currentMode;
          return (
            <li key={m}>
              <button
                type="button"
                disabled={!canWrite || saving || selected}
                onClick={() => onChange(m)}
                className={[
                  'w-full text-left border rounded-md px-3 py-2 transition-all',
                  selected
                    ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-300 cursor-default'
                    : canWrite
                      ? 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 cursor-pointer'
                      : 'border-gray-200 opacity-60 cursor-not-allowed',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  {selected ? (
                    <CheckCircle2 size={14} className="text-indigo-600 flex-shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-gray-900">{PAC_MODE_LABELS[m]}</span>
                </div>
                <p className="text-[11px] text-gray-500 ml-6 mt-0.5">{MODE_HINT[m]}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


// =============================================================================
// PatientContextBanner — surfaces intake-derived comorbidities/allergies/meds
// =============================================================================

function PatientContextBanner({ ctx }: { ctx: NonNullable<PacWorkspacePayload['patient_context']> }) {
  const isEmpty =
    ctx.comorbidities.length === 0 && !ctx.allergies && !ctx.current_medications;
  if (isEmpty && !ctx.source_form_submission_id) return null;
  return (
    <section className="bg-amber-50/40 border border-amber-100 rounded-lg p-3 text-xs">
      <header className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-semibold">
          Intake
        </span>
        <span className="text-gray-700 font-medium">Patient context (from Marketing Handoff)</span>
        {ctx.source_submitted_at && (
          <span className="ml-auto text-[10px] text-gray-500">
            captured {new Date(ctx.source_submitted_at).toLocaleDateString()}
          </span>
        )}
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-gray-700">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Comorbidities</div>
          {ctx.comorbidities.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {ctx.comorbidities.map((c) => (
                <span key={c} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded">
                  {c.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 italic mt-0.5">none recorded</p>
          )}
          {ctx.comorbidities_controlled && (
            <p className="text-[10px] text-gray-500 mt-1">
              Control: {ctx.comorbidities_controlled}
            </p>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Allergies</div>
          <p className="mt-0.5 break-words">{ctx.allergies ?? <span className="text-gray-400 italic">none recorded</span>}</p>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Current medications</div>
          <p className="mt-0.5 break-words">{ctx.current_medications ?? <span className="text-gray-400 italic">none recorded</span>}</p>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Placeholder section (used for PCW.2-4 not-yet-wired sections)
// =============================================================================

function PlaceholderSection({
  title,
  icon,
  subtitle,
  sprintHint,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle: string;
  sprintHint: string;
}) {
  return (
    <section className="bg-white border border-dashed border-gray-200 rounded-lg p-4 opacity-70">
      <header className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400 px-1.5 py-0.5 rounded bg-gray-100">
          {sprintHint}
        </span>
      </header>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </section>
  );
}

// =============================================================================
// Error panel
// =============================================================================

function ErrorPanel({
  caseId,
  message,
  onRetry,
}: {
  caseId: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md w-full bg-white border border-red-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center gap-2 text-red-800">
          <AlertCircle size={16} />
          <h1 className="text-base font-semibold">Workspace failed to load</h1>
        </div>
        <p className="mt-2 text-sm text-gray-700 break-words">{message}</p>
        <p className="mt-1 text-[11px] text-gray-500">case {caseId}</p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700"
          >
            Retry
          </button>
          <Link href="/?tab=ot" className="text-sm text-indigo-600 hover:text-indigo-700">
            Back to OT module
          </Link>
        </div>
      </div>
    </main>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const MODE_HINT: Record<PacMode, string> = {
  in_person_opd: 'Anaesthetist sees patient in clinic before admission. Default for elective.',
  bedside: 'Patient already admitted. Anaesthetist comes to ward / pre-op.',
  telephonic: 'Phone / video screening. Used for low-risk patients.',
  paper_screening: 'Questionnaire-based screening. Lowest-risk day-care only.',
};

const SLA_CHIP: Record<'green' | 'amber' | 'red' | 'unknown', string> = {
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  unknown: 'bg-gray-100 text-gray-600',
};

function sla_status(deadlineIso: string | null): { level: 'green' | 'amber' | 'red' | 'unknown'; label: string } {
  if (!deadlineIso) return { level: 'unknown', label: 'no SLA set' };
  const ms = new Date(deadlineIso).getTime() - Date.now();
  if (Number.isNaN(ms)) return { level: 'unknown', label: 'SLA invalid' };
  if (ms < 0) {
    const overdueHrs = Math.round(-ms / 3_600_000);
    return { level: 'red', label: `overdue ${overdueHrs}h` };
  }
  const hrs = ms / 3_600_000;
  const remaining = hrs >= 24 ? `${Math.round(hrs / 24)}d` : `${Math.round(hrs)}h`;
  if (hrs < 4) return { level: 'amber', label: `${remaining} to deadline` };
  return { level: 'green', label: `${remaining} to deadline` };
}
