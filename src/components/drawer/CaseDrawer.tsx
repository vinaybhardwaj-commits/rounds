'use client';

// ============================================
// Rounds — CaseDrawer (Sprint 2 Day 6)
//
// Shape A+C — renders in two modes:
//
//   mode="panel"  — the thin "Surgery Panel" embedded in PatientDetailView.
//                   Shows current state pill, case code, planned procedure,
//                   track card summaries (one-line each), "Open full view" btn.
//
//   mode="drawer" — the wide right-side drawer on /case/:id. Full track cards
//                   expanded per role. State history timeline. Actions live in
//                   Sprint 2 Days 7-9 (PAC publish, schedule, equipment).
//
// Track cards (Sprint 2 Day 6 = STUBS; Days 7-9 wire actions):
//   Track 1 — PAC / Clinical   (Tamanna + Dr. Manu)
//   Track 2 — OT Scheduling    (Rajeshwari)
//   Track 3 — Equipment        (Arul)
//
// Role-aware auto-expansion:
//   ip_coordinator        → Track 1 expanded
//   anesthesiologist      → Track 1 expanded
//   ot_coordinator        → Track 2 expanded
//   biomedical_engineer   → Track 3 expanded
//   super_admin + others  → all collapsed (click to expand)
//
// Data: fetched from GET /api/cases/:id which returns case + hospital + patient
// + state history + pac_events + condition_cards + equipment_requests in one shot.
//
// Feature flag: FEATURE_CASE_MODEL_ENABLED. When off, the API returns 503 and
// the drawer renders a friendly disabled-state banner.
// ============================================

import { useEffect, useMemo, useState } from 'react';

// ---- Types (mirrors the /api/cases/:id response shape) ----

interface HospitalLite {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  is_active: boolean;
}

interface CaseObj {
  id: string;
  hospital_id: string;
  patient_thread_id: string;
  handoff_submission_id: string | null;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  ot_room: number | null;
  surgeon_id: string | null;
  anaesthetist_id: string | null;
  urgency: string | null;
  state: string;
  kx_case_id: string | null;
  kx_pac_record_id: string | null;
  created_at: string;
  updated_at: string;
  case_code: string;
}

interface PatientLite {
  id: string;
  patient_name: string | null;
  kx_uhid: string | null;
  age: number | null;
  gender: string | null;
  mobile: string | null;
}

interface StateEvent {
  id: string;
  from_state: string | null;
  to_state: string;
  transition_reason: string | null;
  actor_name: string | null;
  created_at: string;
}

interface PacEvent {
  id: string;
  published_at: string;
  outcome: string;
  anaesthetist_name: string | null;
  notes: string | null;
  kx_pac_record_id: string | null;
}

interface ConditionCard {
  id: string;
  library_code: string | null;
  custom_label: string | null;
  status: string; // 'pending' | 'in_progress' | 'done' | 'waived'
  note: string | null;
  completed_at: string | null;
}

interface EquipmentRequest {
  id: string;
  item_type: string;      // 'kit' | 'standard' | 'non_standard'
  item_label: string;     // human-readable name
  quantity: number;
  status: string;         // 5-step chain
  vendor_name: string | null;
  kit_id: string | null;
  auto_verified: boolean;
}

interface CaseDetail {
  case: CaseObj;
  hospital: HospitalLite;
  patient: PatientLite | null;
  state_history: StateEvent[];
  pac_events: PacEvent[];
  condition_cards: ConditionCard[];
  equipment_requests: EquipmentRequest[];
  handoff_submission: { id: string; form_type: string; submitted_at: string; submitter_name: string | null } | null;
}

// ---- State pill color map ----

const STATE_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  draft:         { bg: 'bg-gray-100',    fg: 'text-gray-800',    label: 'Draft' },
  intake:        { bg: 'bg-sky-100',     fg: 'text-sky-800',     label: 'Intake' },
  pac_scheduled: { bg: 'bg-indigo-100',  fg: 'text-indigo-800',  label: 'PAC Scheduled' },
  pac_done:      { bg: 'bg-indigo-200',  fg: 'text-indigo-900',  label: 'PAC Done' },
  fit:           { bg: 'bg-emerald-100', fg: 'text-emerald-800', label: 'Fit' },
  fit_conds:     { bg: 'bg-amber-100',   fg: 'text-amber-800',   label: 'Fit (with conditions)' },
  defer:         { bg: 'bg-orange-100',  fg: 'text-orange-800',  label: 'Defer' },
  unfit:         { bg: 'bg-rose-100',    fg: 'text-rose-800',    label: 'Unfit' },
  optimizing:    { bg: 'bg-yellow-100',  fg: 'text-yellow-800',  label: 'Optimizing' },
  scheduled:     { bg: 'bg-blue-100',    fg: 'text-blue-800',    label: 'Scheduled' },
  confirmed:     { bg: 'bg-blue-200',    fg: 'text-blue-900',    label: 'Confirmed' },
  verified:      { bg: 'bg-teal-100',    fg: 'text-teal-800',    label: 'Verified' },
  in_theatre:    { bg: 'bg-purple-100',  fg: 'text-purple-800',  label: 'In Theatre' },
  completed:     { bg: 'bg-emerald-200', fg: 'text-emerald-900', label: 'Completed' },
  postponed:     { bg: 'bg-gray-200',    fg: 'text-gray-900',    label: 'Postponed' },
  cancelled:     { bg: 'bg-red-100',     fg: 'text-red-800',     label: 'Cancelled' },
};

