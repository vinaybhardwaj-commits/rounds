'use client';

// =============================================================================
// /ot-calendar — Week-Ahead OT Calendar (26 Apr 2026 redesign)
//
// V's bug: the previous "Unscheduled" pane only listed fit/fit_conds/optimizing
// cases. Entering through a patient chart left the user without a way to book
// THAT patient. Now:
//
//   - Left pane: searchable list of ALL active patients (?focus_id=<patient>
//     pins the entered-through patient at the top). Color-coded by pac_status.
//     Once a booking is saved, the patient leaves the list.
//   - Click a patient → opens OTBookingModal with the 11 Excel-derived fields
//     plus OT/date/serial pickers. Save creates/updates the surgical_case row
//     and auto-advances the patient stage to pre_op.
//   - Right pane: 7-day × N-OT grid per hospital. Cells show ALL bookings,
//     vertically stacked with serial-number prefix; >2 → a "+ N more" expander.
//   - Click a booking entry → re-opens the modal in edit mode.
// =============================================================================

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, X, Loader2, ChevronRight } from 'lucide-react';
import OTBookingModal, { BookingValues } from '@/components/drawer/OTBookingModal';

interface CaseLite {
  id: string;
  hospital_slug: string;
  hospital_id: string;
  patient_name: string | null;
  patient_thread_id: string;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
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
  urgency: string | null;
  state: string;
  created_at: string;
}

interface EligiblePatient {
  id: string;
  patient_name: string | null;
  uhid: string | null;
  current_stage: string;
  hospital_id: string;
  hospital_slug: string | null;
  primary_consultant_name: string | null;
  target_department: string | null;
  case_id: string | null;
  case_state: string | null;
  pac_status: string;
  is_focus: boolean;
}

const SCHEDULE_ROLES = new Set(['ot_coordinator', 'anesthesiologist', 'consultant', 'surgeon']);

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function dayLabel(d: Date): { main: string; sub: string } {
  return {
    main: d.toLocaleDateString('en-IN', { weekday: 'short' }),
    sub: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
  };
}

const PAC_BADGE_TONE: Record<string, string> = {
  pac_cleared: 'bg-emerald-100 text-emerald-900',
  pac_pending: 'bg-amber-100 text-amber-900',
  no_case: 'bg-gray-100 text-gray-700',
  draft: 'bg-gray-100 text-gray-700',
  intake: 'bg-gray-100 text-gray-700',
  defer: 'bg-orange-100 text-orange-900',
  unfit: 'bg-red-100 text-red-900',
};

const STAGE_TONE: Record<string, string> = {
  opd: 'bg-slate-100 text-slate-800',
  pre_admission: 'bg-slate-100 text-slate-800',
  admitted: 'bg-blue-100 text-blue-800',
  medical_management: 'bg-cyan-100 text-cyan-800',
  pre_op: 'bg-violet-100 text-violet-900',
  surgery: 'bg-purple-100 text-purple-900',
};

