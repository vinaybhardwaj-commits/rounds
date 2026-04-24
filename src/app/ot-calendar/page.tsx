'use client';

// ============================================
// Rounds — /ot-calendar page (Sprint 2 Day 8.B)
//
// Week-Ahead OT Calendar for Rajeshwari (OT Coordinator) and super_admin.
// Shows a 7-day horizontal grid × 3 OT rooms per hospital. Scheduled cases
// appear as blocks in their cells; clicking an empty cell opens the schedule
// modal pre-filled with that date/room. Unscheduled queue shows on the left
// for cases in fit / fit_conds / optimizing / scheduled states that haven't
// been placed yet or could be moved.
//
// Week = 7 days starting from today's Monday. Prev/Next buttons shift by 7
// days. "This week" button returns to current.
//
// Drag-drop is out of scope for Day 8 — MVP uses click-to-schedule. Sprint 3
// can layer drag interactions on top without changing the data model.
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import ScheduleCaseModal from '@/components/drawer/ScheduleCaseModal';

interface CaseLite {
  id: string;
  hospital_slug: string;
  patient_name: string | null;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  ot_room: number | null;
  urgency: string | null;
  state: string;
  created_at: string;
}

const SCHEDULABLE_STATES = ['fit', 'fit_conds', 'optimizing', 'scheduled'] as const;
const SCHEDULE_ROLES = new Set(['ot_coordinator', 'super_admin']);

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // JS getDay(): 0=Sun..6=Sat. We want Monday as day 0.
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(d: Date): { main: string; sub: string } {
  return {
    main: d.toLocaleDateString('en-IN', { weekday: 'short' }),
    sub: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
  };
}