function StatePill({ state }: { state: string }) {
  const s = STATE_STYLES[state] ?? STATE_STYLES.draft;
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${s.bg} ${s.fg}`}>
      {s.label}
    </span>
  );
}

// ---- Role → default-expanded track index ----

function defaultExpandedTrack(role: string | undefined | null): 0 | 1 | 2 | null {
  switch (role) {
    case 'ip_coordinator':
    case 'anesthesiologist':
      return 0;
    case 'ot_coordinator':
      return 1;
    case 'biomedical_engineer':
      return 2;
    default:
      return null; // super_admin + others: no auto-expand
  }
}

// ---- Main component ----

export interface CaseDrawerProps {
  /** Case UUID to load */
  caseId: string;
  /** 'panel' = thin Surgery Panel; 'drawer' = wide right-side drawer */
  mode?: 'panel' | 'drawer';
  /** Current user's role — drives default track expansion */
  role?: string | null;
  /** Optional close callback (drawer mode) */
  onClose?: () => void;
  /** Optional href for the "Open full view" button in panel mode */
  fullViewHref?: string;
}

export default function CaseDrawer({ caseId, mode = 'drawer', role, onClose, fullViewHref }: CaseDrawerProps) {
  const [data, setData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);

  const defaultTrack = useMemo(() => defaultExpandedTrack(role), [role]);
  const [expandedTrack, setExpandedTrack] = useState<0 | 1 | 2 | null>(defaultTrack);

  // Re-compute default when role changes (SSR → client hydration guard).
  useEffect(() => {
    setExpandedTrack(defaultExpandedTrack(role));
  }, [role]);

  const reload = () => {
    setLoading(true);
    setError(null);
    setFeatureDisabled(false);
    fetch(`/api/cases/${caseId}`)
      .then(async (r) => {
        const body = await r.json();
        if (r.status === 503 && body?.feature_enabled === false) {
          setFeatureDisabled(true);
          return;
        }
        if (!r.ok || !body?.success) {
          throw new Error(body?.error || `HTTP ${r.status}`);
        }
        setData(body.data);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFeatureDisabled(false);

    fetch(`/api/cases/${caseId}`)
      .then(async (r) => {
        const body = await r.json();
        if (r.status === 503 && body?.feature_enabled === false) {
          if (!cancelled) setFeatureDisabled(true);
          return;
        }
        if (!r.ok || !body?.success) {
          throw new Error(body?.error || `HTTP ${r.status}`);
        }
        if (!cancelled) setData(body.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [caseId]);

  // ---- Loading / error / feature-flag states ----

  if (featureDisabled) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Feature-flagged:</strong> Case model is disabled (<code>FEATURE_CASE_MODEL_ENABLED</code>).
        The Shape A+C drawer is visible in dev; prod flip is planned for Sprint 2 close.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        Loading case…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load case: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        No case data.
      </div>
    );
  }

  const { case: c, hospital, patient, state_history, pac_events, condition_cards, equipment_requests } = data;

  // ---- PANEL MODE (Shape A) ----

  if (mode === 'panel') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Surgery Panel</span>
              <StatePill state={c.state} />
              <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-700">
                {hospital.slug.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-gray-600">{c.case_code}</p>
            <p className="mt-2 text-sm font-medium text-gray-900">
              {c.planned_procedure || <span className="text-gray-400">(no procedure yet)</span>}
            </p>
            {c.planned_surgery_date && (
              <p className="mt-0.5 text-xs text-gray-600">
                planned {new Date(c.planned_surgery_date).toLocaleDateString()}
              </p>
            )}
          </div>
          {fullViewHref && (
            <a
              href={fullViewHref}
              className="flex-shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Open full view
            </a>
          )}
        </div>

        {/* One-line track summaries */}
        <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-gray-100 pt-3 text-xs text-gray-700 sm:grid-cols-3">
          <div>
            <span className="font-medium text-gray-900">PAC</span>{' '}
            {pac_events.length > 0 ? pac_events[0].outcome ?? 'scheduled' : 'not scheduled'}
            {condition_cards.length > 0 && (
              <span className="text-gray-500">
                {' · '}
                {condition_cards.filter((cc) => cc.status === 'pending' || cc.status === 'in_progress').length} open
              </span>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-900">OT</span>{' '}
            {c.planned_surgery_date ? (c.ot_room ? `OT-${c.ot_room}` : 'date set, room TBD') : 'unscheduled'}
          </div>
          <div>
            <span className="font-medium text-gray-900">Equipment</span>{' '}
            {equipment_requests.length > 0 ? `${equipment_requests.length} item(s)` : 'none'}
          </div>
        </div>
      </div>
    );
  }

  // ---- DRAWER MODE (Shape C) ----

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatePill state={c.state} />
            <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-700">
              {hospital.slug.toUpperCase()}
            </span>
            {c.urgency && (
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-normal ${
                  c.urgency === 'emergency' ? 'bg-red-100 text-red-800' :
                  c.urgency === 'urgent' ? 'bg-orange-100 text-orange-800' :
                  'bg-blue-100 text-blue-800'
                }`}
              >
                {c.urgency}
              </span>
            )}
          </div>
          <h2 className="mt-1 text-lg font-semibold text-gray-900">
            {c.planned_procedure || <span className="text-gray-400">(procedure pending)</span>}
          </h2>
          <p className="mt-0.5 font-mono text-xs text-gray-500">
            {c.case_code} · {patient?.patient_name || '(no patient name)'} {patient?.kx_uhid ? `· ${patient.kx_uhid}` : ''}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        )}
      </header>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Track 1 — PAC / Clinical */}
        <TrackCard
          index={0}
          title="Track 1 — PAC / Clinical"
          subtitle="IP Coordinator + Anaesthetist"
          expanded={expandedTrack === 0}
          onToggle={() => setExpandedTrack(expandedTrack === 0 ? null : 0)}
          summary={
            pac_events.length > 0
              ? `${pac_events[0].outcome ?? 'pending'} · ${condition_cards.filter((cc) => cc.status === 'pending' || cc.status === 'in_progress').length} open conditions`
              : 'no PAC yet'
          }
        >
          <div className="space-y-3 text-sm">
            {pac_events.length === 0 ? (
              <p className="text-gray-500">No PAC events yet. Anaesthetist Queue ships Sprint 2 Day 7.</p>
            ) : (
              <ul className="space-y-2">
                {pac_events.map((pe) => (
                  <li key={pe.id} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        Outcome: {pe.outcome}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(pe.published_at).toLocaleString()}
                      </span>
                    </div>
                    {pe.anaesthetist_name && (
                      <p className="mt-1 text-xs text-gray-600">by {pe.anaesthetist_name}</p>
                    )}
                    {pe.notes && <p className="mt-1 text-xs text-gray-700">{pe.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
            {condition_cards.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-600">
                  Condition cards ({condition_cards.length})
                </h4>
                <ul className="space-y-1">
                  {condition_cards.map((cc) => (
                    <ConditionCardRow
                      key={cc.id}
                      caseId={c.id}
                      card={cc}
                      onChanged={reload}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </TrackCard>

        {/* Track 2 — OT Scheduling */}
        <TrackCard
          index={1}
          title="Track 2 — OT Scheduling"
          subtitle="OT Coordinator"
          expanded={expandedTrack === 1}
          onToggle={() => setExpandedTrack(expandedTrack === 1 ? null : 1)}
          summary={
            c.planned_surgery_date
              ? `${new Date(c.planned_surgery_date).toLocaleDateString()}${c.ot_room ? ` · OT-${c.ot_room}` : ' · room TBD'}`
              : 'unscheduled'
          }
        >
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="block text-gray-500">Planned date</span>
                <span className="font-medium text-gray-900">
                  {c.planned_surgery_date
                    ? new Date(c.planned_surgery_date).toLocaleDateString()
                    : '—'}
                </span>
              </div>
              <div>
                <span className="block text-gray-500">OT room</span>
                <span className="font-medium text-gray-900">
                  {c.ot_room ? `OT-${c.ot_room}` : '—'}
                </span>
              </div>
              <div>
                <span className="block text-gray-500">Surgeon</span>
                <span className="font-mono text-gray-700">{c.surgeon_id ? c.surgeon_id.slice(0, 8) : '—'}</span>
              </div>
              <div>
                <span className="block text-gray-500">Anaesthetist</span>
                <span className="font-mono text-gray-700">{c.anaesthetist_id ? c.anaesthetist_id.slice(0, 8) : '—'}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Week-Ahead OT Calendar ships Sprint 2 Day 8 — drag-drop scheduling lands there.
            </p>
          </div>
        </TrackCard>

        {/* Track 3 — Equipment */}
        <TrackCard
          index={2}
          title="Track 3 — Equipment"
          subtitle="Biomedical"
          expanded={expandedTrack === 2}
          onToggle={() => setExpandedTrack(expandedTrack === 2 ? null : 2)}
          summary={
            equipment_requests.length === 0
              ? 'none'
              : `${equipment_requests.length} item(s)`
          }
        >
          {equipment_requests.length === 0 ? (
            <p className="text-sm text-gray-500">
              No equipment requests yet. Equipment Kanban ships Sprint 2 Day 9.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {equipment_requests.map((er) => (
                <li key={er.id} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">
                    {er.item_label}
                    {er.quantity > 1 && <span className="ml-1 text-gray-500">×{er.quantity}</span>}
                  </span>
                  <span className="text-gray-500">
                    {er.status} {er.vendor_name ? `· ${er.vendor_name}` : ''}
                    {er.auto_verified && <span className="ml-1 text-emerald-700">· auto-verified</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TrackCard>

        {/* State history */}
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-600">
            State history ({state_history.length})
          </h3>
          {state_history.length === 0 ? (
            <p className="text-xs text-gray-500">No transitions yet.</p>
          ) : (
            <ol className="space-y-2 border-l border-gray-200 pl-4 text-xs">
              {state_history.map((ev) => (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-blue-500" />
                  <div className="flex items-center gap-2">
                    {ev.from_state ? (
                      <>
                        <StatePill state={ev.from_state} />
                        <span className="text-gray-400">→</span>
                      </>
                    ) : null}
                    <StatePill state={ev.to_state} />
                  </div>
                  <p className="mt-0.5 text-gray-600">
                    {new Date(ev.created_at).toLocaleString()}
                    {ev.actor_name ? ` · ${ev.actor_name}` : ''}
                  </p>
                  {ev.transition_reason && (
                    <p className="text-gray-500">{ev.transition_reason}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

// ---- TrackCard sub-component ----

interface TrackCardProps {
  index: number;
  title: string;
  subtitle: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

// ---- ConditionCardRow (inline Mark done / Waive controls) ----

interface ConditionCardRowProps {
  caseId: string;
  card: ConditionCard;
  onChanged: () => void;
}

function ConditionCardRow({ caseId, card, onChanged }: ConditionCardRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiveMode, setWaiveMode] = useState(false);
  const [waiveNote, setWaiveNote] = useState('');

  const terminal = card.status === 'done' || card.status === 'waived';

  const post = async (status: 'done' | 'waived', note?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/conditions/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error || `HTTP ${res.status}`);
      setWaiveMode(false);
      setWaiveNote('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded border border-gray-100 bg-white px-2 py-1.5 text-xs">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 inline-flex rounded px-1.5 py-0.5 font-medium ${
          card.status === 'done' ? 'bg-emerald-100 text-emerald-800' :
          card.status === 'waived' ? 'bg-gray-100 text-gray-700' :
          card.status === 'in_progress' ? 'bg-sky-100 text-sky-800' :
          'bg-amber-100 text-amber-800'
        }`}>
          {card.status}
        </span>
        <span className="flex-1">
          <span className="font-medium text-gray-900">
            {card.library_code || card.custom_label || '(no label)'}
          </span>
          {card.note && (
            <span className="block text-gray-500">{card.note}</span>
          )}
        </span>
        {!terminal && !waiveMode && (
          <span className="flex flex-shrink-0 gap-1">
            <button
              type="button"
              onClick={() => post('done')}
              disabled={busy}
              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              Mark done
            </button>
            <button
              type="button"
              onClick={() => setWaiveMode(true)}
              disabled={busy}
              className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Waive…
            </button>
          </span>
        )}
      </div>
      {waiveMode && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
          <label className="block text-[11px] font-medium text-amber-900">
            Why are you waiving this? (required)
          </label>
          <input
            type="text"
            value={waiveNote}
            onChange={(e) => setWaiveNote(e.target.value)}
            placeholder="e.g. patient on warfarin, clinical judgement"
            className="mt-1 w-full rounded-md border border-amber-300 px-2 py-1 text-xs focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => { setWaiveMode(false); setWaiveNote(''); }}
              disabled={busy}
              className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => post('waived', waiveNote.trim())}
              disabled={busy || !waiveNote.trim()}
              className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
            >
              {busy ? 'Waiving…' : 'Confirm waive'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
    </li>
  );
}

function TrackCard({ title, subtitle, summary, expanded, onToggle, children }: TrackCardProps) {
  return (
    <section className="mb-3 rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span className="text-xs text-gray-700" title="Track summary">
              {summary}
            </span>
          )}
          <span aria-hidden className={`text-gray-400 transition ${expanded ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {children}
        </div>
      )}
    </section>
  );
}
