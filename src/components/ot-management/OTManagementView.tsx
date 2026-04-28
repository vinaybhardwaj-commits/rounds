'use client';

// =============================================================================
// OTManagementView — OT Management Module v1 shell + sections (OT.1 + OT.2)
//
// PRD: Daily Dash EHRC/OT-MANAGEMENT-MODULE-PRD.md (v1.1 LOCKED 28 Apr 2026)
//
// OT.2 wires the first 3 real sections (Today's slate, Booking inbox, PAC
// queue) via /api/ot-management/today. Equipment, KPIs, Notes ship in OT.3;
// live updates + patient pre-load in OT.4.
//
// Glass mode: visible to every signed-in user (PRD D2). Action endpoints
// keep their own role gates; this view does no role-gating itself.
//
// Refresh: 30s polling fallback (PRD D6); GetStream live channel arrives in
// OT.4.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WeekView } from './WeekView';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  CalendarRange,
  ClipboardList,
  Inbox,
  Activity,
  Wrench,
  BarChart3,
  StickyNote,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface AccessibleHospital {
  id: string;
  slug: string;
  name: string;
  ot_room_count: number;
}

interface SlateRow {
  case_id: string;
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  pt_current_stage: string;
  case_state: string;
  urgency: string | null;
  planned_procedure: string | null;
  planned_start_time: string | null;
  ot_room: number | null;
  case_serial_in_slot: number | null;
  surgeon_name: string | null;
  assist_surgeon_name: string | null;
  anaesthetist_name: string | null;
  anae_type: string | null;
  equipment_status: string | null;
  consumables_status: string | null;
  ot_remarks: string | null;
}

interface InboxRow {
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  case_id: string;
  case_state: string;
  urgency: string | null;
  pac_cleared_at: string | null;
  primary_consultant_name: string | null;
  target_department: string | null;
  planned_procedure: string | null;
}

interface PacRow {
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  age: number | null;
  gender: string | null;
  case_id: string;
  case_state: string;
  urgency: string | null;
  pac_outcome: string | null;
  pac_published_at: string | null;
  primary_consultant_name: string | null;
  target_department: string | null;
  workspace_pct: number | null;
}

interface EquipmentRow {
  request_id: string;
  case_id: string;
  patient_thread_id: string;
  patient_name: string | null;
  uhid: string | null;
  planned_surgery_date: string | null;
  planned_start_time: string | null;
  ot_room: number | null;
  surgeon_name: string | null;
  item_type: string;
  item_label: string;
  quantity: number;
  status: string;
  vendor_name: string | null;
  eta: string | null;
  notes: string | null;
  bucket: 'today' | 'tomorrow' | 'blocked';
}

interface KpiPayload {
  utilization_pct: number | null;
  utilization_basis: string;
  on_time_first_case_pct: number | null;
  on_time_first_case_basis: string;
  equipment_blocked_cancellations_7d: number;
  avg_pac_to_ot_days: number | null;
  avg_pac_to_ot_basis: string;
  asof: string;
}

interface NotesPayload {
  body: string;
  updated_by_name: string | null;
  updated_at: string | null;
  _migration_pending?: boolean;
}

interface TodayPayload {
  hospital: { id: string; slug: string; name: string; ot_room_count: number };
  slate: SlateRow[];
  booking_inbox: InboxRow[];
  pac_queue: PacRow[];
  equipment: EquipmentRow[];
  kpis: KpiPayload | null;
  notes: NotesPayload | null;
  generated_at: string;
}

interface OTManagementViewProps {
  userRole?: string;
  userId?: string;
}

const DEFAULT_HOSPITAL_SLUG = 'ehrc';