export default function OtCalendarPage() {
  const [cases, setCases] = useState<CaseLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Group cases by hospital → day → OT room. Sparse map.
  const scheduledByCell = useMemo(() => {
    const map = new Map<string, Map<string, Map<number, CaseLite[]>>>(); // hospital → day(YYYY-MM-DD) → ot_room → cases
    for (const c of cases) {
      if (c.state !== 'scheduled' || !c.planned_surgery_date || c.ot_room === null) continue;
      const hk = c.hospital_slug;
      const day = c.planned_surgery_date.slice(0, 10);
      if (!map.has(hk)) map.set(hk, new Map());
      const perDay = map.get(hk)!;
      if (!perDay.has(day)) perDay.set(day, new Map());
      const perRoom = perDay.get(day)!;
      if (!perRoom.has(c.ot_room)) perRoom.set(c.ot_room, []);
      perRoom.get(c.ot_room)!.push(c);
    }
    return map;
  }, [cases]);

  const hospitals = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) set.add(c.hospital_slug);
    const arr = [...set].sort();
    // Default: show EHRC first, others after. If no cases yet, still show EHRC.
    if (arr.length === 0) return ['ehrc'];
    return arr;
  }, [cases]);

  const unscheduled = useMemo(
    () => cases.filter((c) => c.state !== 'scheduled'),
    [cases]
  );

  // Modal state
  const [scheduleTarget, setScheduleTarget] = useState<{
    case: CaseLite;
    prefill: { date?: string; ot_room?: number };
  } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all(
      SCHEDULABLE_STATES.map((st) =>
        fetch(`/api/cases?state=${st}&limit=200`).then((r) => r.json())
      )
    )
      .then((results) => {
        const combined: CaseLite[] = [];
        let flagOk = true;
        for (const body of results) {
          if (body?.success && Array.isArray(body.data)) {
            combined.push(...body.data);
          }
          if (body?.feature_enabled === false) flagOk = false;
        }
        setCases(combined);
        setFeatureEnabled(flagOk);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (body?.success && body.data?.role) setRole(body.data.role); })
      .catch(() => { /* non-fatal */ });
    load();
  }, [load]);

  const canSchedule = role ? SCHEDULE_ROLES.has(role) : false;

  const onCellClick = (hospitalSlug: string, date: string, otRoom: number) => {
    // Two paths: if there's an unscheduled case pending, use the first one;
    // otherwise prompt the user to pick from the unscheduled queue. For Day 8
    // MVP: if queue has an unscheduled case for this hospital, we offer the
    // first one; else we open the modal with just the prefill and no case —
    // but the modal needs a caseId so in that case we just don't open it.
    const candidate = unscheduled.find((c) => c.hospital_slug === hospitalSlug);
    if (candidate) {
      setScheduleTarget({ case: candidate, prefill: { date, ot_room: otRoom } });
    }
  };

  const onUnscheduledClick = (c: CaseLite) => {
    setScheduleTarget({ case: c, prefill: { date: c.planned_surgery_date ?? '', ot_room: c.ot_room ?? 1 } });
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Week-Ahead OT Calendar</h1>
          <p className="mt-1 text-sm text-gray-600">
            Schedule cases into OT slots across your hospitals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Prev week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Next week →
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {!featureEnabled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Feature-flagged:</strong> Case model is disabled
          (<code>FEATURE_CASE_MODEL_ENABLED</code>). Calendar will populate after the flag flips.
        </div>
      )}
      {role && !canSchedule && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          Read-only: you&rsquo;re signed in as <code>{role}</code>. Scheduling needs <code>ot_coordinator</code> or <code>super_admin</code>.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        {/* Unscheduled queue */}
        <aside className="rounded-lg border border-gray-200 bg-white">
          <header className="border-b border-gray-100 px-3 py-2">
            <h2 className="text-sm font-semibold text-gray-900">Unscheduled ({unscheduled.length})</h2>
            <p className="text-xs text-gray-500">fit · fit_conds · optimizing</p>
          </header>
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto p-2">
            {unscheduled.length === 0 && (
              <li className="px-2 py-1 text-xs text-gray-500">Nothing waiting. Nice.</li>
            )}
            {unscheduled.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onUnscheduledClick(c)}
                  disabled={!canSchedule}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-left text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-900">{c.patient_name || '(no name)'}</span>
                    <span className="inline-flex items-center rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-700">
                      {c.hospital_slug.toUpperCase()}
                    </span>
                    <span className="inline-flex items-center rounded bg-indigo-100 px-1 py-0.5 text-[10px] text-indigo-800">
                      {c.state}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-gray-600">{c.planned_procedure || '(no procedure)'}</p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Week grid per hospital */}
        <div className="space-y-6 overflow-x-auto">
          {hospitals.map((hs) => (
            <section key={hs} className="rounded-lg border border-gray-200 bg-white">
              <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{hs.toUpperCase()}</h2>
                  <p className="text-xs text-gray-500">3 OTs</p>
                </div>
                {canSchedule && (
                  <LockListButton hospitalSlug={hs} weekStart={weekStart} />
                )}
              </header>
              <div className="grid grid-cols-[80px_repeat(7,minmax(120px,1fr))] border-t border-gray-100">
                <div className="border-r border-b border-gray-100 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-500">&nbsp;</div>
                {days.map((d) => {
                  const { main, sub } = dayLabel(d);
                  const isToday = ymd(d) === ymd(new Date());
                  return (
                    <div
                      key={ymd(d)}
                      className={`border-r border-b border-gray-100 px-2 py-1 text-center text-[11px] ${
                        isToday ? 'bg-blue-50 text-blue-900' : 'bg-gray-50 text-gray-700'
                      }`}
                    >
                      <div className="font-medium">{main}</div>
                      <div>{sub}</div>
                    </div>
                  );
                })}

                {[1, 2, 3].map((room) => (
                  <RoomRow
                    key={room}
                    hospitalSlug={hs}
                    otRoom={room}
                    days={days}
                    scheduledByCell={scheduledByCell}
                    canSchedule={canSchedule}
                    onCellClick={onCellClick}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {scheduleTarget && (
        <ScheduleCaseModal
          caseId={scheduleTarget.case.id}
          patientName={scheduleTarget.case.patient_name}
          hospitalSlug={scheduleTarget.case.hospital_slug}
          currentState={scheduleTarget.case.state}
          prefill={scheduleTarget.prefill}
          isOpen={true}
          onClose={() => setScheduleTarget(null)}
          onScheduled={() => { setScheduleTarget(null); load(); }}
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
  canSchedule: boolean;
  onCellClick: (hospitalSlug: string, date: string, otRoom: number) => void;
}

function RoomRow({ hospitalSlug, otRoom, days, scheduledByCell, canSchedule, onCellClick }: RoomRowProps) {
  return (
    <>
      <div className="border-r border-b border-gray-100 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-700">
        OT-{otRoom}
      </div>
      {days.map((d) => {
        const dateStr = ymd(d);
        const inCell =
          scheduledByCell.get(hospitalSlug)?.get(dateStr)?.get(otRoom) ?? [];
        return (
          <button
            key={`${hospitalSlug}-${dateStr}-${otRoom}`}
            type="button"
            onClick={() => onCellClick(hospitalSlug, dateStr, otRoom)}
            disabled={!canSchedule}
            className="min-h-[70px] border-r border-b border-gray-100 bg-white px-1 py-1 text-left align-top hover:bg-blue-50 disabled:cursor-default disabled:hover:bg-white"
          >
            {inCell.length === 0 && (
              <span className="text-[10px] text-gray-300">—</span>
            )}
            {inCell.map((c) => (
              <div
                key={c.id}
                className={`mb-1 rounded px-1 py-0.5 text-[11px] ${
                  c.urgency === 'emergency' ? 'bg-red-100 text-red-900' :
                  c.urgency === 'urgent' ? 'bg-orange-100 text-orange-900' :
                  'bg-blue-100 text-blue-900'
                }`}
                title={c.planned_procedure ?? ''}
              >
                <div className="truncate font-medium">{c.patient_name || '(no name)'}</div>
                {c.planned_procedure && (
                  <div className="truncate text-[10px] opacity-80">{c.planned_procedure}</div>
                )}
              </div>
            ))}
          </button>
        );
      })}
    </>
  );
}