function OtCalendarPageInner() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get('patient') || '';

  const [cases, setCases] = useState<CaseLite[]>([]);
  const [patients, setPatients] = useState<EligiblePatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()));
  // 26 Apr 2026 FU7: hospital → ot_room_count map (defaults to 3 if not loaded).
  const [hospitalCfg, setHospitalCfg] = useState<Record<string, number>>({});
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Modal state — handles both create (case_id from picked patient) + edit (existing).
  const [modalState, setModalState] = useState<{
    caseId: string;
    patient: { name: string | null; stage: string | null; pacStatus: string | null; hospitalSlug: string | null };
    preFilled: BookingValues;
    existingSerials: number[];
    mode: 'create' | 'edit';
  } | null>(null);

  // -- Loaders -----------------------------------------------------------------

  const loadCases = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all(['fit', 'fit_conds', 'optimizing', 'scheduled'].map((st) =>
      fetch(`/api/cases?state=${st}&limit=200`).then((r) => r.json())
    ))
      .then((results) => {
        const combined: CaseLite[] = [];
        let flagOk = true;
        for (const body of results) {
          if (body?.success && Array.isArray(body.data)) combined.push(...body.data);
          if (body?.feature_enabled === false) flagOk = false;
        }
        setCases(combined);
        setFeatureEnabled(flagOk);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const loadPatients = useCallback(() => {
    setPatientsLoading(true);
    const qs = new URLSearchParams();
    if (search.trim().length >= 2) qs.set('q', search.trim());
    if (focusId) qs.set('focus_id', focusId);
    qs.set('limit', '50');
    fetch(`/api/ot-calendar/eligible-patients?${qs}`)
      .then((r) => r.json())
      .then((b) => {
        if (b?.success && Array.isArray(b.data)) setPatients(b.data as EligiblePatient[]);
      })
      .catch(() => {})
      .finally(() => setPatientsLoading(false));
  }, [search, focusId]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (body?.success && body.data?.role) setRole(body.data.role); })
      .catch(() => {});
    // 26 Apr 2026 FU7: pull per-hospital ot_room_count.
    fetch('/api/hospitals/accessible')
      .then((r) => r.json())
      .then((b) => {
        if (b?.success && Array.isArray(b.data)) {
          const map: Record<string, number> = {};
          (b.data as Array<{ slug: string; ot_room_count: number }>).forEach((h) => {
            map[h.slug] = h.ot_room_count || 3;
          });
          setHospitalCfg(map);
        }
      })
      .catch(() => {});
    loadCases();
  }, [loadCases]);

  // Debounced patient list reload on search change.
  useEffect(() => {
    const t = setTimeout(loadPatients, 200);
    return () => clearTimeout(t);
  }, [loadPatients]);

  // -- Computed ----------------------------------------------------------------

  const scheduledByCell = useMemo(() => {
    const map = new Map<string, Map<string, Map<number, CaseLite[]>>>();
    for (const c of cases) {
      if (c.state !== 'scheduled' || !c.planned_surgery_date || c.ot_room === null) continue;
      const day = c.planned_surgery_date.slice(0, 10);
      if (!map.has(c.hospital_slug)) map.set(c.hospital_slug, new Map());
      const perDay = map.get(c.hospital_slug)!;
      if (!perDay.has(day)) perDay.set(day, new Map());
      const perRoom = perDay.get(day)!;
      if (!perRoom.has(c.ot_room)) perRoom.set(c.ot_room, []);
      perRoom.get(c.ot_room)!.push(c);
    }
    // Sort each cell's entries by case_serial_in_slot then start time.
    for (const perHospital of map.values()) {
      for (const perDay of perHospital.values()) {
        for (const list of perDay.values()) {
          list.sort((a, b) => (a.case_serial_in_slot ?? 99) - (b.case_serial_in_slot ?? 99) ||
                              (a.planned_start_time ?? '').localeCompare(b.planned_start_time ?? ''));
        }
      }
    }
    return map;
  }, [cases]);

  const hospitals = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) set.add(c.hospital_slug);
    for (const p of patients) if (p.hospital_slug) set.add(p.hospital_slug);
    const arr = [...set].sort();
    return arr.length > 0 ? arr : ['ehrc'];
  }, [cases, patients]);

  const canSchedule = role ? (role === 'super_admin' || SCHEDULE_ROLES.has(role)) : false;

  // -- Click handlers ----------------------------------------------------------

  // Click a patient in the list → ensure a surgical_case exists (creating one
  // on the fly if not) → open the booking modal in create mode.
  const onPickPatient = async (p: EligiblePatient) => {
    if (!canSchedule) return;
    let caseId = p.case_id;

    // If no case yet, POST /api/cases first.
    if (!caseId) {
      try {
        const res = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_thread_id: p.id }),
        });
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error(body.error || 'Failed to create case');
        caseId = body.data?.id || null;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    if (!caseId) {
      setError('Could not create or resolve a surgical case for this patient.');
      return;
    }

    setModalState({
      caseId,
      patient: {
        name: p.patient_name,
        stage: p.current_stage,
        pacStatus: p.pac_status,
        hospitalSlug: p.hospital_slug,
      },
      preFilled: {
        // Default the booking date to the first day of the visible week.
        planned_surgery_date: ymd(addDays(weekStart, 0)),
        ot_room: 1,
        case_serial_in_slot: 1,
        surgeon_name: p.primary_consultant_name || undefined,
      },
      existingSerials: [],
      mode: 'create',
    });
  };

  const onClickExistingBooking = (c: CaseLite) => {
    if (!canSchedule) return;
    const existingSerials = (c.planned_surgery_date && c.ot_room !== null)
      ? (scheduledByCell.get(c.hospital_slug)?.get(c.planned_surgery_date.slice(0, 10))?.get(c.ot_room) ?? [])
        .map((x) => x.case_serial_in_slot)
        .filter((s): s is number => typeof s === 'number' && s !== c.case_serial_in_slot)
      : [];
    setModalState({
      caseId: c.id,
      patient: {
        name: c.patient_name,
        stage: null,
        pacStatus: null,
        hospitalSlug: c.hospital_slug,
      },
      preFilled: {
        planned_surgery_date: c.planned_surgery_date ? c.planned_surgery_date.slice(0, 10) : undefined,
        ot_room: c.ot_room ?? undefined,
        case_serial_in_slot: c.case_serial_in_slot ?? undefined,
        planned_start_time: c.planned_start_time || undefined,
        planned_procedure: c.planned_procedure || undefined,
        surgeon_name: c.surgeon_name || undefined,
        assist_surgeon_name: c.assist_surgeon_name || undefined,
        anaesthetist_name: c.anaesthetist_name || undefined,
        anae_type: c.anae_type || undefined,
        equipment_status: c.equipment_status || undefined,
        consumables_status: c.consumables_status || undefined,
        ot_remarks: c.ot_remarks || undefined,
      },
      existingSerials,
      mode: 'edit',
    });
  };

  const refreshAll = () => { loadCases(); loadPatients(); };

  // -- Render ------------------------------------------------------------------

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Week-Ahead OT Calendar</h1>
          <p className="mt-1 text-sm text-gray-600">
            Click a patient on the left, fill the booking card, and place them onto a slot.
            {focusId && ' · You entered through a patient chart — they\'re pinned to the top of the list.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">← Prev week</button>
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">This week</button>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Next week →</button>
          <button type="button" onClick={refreshAll} disabled={loading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {!featureEnabled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Feature-flagged:</strong> Case model is disabled (<code>FEATURE_CASE_MODEL_ENABLED</code>).
        </div>
      )}
      {role && !canSchedule && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          Read-only — your role <code>{role}</code> can\'t book OT slots.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* LEFT: Patient list */}
        <aside className="flex flex-col rounded-lg border border-gray-200 bg-white">
          <header className="border-b border-gray-100 px-3 py-2">
            <h2 className="text-sm font-semibold text-gray-900">Patients ({patients.length})</h2>
            <p className="text-xs text-gray-500">Click a patient to book a slot.</p>
            <div className="mt-2 flex items-center rounded-md border border-gray-300 bg-white">
              <Search className="ml-2 h-4 w-4 text-gray-400" />
              <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, UHID, or phone…"
                className="flex-1 bg-transparent px-2 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="mr-2 text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              )}
              {patientsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin text-gray-400" />}
            </div>
          </header>
          <ul className="max-h-[72vh] flex-1 space-y-1 overflow-y-auto p-2">
            {patients.length === 0 && !patientsLoading && (
              <li className="px-2 py-4 text-center text-xs text-gray-500">
                {search ? 'No matching patients.' : 'Nothing waiting.'}
              </li>
            )}
            {patients.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPickPatient(p)}
                  disabled={!canSchedule}
                  className={`w-full rounded-md border bg-white px-2 py-1.5 text-left transition hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 ${
                    p.is_focus ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {p.patient_name || '(no name)'}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {p.uhid && (
                      <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-mono text-gray-700">{p.uhid}</span>
                    )}
                    <span className={`rounded px-1 py-0.5 text-[10px] uppercase ${STAGE_TONE[p.current_stage] || 'bg-gray-100 text-gray-700'}`}>
                      {p.current_stage.replace(/_/g, ' ')}
                    </span>
                    <span className={`rounded px-1 py-0.5 text-[10px] uppercase ${PAC_BADGE_TONE[p.pac_status] || 'bg-gray-100 text-gray-700'}`}>
                      {p.pac_status.replace(/_/g, ' ')}
                    </span>
                    {p.is_focus && (
                      <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-blue-800">Focus</span>
                    )}
                  </div>
                  {p.target_department && (
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">{p.target_department}</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* RIGHT: Week × OT grid */}
        <div className="space-y-6 overflow-x-auto">
          {hospitals.map((hs) => (
            <section key={hs} className="rounded-lg border border-gray-200 bg-white">
              <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{hs.toUpperCase()}</h2>
                  <p className="text-xs text-gray-500">{hospitalCfg[hs] || 3} OTs</p>
                </div>
                {canSchedule && <LockListButton hospitalSlug={hs} weekStart={weekStart} />}
              </header>
              <div className="grid grid-cols-[80px_repeat(7,minmax(140px,1fr))] border-t border-gray-100">
                <div className="border-r border-b border-gray-100 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-500">&nbsp;</div>
                {days.map((d) => {
                  const { main, sub } = dayLabel(d);
                  const isToday = ymd(d) === ymd(new Date());
                  return (
                    <div key={ymd(d)} className={`border-r border-b border-gray-100 px-2 py-1 text-center text-[11px] ${
                      isToday ? 'bg-blue-50 text-blue-900' : 'bg-gray-50 text-gray-700'
                    }`}>
                      <div className="font-medium">{main}</div>
                      <div>{sub}</div>
                    </div>
                  );
                })}

                {/* FU7: per-hospital OT count (defaults to 3 until /api/hospitals/accessible loads) */}
                {Array.from({ length: hospitalCfg[hs] || 3 }, (_, i) => i + 1).map((room) => (
                  <RoomRow
                    key={room}
                    hospitalSlug={hs}
                    otRoom={room}
                    days={days}
                    scheduledByCell={scheduledByCell}
                    canEdit={canSchedule}
                    onClickEntry={onClickExistingBooking}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {modalState && (
        <OTBookingModal
          isOpen={true}
          onClose={() => setModalState(null)}
          caseId={modalState.caseId}
          patientName={modalState.patient.name}
          hospitalSlug={modalState.patient.hospitalSlug}
          patientStage={modalState.patient.stage}
          pacStatus={modalState.patient.pacStatus}
          preFilled={modalState.preFilled}
          existingSerialsInSlot={modalState.existingSerials}
          otRoomCount={hospitalCfg[modalState.patient.hospitalSlug || ''] || 3}
          mode={modalState.mode}
          onSaved={() => { setModalState(null); refreshAll(); }}
        />
      )}
    </main>
  );
}
// ---- LockListButton (Sprint 3 Day 14) ----
//
// Small dropdown + button pair. Picks a list_date (default: tomorrow) and
// POSTs to /api/ot-lists/lock. On success, shows the composed WhatsApp
// message in a modal with a "Copy to clipboard" button for manual dispatch.

interface LockListButtonProps {
  hospitalSlug: string;
  weekStart: Date;
}

function LockListButton({ hospitalSlug, weekStart }: LockListButtonProps) {
  const [open, setOpen] = useState(false);
  const [listDate, setListDate] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    message_text: string;
    case_count: number;
    dispatch: { attempted: boolean; sent?: number; errors?: string[]; reason?: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const doLock = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ot-lists/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospital_slug: hospitalSlug, list_date: listDate }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error || `HTTP ${res.status}`);
      setResult(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyMessage = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.message_text);
    } catch { /* non-fatal */ }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
      >
        Lock list…
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); setResult(null); setError(null); } }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <header className="border-b border-gray-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Lock OT list — {hospitalSlug.toUpperCase()}
              </h3>
              <p className="mt-0.5 text-xs text-gray-600">
                Writes the final_930pm version to ot_list_versions. Only one final per hospital/date.
              </p>
            </header>
            <div className="px-4 py-3">
              {!result && (
                <>
                  <label className="block text-xs font-medium text-gray-700">List date</label>
                  <select
                    value={listDate}
                    onChange={(e) => setListDate(e.target.value)}
                    disabled={busy}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                  >
                    {weekDates.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  {error && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                      {error}
                    </div>
                  )}
                </>
              )}
              {result && (
                <div>
                  <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                    ✓ Locked · {result.case_count} case(s)
                    {result.dispatch.attempted ? (
                      <> · dispatched to {result.dispatch.sent ?? 0} recipient(s){result.dispatch.errors && result.dispatch.errors.length > 0 && ` (${result.dispatch.errors.length} errors)`}</>
                    ) : (
                      <> · no auto-dispatch — copy the message below</>
                    )}
                  </div>
                  <label className="block text-xs font-medium text-gray-700">WhatsApp message</label>
                  <pre className="mt-1 max-h-60 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 text-[11px] font-mono text-gray-900 whitespace-pre-wrap">{result.message_text}</pre>
                </div>
              )}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
              <button
                type="button"
                onClick={() => { setOpen(false); setResult(null); setError(null); }}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {result ? 'Close' : 'Cancel'}
              </button>
              {!result && (
                <button
                  type="button"
                  onClick={doLock}
                  disabled={busy}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? 'Locking…' : 'Lock'}
                </button>
              )}
              {result && (
                <button
                  type="button"
                  onClick={copyMessage}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Copy message
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

interface RoomRowProps {
  hospitalSlug: string;
  otRoom: number;
  days: Date[];
  scheduledByCell: Map<string, Map<string, Map<number, CaseLite[]>>>;
  canEdit: boolean;
  onClickEntry: (c: CaseLite) => void;
}

function RoomRow({ hospitalSlug, otRoom, days, scheduledByCell, canEdit, onClickEntry }: RoomRowProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <>
      <div className="border-r border-b border-gray-100 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-700">
        OT-{otRoom}
      </div>
      {days.map((d) => {
        const dateStr = ymd(d);
        const cellKey = `${hospitalSlug}-${dateStr}-${otRoom}`;
        const inCell = scheduledByCell.get(hospitalSlug)?.get(dateStr)?.get(otRoom) ?? [];
        const isExpanded = !!expanded[cellKey];
        const visibleCount = isExpanded ? inCell.length : Math.min(inCell.length, 2);
        const visible = inCell.slice(0, visibleCount);
        const hiddenCount = inCell.length - visibleCount;
        return (
          <div key={cellKey} className="flex min-h-[80px] flex-col gap-1 border-r border-b border-gray-100 bg-white px-1 py-1 align-top">
            {inCell.length === 0 && <span className="text-[10px] text-gray-300">—</span>}
            {visible.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onClickEntry(c)}
                disabled={!canEdit}
                title={[c.planned_procedure, c.surgeon_name && `Surgeon: ${c.surgeon_name}`, c.anaesthetist_name && `Anaesthetist: ${c.anaesthetist_name}`].filter(Boolean).join(' · ')}
                className={`rounded px-1 py-0.5 text-left text-[11px] transition hover:ring-1 hover:ring-blue-300 disabled:cursor-default ${
                  c.urgency === 'emergency' ? 'bg-red-100 text-red-900' :
                  c.urgency === 'urgent'    ? 'bg-orange-100 text-orange-900' :
                                              'bg-blue-100 text-blue-900'
                }`}
              >
                <div className="flex items-center gap-1">
                  {c.case_serial_in_slot != null && (
                    <span className="shrink-0 rounded bg-white/60 px-1 text-[9px] font-mono">#{c.case_serial_in_slot}</span>
                  )}
                  {c.planned_start_time && (
                    <span className="shrink-0 text-[9px] opacity-70">{c.planned_start_time}</span>
                  )}
                  {c.anae_type && (
                    <span className="shrink-0 rounded bg-white/60 px-1 text-[9px]">{c.anae_type}</span>
                  )}
                </div>
                <div className="truncate font-medium">{c.patient_name || '(no name)'}</div>
                {c.planned_procedure && (
                  <div className="truncate text-[10px] opacity-80">{c.planned_procedure}</div>
                )}
              </button>
            ))}
            {hiddenCount > 0 && !isExpanded && (
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [cellKey]: true }))}
                className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[10px] text-gray-700 hover:bg-gray-100"
              >
                + {hiddenCount} more
              </button>
            )}
            {isExpanded && inCell.length > 2 && (
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [cellKey]: false }))}
                className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[10px] text-gray-700 hover:bg-gray-100"
              >
                Collapse
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}


export default function OtCalendarPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-7xl px-4 py-6 text-sm text-gray-500">Loading calendar…</main>}>
      <OtCalendarPageInner />
    </Suspense>
  );
}