export function OTManagementView(_props: OTManagementViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientIdFromUrl = searchParams.get('patient_id') || searchParams.get('patient');

  const [hospitals, setHospitals] = useState<AccessibleHospital[]>([]);
  const [primarySlug, setPrimarySlug] = useState<string>(DEFAULT_HOSPITAL_SLUG);
  const [activeSlug, setActiveSlug] = useState<string>(DEFAULT_HOSPITAL_SLUG);
  const [loadingShell, setLoadingShell] = useState(true);
  const [shellErr, setShellErr] = useState<string | null>(null);

  const [today, setToday] = useState<TodayPayload | null>(null);
  const [loadingToday, setLoadingToday] = useState(false);
  const [todayErr, setTodayErr] = useState<string | null>(null);

  // OT.4 — patient pre-load + section auto-scroll.
  const sectionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [pinnedPatient, setPinnedPatient] = useState<{
    id: string;
    name: string | null;
    uhid: string | null;
    age: number | null;
    gender: string | null;
    current_stage: string | null;
    found: boolean;
  } | null>(null);
  const [highlightedRowKey, setHighlightedRowKey] = useState<{ section: string; id: string } | null>(null);
  const hasAutoScrolledRef = useRef(false);

  // 1. Bootstrap: /api/auth/me + /api/hospitals/accessible
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/hospitals/accessible').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([meBody, hospBody]) => {
        if (cancelled) return;
        const slug = meBody?.data?.primary_hospital_slug as string | undefined;
        const list = (hospBody?.data as AccessibleHospital[] | undefined) || [];
        if (slug && slug.length > 0) {
          setPrimarySlug(slug);
          setActiveSlug(slug);
        }
        setHospitals(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setShellErr(e instanceof Error ? e.message : 'Failed to load OT module');
      })
      .finally(() => {
        if (!cancelled) setLoadingShell(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Today payload: refetch on hospital tab change + 30s polling
  const loadToday = useCallback(async (slug: string) => {
    setLoadingToday(true);
    setTodayErr(null);
    try {
      const res = await fetch(`/api/ot-management/today?hospital=${encodeURIComponent(slug)}`);
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setToday(body.data as TodayPayload);
    } catch (e) {
      setTodayErr(e instanceof Error ? e.message : 'Failed to load OT data');
      setToday(null);
    } finally {
      setLoadingToday(false);
    }
  }, []);

  useEffect(() => {
    if (loadingShell) return;
    loadToday(activeSlug);
    const interval = setInterval(() => loadToday(activeSlug), 30_000);
    return () => clearInterval(interval);
  }, [activeSlug, loadingShell, loadToday]);

  // OT.4 — patient pre-load: when ?patient_id is in the URL and `today`
  // resolves, locate the patient in slate/inbox/pac, scroll to the
  // section that contains them, fire a brief amber highlight on the row.
  // Q6 lock: if patient not found, render the module + an amber banner.
  // Q7-style first-load gate via hasAutoScrolledRef so polling refreshes
  // don't keep re-scrolling.
  useEffect(() => {
    if (!patientIdFromUrl || !today) return;
    const findIn = (
      arr: { patient_thread_id?: string; case_id?: string }[],
      keyField: 'case_id' | 'patient_thread_id'
    ) => arr.find((r) => r.patient_thread_id === patientIdFromUrl) || null;
    let hit: { section: 'slate' | 'inbox' | 'pac'; id: string; row: { patient_name: string | null; uhid: string | null; age: number | null; gender: string | null; pt_current_stage?: string; case_state?: string } } | null = null;
    const slateHit = findIn(today.slate, 'case_id');
    if (slateHit) {
      const r = today.slate.find((s) => s.patient_thread_id === patientIdFromUrl)!;
      hit = { section: 'slate', id: r.case_id, row: r };
    } else {
      const inboxHit = today.booking_inbox.find((r) => r.patient_thread_id === patientIdFromUrl);
      if (inboxHit) {
        hit = { section: 'inbox', id: inboxHit.case_id, row: inboxHit };
      } else {
        const pacHit = today.pac_queue.find((r) => r.patient_thread_id === patientIdFromUrl);
        if (pacHit) hit = { section: 'pac', id: pacHit.case_id, row: pacHit };
      }
    }
    if (hit) {
      setPinnedPatient({
        id: patientIdFromUrl,
        name: hit.row.patient_name,
        uhid: hit.row.uhid,
        age: hit.row.age,
        gender: hit.row.gender,
        current_stage: hit.row.pt_current_stage || hit.row.case_state || null,
        found: true,
      });
      if (!hasAutoScrolledRef.current) {
        const el = sectionRefs.current.get(hit.section);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        hasAutoScrolledRef.current = true;
      }
      setHighlightedRowKey({ section: hit.section, id: hit.id });
      const t = setTimeout(() => setHighlightedRowKey(null), 3000);
      return () => clearTimeout(t);
    } else {
      setPinnedPatient({
        id: patientIdFromUrl,
        name: null,
        uhid: null,
        age: null,
        gender: null,
        current_stage: null,
        found: false,
      });
    }
    return undefined;
  }, [patientIdFromUrl, today]);

  // OT.4 — section auto-scroll for ?section=week (or other sections) when
  // the URL specifies one. One-shot via hasAutoScrolledRef so polling
  // refreshes don't keep re-scrolling.
  const sectionFromUrl = searchParams.get('section');
  useEffect(() => {
    if (!sectionFromUrl || hasAutoScrolledRef.current || loadingShell) return;
    const id = `ot-section-${sectionFromUrl}`;
    const el = document.getElementById(id);
    if (el) {
      // small delay so the page has had time to render
      const t = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        hasAutoScrolledRef.current = true;
      }, 100);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [sectionFromUrl, loadingShell]);

  const activeHospital = useMemo(
    () => hospitals.find((h) => h.slug === activeSlug) || null,
    [hospitals, activeSlug]
  );

  if (loadingShell) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="animate-spin" size={20} />
        <span className="ml-2 text-sm">Loading OT Management…</span>
      </div>
    );
  }

  if (shellErr) {
    return (
      <div className="flex h-full items-center justify-center text-red-500 px-6 text-center">
        <AlertCircle size={20} className="mr-2 flex-shrink-0" />
        <span className="text-sm">{shellErr}</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Hospital tabs (sticky) */}
      <div className="bg-white border-b border-gray-200 px-3 pt-2 sticky top-0 z-10">
        <div className="flex items-center gap-1 overflow-x-auto">
          {hospitals.length === 0 ? (
            <span className="text-xs text-gray-400 px-2 py-1">No accessible hospitals.</span>
          ) : (
            hospitals.map((h) => {
              const isActive = h.slug === activeSlug;
              const isPrimary = h.slug === primarySlug;
              return (
                <button
                  key={h.id}
                  onClick={() => setActiveSlug(h.slug)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
                    isActive
                      ? 'border-even-blue text-even-blue bg-blue-50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {h.slug.toUpperCase()}
                  {isPrimary && (
                    <span className="ml-1.5 text-[10px] text-gray-400 font-normal">primary</span>
                  )}
                </button>
              );
            })
          )}
          <div className="ml-auto flex items-center gap-2 pr-2 text-xs text-gray-400">
            {loadingToday ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <button
                onClick={() => loadToday(activeSlug)}
                className="hover:text-gray-600"
                title="Refresh now"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {today?.generated_at && (
              <span className="hidden sm:inline">
                {new Date(today.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sticky patient pin banner (OT.4) */}
      {pinnedPatient && (
        <div
          className={`px-4 py-2 sticky top-[37px] z-10 border-b text-sm flex items-center gap-2 ${
            pinnedPatient.found
              ? 'bg-blue-50 border-blue-200 text-blue-900'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <ClipboardList size={14} className="flex-shrink-0" />
          {pinnedPatient.found ? (
            <span>
              <span className="font-medium">{pinnedPatient.name || 'Patient'}</span>
              {pinnedPatient.uhid ? <span className="text-blue-700"> · {pinnedPatient.uhid}</span> : null}
              {pinnedPatient.age && pinnedPatient.gender ? (
                <span className="text-blue-700">
                  {' · '}
                  {pinnedPatient.gender.charAt(0).toUpperCase()}/{pinnedPatient.age}
                </span>
              ) : null}
              {pinnedPatient.current_stage ? (
                <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-blue-100 px-1.5 py-0.5 rounded">
                  {pinnedPatient.current_stage}
                </span>
              ) : null}
            </span>
          ) : (
            <span>
              Patient <code className="text-xs bg-amber-100 px-1 rounded">{pinnedPatient.id}</code> not found in this hospital&apos;s OT pipeline.
            </span>
          )}
        </div>
      )}

      {/* Sections (single scrolling page per PRD D5) */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          {todayErr && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Failed to load {activeSlug.toUpperCase()} data</div>
                <div className="text-xs mt-0.5">{todayErr}</div>
              </div>
            </div>
          )}

          <div id="ot-section-slate" ref={(el) => { sectionRefs.current.set('slate', el); }}>
            <SlateSection
              hospitalLabel={activeHospital?.name || activeSlug.toUpperCase()}
              rows={today?.slate || []}
              loading={loadingToday && !today}
              highlightedCaseId={highlightedRowKey?.section === 'slate' ? highlightedRowKey.id : null}
            />
          </div>

          <div id="ot-section-inbox" ref={(el) => { sectionRefs.current.set('inbox', el); }}>
            <BookingInboxSection
              rows={today?.booking_inbox || []}
              loading={loadingToday && !today}
              highlightedCaseId={highlightedRowKey?.section === 'inbox' ? highlightedRowKey.id : null}
            />
          </div>

          <div id="ot-section-pac" ref={(el) => { sectionRefs.current.set('pac', el); }}>
            <PacQueueSection
              rows={today?.pac_queue || []}
              onSelect={(caseId) => router.push(`/pac-workspace/${caseId}`)}
              loading={loadingToday && !today}
              highlightedCaseId={highlightedRowKey?.section === 'pac' ? highlightedRowKey.id : null}
            />
          </div>

          {/* Placeholders — OT.3 + OT.4 fill these */}
          <section id="ot-section-week" className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <CalendarRange size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-800">Week view</h3>
            </header>
            <div className="p-2">
              <WeekView />
            </div>
          </section>
          <div id="ot-section-equipment" ref={(el) => { sectionRefs.current.set('equipment', el); }}>
            <EquipmentSection rows={today?.equipment || []} loading={loadingToday && !today} />
          </div>
          <div id="ot-section-kpis" ref={(el) => { sectionRefs.current.set('kpis', el); }}>
            <KpiStripSection kpis={today?.kpis || null} loading={loadingToday && !today} />
          </div>
          <div id="ot-section-notes" ref={(el) => { sectionRefs.current.set('notes', el); }}>
            <NotesSection
              hospitalSlug={activeSlug}
              notes={today?.notes || null}
              onChanged={() => loadToday(activeSlug)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Section: Today's slate
// =============================================================================

function readinessLight(row: SlateRow): { color: string; label: string } {
  // Roll up: equipment_status, consumables_status. PT current_stage chip
  // surfaces separately. Green if both 'verified_ready', amber if either is in
  // an intermediate state, red if either is missing/blocked.
  const eq = row.equipment_status || '';
  const cons = row.consumables_status || '';
  const greenStates = new Set(['verified_ready', 'verified', 'ready']);
  const okEq = !eq || greenStates.has(eq); // empty = no equipment requested = ok
  const okCons = !cons || greenStates.has(cons);
  if (okEq && okCons) return { color: 'bg-green-500', label: 'Ready' };
  const blockedSubstrings = ['blocked', 'missing', 'failed'];
  const isBlocked = blockedSubstrings.some((s) => eq.includes(s) || cons.includes(s));
  if (isBlocked) return { color: 'bg-red-500', label: 'Blocked' };
  return { color: 'bg-amber-500', label: 'In progress' };
}

function SlateSection({ hospitalLabel, rows, loading, highlightedCaseId }: { hospitalLabel: string; rows: SlateRow[]; loading: boolean; highlightedCaseId: string | null }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <ClipboardList size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">
          Today&apos;s slate — {hospitalLabel}
        </h3>
        <span className="ml-auto text-xs text-gray-400">{rows.length} cases</span>
      </header>
      {loading && rows.length === 0 ? (
        <div className="text-xs text-gray-400 py-6 text-center">
          <Loader2 size={14} className="inline-block animate-spin mr-1" />
          Loading slate…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No cases scheduled for today.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const r_l = readinessLight(r);
            const time = r.planned_start_time ? r.planned_start_time.slice(0, 5) : '—';
            const room = r.ot_room ? `OT-${r.ot_room}` : '—';
            const ageSex = r.age && r.gender ? `${r.gender.charAt(0).toUpperCase()}/${r.age}` : '';
            const isHighlighted = highlightedCaseId === r.case_id;
            return (
              <li key={r.case_id} className={`border rounded-md p-2 transition-all ${
                isHighlighted ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-300' : 'border-gray-100 hover:bg-gray-50'
              }`}>
                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${r_l.color}`} title={r_l.label} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-gray-500 font-mono mb-0.5">
                      <span>{time}</span>
                      <span>·</span>
                      <span>{room}</span>
                      {r.case_serial_in_slot ? (
                        <>
                          <span>·</span>
                          <span>#{r.case_serial_in_slot}</span>
                        </>
                      ) : null}
                      <span className="ml-auto text-[10px] uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded">
                        {r.pt_current_stage}
                      </span>
                    </div>
                    <div className="text-sm text-gray-900 font-medium truncate">
                      {r.patient_name || 'Unnamed'}
                      {r.uhid ? <span className="text-gray-500 font-normal"> · {r.uhid}</span> : null}
                      {ageSex ? <span className="text-gray-500 font-normal"> · {ageSex}</span> : null}
                    </div>
                    <div className="text-xs text-gray-600 truncate">
                      {r.planned_procedure || 'Procedure TBD'}
                      {r.surgeon_name ? <span className="text-gray-500"> · {r.surgeon_name}</span> : null}
                      {r.anaesthetist_name ? <span className="text-gray-500"> · {r.anaesthetist_name}</span> : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// =============================================================================
// Section: Booking inbox (PAC-cleared, no slot yet)
// =============================================================================

function urgencyChip(urgency: string | null): { color: string; label: string } | null {
  if (urgency === 'emergency') return { color: 'bg-red-100 text-red-700 border-red-200', label: 'Emergency' };
  if (urgency === 'urgent') return { color: 'bg-amber-100 text-amber-800 border-amber-200', label: 'Urgent' };
  return null;
}

function BookingInboxSection({ rows, loading, highlightedCaseId }: { rows: InboxRow[]; loading: boolean; highlightedCaseId: string | null }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <Inbox size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Booking inbox</h3>
        <span className="ml-auto text-xs text-gray-400">{rows.length} waiting</span>
      </header>
      {loading && rows.length === 0 ? (
        <div className="text-xs text-gray-400 py-6 text-center">
          <Loader2 size={14} className="inline-block animate-spin mr-1" />
          Loading inbox…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">
          No PAC-cleared patients without a slot. The inbox is clear.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const ageSex = r.age && r.gender ? `${r.gender.charAt(0).toUpperCase()}/${r.age}` : '';
            const u = urgencyChip(r.urgency);
            const waitingDays = r.pac_cleared_at
              ? Math.max(0, Math.floor((Date.now() - new Date(r.pac_cleared_at).getTime()) / 86_400_000))
              : null;
            const isHighlighted = highlightedCaseId === r.case_id;
            return (
              <li key={r.case_id} className={`border rounded-md p-2 transition-all ${
                isHighlighted ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-300' : 'border-gray-100 hover:bg-gray-50'
              }`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {u && (
                        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${u.color}`}>
                          {u.label}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-500">
                        Waiting {waitingDays ?? '?'}d
                      </span>
                      <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded ml-auto">
                        {r.case_state}
                      </span>
                    </div>
                    <div className="text-sm text-gray-900 font-medium truncate">
                      {r.patient_name || 'Unnamed'}
                      {r.uhid ? <span className="text-gray-500 font-normal"> · {r.uhid}</span> : null}
                      {ageSex ? <span className="text-gray-500 font-normal"> · {ageSex}</span> : null}
                    </div>
                    <div className="text-xs text-gray-600 truncate">
                      {r.planned_procedure || r.target_department || 'Procedure TBD'}
                      {r.primary_consultant_name ? <span className="text-gray-500"> · {r.primary_consultant_name}</span> : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// =============================================================================
// Section: PAC queue (5 states)
// =============================================================================

const PAC_STATE_DISPLAY: Record<string, { label: string; chipColor: string; order: number }> = {
  fit_conds: { label: 'Fit (with conditions)', chipColor: 'bg-amber-100 text-amber-800', order: 0 },
  optimizing: { label: 'Optimizing', chipColor: 'bg-blue-100 text-blue-800', order: 1 },
  pac_scheduled: { label: 'PAC scheduled', chipColor: 'bg-indigo-100 text-indigo-800', order: 2 },
  defer: { label: 'Deferred', chipColor: 'bg-gray-100 text-gray-700', order: 3 },
  unfit: { label: 'Unfit', chipColor: 'bg-red-100 text-red-700', order: 4 },
};

function PacQueueSection({ rows, loading, highlightedCaseId, onSelect }: { rows: PacRow[]; loading: boolean; highlightedCaseId: string | null; onSelect: (caseId: string) => void }) {
  // PRD Q2: flat list with subtle visual grouping. Group by state in render
  // (rows are already sorted by state priority then recency by the API).
  const grouped = useMemo(() => {
    const map = new Map<string, PacRow[]>();
    for (const r of rows) {
      if (!map.has(r.case_state)) map.set(r.case_state, []);
      map.get(r.case_state)!.push(r);
    }
    return Array.from(map.entries()).sort(
      (a, b) => (PAC_STATE_DISPLAY[a[0]]?.order ?? 99) - (PAC_STATE_DISPLAY[b[0]]?.order ?? 99)
    );
  }, [rows]);

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <Activity size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">PAC queue</h3>
        <span className="ml-auto text-xs text-gray-400">{rows.length} patients</span>
      </header>
      {loading && rows.length === 0 ? (
        <div className="text-xs text-gray-400 py-6 text-center">
          <Loader2 size={14} className="inline-block animate-spin mr-1" />
          Loading PAC queue…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">PAC queue is empty.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([state, group]) => {
            const meta = PAC_STATE_DISPLAY[state] || { label: state, chipColor: 'bg-gray-100 text-gray-700', order: 99 };
            return (
              <div key={state}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-semibold ${meta.chipColor}`}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-gray-400">{group.length}</span>
                  <div className="flex-1 border-t border-gray-100 ml-2" />
                </div>
                <ul className="space-y-1.5">
                  {group.map((r) => {
                    const ageSex = r.age && r.gender ? `${r.gender.charAt(0).toUpperCase()}/${r.age}` : '';
                    const u = urgencyChip(r.urgency);
                    const isHighlighted = highlightedCaseId === r.case_id;
                    return (
                      <li key={r.case_id}>
                        <button
                          type="button"
                          onClick={() => onSelect(r.case_id)}
                          className={`w-full text-left border rounded-md p-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                            isHighlighted ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-300' : 'border-gray-100 hover:bg-gray-50 hover:border-indigo-200'
                          }`}
                          aria-label={`Open PAC workspace for ${r.patient_name || 'unnamed patient'}`}
                        >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {u && (
                                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${u.color}`}>
                                  {u.label}
                                </span>
                              )}
                              {r.pac_published_at && (
                                <span className="text-[10px] text-gray-500">
                                  PAC: {new Date(r.pac_published_at).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-900 font-medium truncate">
                              {r.patient_name || 'Unnamed'}
                              {r.uhid ? <span className="text-gray-500 font-normal"> · {r.uhid}</span> : null}
                              {ageSex ? <span className="text-gray-500 font-normal"> · {ageSex}</span> : null}
                            </div>
                            <div className="text-xs text-gray-600 truncate">
                              {r.target_department || 'Department TBD'}
                              {r.primary_consultant_name ? <span className="text-gray-500"> · {r.primary_consultant_name}</span> : null}
                              {typeof r.workspace_pct === 'number' && (
                                <span className={`ml-1.5 text-[10px] uppercase tracking-wide px-1 py-0.5 rounded ${
                                  r.workspace_pct >= 90 ? 'bg-green-100 text-green-700' :
                                  r.workspace_pct >= 50 ? 'bg-amber-100 text-amber-800' :
                                                          'bg-gray-100 text-gray-600'
                                }`}>
                                  {r.workspace_pct}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// =============================================================================
// =============================================================================
// Section: Equipment (today + tomorrow + currently-blocked)
// =============================================================================

const EQUIP_STATUS_CHIP: Record<string, string> = {
  requested: 'bg-gray-100 text-gray-700',
  vendor_confirmed: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-amber-100 text-amber-800',
  delivered: 'bg-indigo-100 text-indigo-700',
  verified_ready: 'bg-green-100 text-green-700',
};

function EquipmentSection({ rows, loading }: { rows: EquipmentRow[]; loading: boolean }) {
  const grouped = useMemo(() => {
    const byBucket: Record<'today' | 'tomorrow' | 'blocked', EquipmentRow[]> = {
      today: [],
      tomorrow: [],
      blocked: [],
    };
    for (const r of rows) byBucket[r.bucket].push(r);
    return byBucket;
  }, [rows]);

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <Wrench size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Equipment / vendor calls</h3>
        <span className="ml-auto text-xs text-gray-400">{rows.length} items</span>
      </header>
      {loading && rows.length === 0 ? (
        <div className="text-xs text-gray-400 py-6 text-center">
          <Loader2 size={14} className="inline-block animate-spin mr-1" />
          Loading equipment…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">
          No outstanding equipment for today, tomorrow, or blocked rentals.
        </p>
      ) : (
        <div className="space-y-3">
          {(['today', 'tomorrow', 'blocked'] as const).map((bucket) => {
            const bucketRows = grouped[bucket];
            if (bucketRows.length === 0) return null;
            const label = bucket === 'today' ? 'Today' : bucket === 'tomorrow' ? 'Tomorrow' : 'Blocked / overdue';
            const labelColor = bucket === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700';
            return (
              <div key={bucket}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-semibold ${labelColor}`}>
                    {label}
                  </span>
                  <span className="text-[10px] text-gray-400">{bucketRows.length}</span>
                  <div className="flex-1 border-t border-gray-100 ml-2" />
                </div>
                <ul className="space-y-1.5">
                  {bucketRows.map((r) => {
                    const chipColor = EQUIP_STATUS_CHIP[r.status] || 'bg-gray-100 text-gray-700';
                    const time = r.planned_start_time ? r.planned_start_time.slice(0, 5) : '—';
                    const room = r.ot_room ? `OT-${r.ot_room}` : '—';
                    return (
                      <li key={r.request_id} className="border border-gray-100 rounded-md p-2 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5 text-xs">
                              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${chipColor}`}>
                                {r.status.replace(/_/g, ' ')}
                              </span>
                              <span className="text-gray-500 font-mono">{time} · {room}</span>
                              {r.quantity > 1 && (
                                <span className="text-[10px] text-gray-500">×{r.quantity}</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-900 font-medium truncate">
                              {r.item_label}
                              <span className="text-[10px] text-gray-500 font-normal ml-1.5 uppercase">
                                {r.item_type}
                              </span>
                            </div>
                            <div className="text-xs text-gray-600 truncate">
                              {r.patient_name || 'Unnamed'}
                              {r.uhid ? <span className="text-gray-500"> · {r.uhid}</span> : null}
                              {r.surgeon_name ? <span className="text-gray-500"> · {r.surgeon_name}</span> : null}
                              {r.vendor_name ? <span className="text-gray-500"> · vendor: {r.vendor_name}</span> : null}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// =============================================================================
// Section: KPI strip
// =============================================================================

function KpiStripSection({ kpis, loading }: { kpis: KpiPayload | null; loading: boolean }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <BarChart3 size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">KPIs · yesterday</h3>
        {kpis?.asof && (
          <span className="ml-auto text-[10px] text-gray-400">
            as of {new Date(kpis.asof).toLocaleString()}
          </span>
        )}
      </header>
      {loading && !kpis ? (
        <div className="text-xs text-gray-400 py-6 text-center">
          <Loader2 size={14} className="inline-block animate-spin mr-1" />
          Computing…
        </div>
      ) : !kpis ? (
        <p className="text-xs text-gray-400 py-4 text-center">No KPI data.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <KpiCard label="OT utilization" value={kpis.utilization_pct != null ? `${kpis.utilization_pct}%` : '—'} basis={kpis.utilization_basis} />
          <KpiCard label="On-time first case" value={kpis.on_time_first_case_pct != null ? `${kpis.on_time_first_case_pct}%` : '—'} basis={kpis.on_time_first_case_basis} />
          <KpiCard label="Eqp-blocked cancels (7d)" value={String(kpis.equipment_blocked_cancellations_7d)} basis="case_state_events.cancelled w/ equipment reason" />
          <KpiCard label="Avg PAC → OT lag" value={kpis.avg_pac_to_ot_days != null ? `${kpis.avg_pac_to_ot_days}d` : '—'} basis={kpis.avg_pac_to_ot_basis} />
        </div>
      )}
    </section>
  );
}

function KpiCard({ label, value, basis }: { label: string; value: string; basis: string }) {
  return (
    <div className="border border-gray-100 rounded-md p-2.5 bg-gray-50" title={basis}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className="text-2xl text-gray-900 font-semibold leading-tight mt-0.5">{value}</div>
    </div>
  );
}

// =============================================================================
// Section: Coordinator notes (edit-in-place + see-history modal)
// =============================================================================

function NotesSection({
  hospitalSlug,
  notes,
  onChanged,
}: {
  hospitalSlug: string;
  notes: NotesPayload | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes?.body || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Sync draft when notes change externally (e.g. tab switch)
  useEffect(() => {
    if (!editing) setDraft(notes?.body || '');
  }, [notes?.body, editing]);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ot-management/notes?hospital=${encodeURIComponent(hospitalSlug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, hospitalSlug, onChanged]);

  const charCount = Buffer.byteLength(draft, 'utf8');
  const overCap = charCount > 4096;

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-2">
        <StickyNote size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Coordinator notes</h3>
        <button
          onClick={() => setHistoryOpen(true)}
          className="ml-auto text-xs text-even-blue hover:underline"
        >
          See history
        </button>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-even-blue hover:underline"
          >
            Edit
          </button>
        )}
      </header>
      {notes?._migration_pending && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
          Migration pending — V needs to run <code>POST /api/admin/migrate</code> as super_admin.
        </p>
      )}
      {!editing ? (
        <>
          {notes?.body ? (
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{notes.body}</p>
          ) : (
            <p className="text-xs text-gray-400 italic">No notes yet. Click Edit to add.</p>
          )}
          {notes?.updated_by_name && notes?.updated_at && (
            <p className="text-[11px] text-gray-400 mt-2">
              Last edited by {notes.updated_by_name} · {new Date(notes.updated_at).toLocaleString()}
            </p>
          )}
        </>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="w-full text-sm border border-gray-200 rounded-md p-2 font-mono leading-snug focus:border-even-blue focus:outline-none"
            placeholder="Pin reminders for the shift…"
            disabled={saving}
          />
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-[11px] ${overCap ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
              {charCount} / 4096 bytes
            </span>
            {err && <span className="text-[11px] text-red-600">{err}</span>}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setDraft(notes?.body || '');
                  setErr(null);
                }}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || overCap}
                className="text-xs px-3 py-1 rounded-md bg-even-blue text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
      {historyOpen && (
        <NotesHistoryModal hospitalSlug={hospitalSlug} onClose={() => setHistoryOpen(false)} />
      )}
    </section>
  );
}

interface HistoryEntry {
  id: string;
  ts: string;
  actor_name: string | null;
  summary: string;
  payload_before: { body?: string } | null;
  payload_after: { body?: string } | null;
}

function NotesHistoryModal({ hospitalSlug, onClose }: { hospitalSlug: string; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ot-management/notes/history?hospital=${encodeURIComponent(hospitalSlug)}&limit=10`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return;
        if (!b.success) throw new Error(b.error || 'Failed');
        setRows((b.data as HistoryEntry[]) || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hospitalSlug]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-gray-200 flex items-center">
          <h4 className="text-sm font-semibold text-gray-800">Notes history — {hospitalSlug.toUpperCase()}</h4>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 text-xs">Close</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-xs text-gray-400 py-6 text-center">
              <Loader2 size={14} className="inline-block animate-spin mr-1" />Loading…
            </div>
          ) : err ? (
            <div className="text-xs text-red-600">{err}</div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-400">No history yet.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((h) => {
                const before = h.payload_before?.body || '';
                const after = h.payload_after?.body || '';
                return (
                  <li key={h.id} className="border border-gray-100 rounded-md p-2.5">
                    <div className="text-[11px] text-gray-500 mb-1">
                      {new Date(h.ts).toLocaleString()} · {h.actor_name || 'Unknown'}
                    </div>
                    <details className="text-xs text-gray-700">
                      <summary className="cursor-pointer text-even-blue hover:underline">
                        Show diff ({before.length} → {after.length} chars)
                      </summary>
                      <div className="mt-2 grid sm:grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Before</div>
                          <pre className="bg-red-50 border border-red-100 p-1.5 rounded text-[11px] whitespace-pre-wrap font-mono">
                            {before || '(empty)'}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">After</div>
                          <pre className="bg-green-50 border border-green-100 p-1.5 rounded text-[11px] whitespace-pre-wrap font-mono">
                            {after || '(empty)'}
                          </pre>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// Section placeholder (OT.3 + OT.4 fill these)
// Section placeholder (OT.3 + OT.4 fill these)
// =============================================================================

interface SectionPlaceholderProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  cta?: { label: string; href: string };
}

function SectionPlaceholder({ icon: Icon, title, subtitle, cta }: SectionPlaceholderProps) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-1">
        <Icon size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </header>
      <p className="text-xs text-gray-500">{subtitle}</p>
      {cta && (
        <a
          href={cta.href}
          className="inline-block mt-2 text-xs text-even-blue font-medium hover:underline"
        >
          {cta.label} →
        </a>
      )}
    </section>
  );
}
