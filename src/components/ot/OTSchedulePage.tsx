'use client';

// ============================================
// OTSchedulePage — Daily OT Schedule Dashboard
// Date navigation, stats header, case cards
// grouped by OT room. Responsive: 3-col desktop,
// single-scroll mobile. Sequencing warnings.
// ============================================

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Plus,
  AlertTriangle,
  Clock,
  User,
  Activity,
} from 'lucide-react';
import type { SurgeryPosting, OTReadinessItem } from '@/types';
import {
  SURGERY_STATUS_LABELS,
  SURGERY_STATUS_COLORS,
  READINESS_STATUS_LABELS,
  READINESS_STATUS_DOT_COLORS,
  WOUND_CLASS_LABELS,
  ANAESTHESIA_TYPE_LABELS,
} from '@/types';
import { ReadinessDonut, toDonutData } from './ReadinessDonut';
import { SurgeryPostingWizard } from './SurgeryPostingWizard';

// ── Types ──

interface ScheduleCase extends SurgeryPosting {
  readiness_items?: OTReadinessItem[];
}

interface ScheduleStats {
  total: number;
  ready: number;
  partial: number;
  not_ready: number;
  blocked: number;
}

interface OTSchedulePageProps {
  userRole: string;
  userId: string;
}

// ── Helpers ──

function formatDateIST(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function isToday(dateStr: string): boolean {
  return dateStr === formatDateIST(new Date());
}

function isTomorrow(dateStr: string): boolean {
  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  return dateStr === formatDateIST(tom);
}

function getDateLabel(dateStr: string): string {
  if (isToday(dateStr)) return 'Today';
  if (isTomorrow(dateStr)) return 'Tomorrow';
  return formatDisplayDate(dateStr);
}

/** Sequencing check: infected/dirty cases should go last */
function getSequencingWarnings(cases: ScheduleCase[]): string[] {
  const warnings: string[] = [];
  const sorted = [...cases].sort((a, b) => (a.slot_order ?? 99) - (b.slot_order ?? 99));

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const dirtyClasses = ['Dirty', 'Infected'];
    const cleanClasses = ['Clean', 'Clean-Contaminated'];

    if (
      current.wound_class &&
      next.wound_class &&
      dirtyClasses.includes(current.wound_class) &&
      cleanClasses.includes(next.wound_class)
    ) {
      warnings.push(
        `OT${current.ot_room}: "${current.procedure_name}" (${current.wound_class}) is scheduled before "${next.procedure_name}" (${next.wound_class})`
      );
    }
  }
  return warnings;
}


export function OTSchedulePage({ userRole, userId }: OTSchedulePageProps) {
  const [selectedDate, setSelectedDate] = useState(() => formatDateIST(new Date()));
  const [cases, setCases] = useState<ScheduleCase[]>([]);
  const [stats, setStats] = useState<ScheduleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  // ── Fetch schedule + stats ──
  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const [scheduleRes, statsRes] = await Promise.all([
        fetch(`/api/ot/schedule?date=${selectedDate}`),
        fetch(`/api/ot/schedule/stats?date=${selectedDate}`),
      ]);
      const scheduleData = await scheduleRes.json();
      const statsData = await statsRes.json();

      if (scheduleData.success) {
        setCases(scheduleData.data || []);
      }
      if (statsData.success) {
        setStats(statsData.data);
      }
    } catch (err) {
      console.error('[OTSchedulePage] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // ── Date navigation ──
  const goToPrev = useCallback(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    setSelectedDate(formatDateIST(d));
  }, [selectedDate]);

  const goToNext = useCallback(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    setSelectedDate(formatDateIST(d));
  }, [selectedDate]);

  const goToToday = useCallback(() => {
    setSelectedDate(formatDateIST(new Date()));
  }, []);

  // ── Group cases by OT room ──
  const groupedByRoom = useMemo(() => {
    const map = new Map<number, ScheduleCase[]>();
    for (const c of cases) {
      const room = c.ot_room;
      if (!map.has(room)) map.set(room, []);
      map.get(room)!.push(c);
    }
    // Sort each room's cases by slot_order then scheduled_time
    for (const [, roomCases] of map) {
      roomCases.sort((a, b) => {
        const orderDiff = (a.slot_order ?? 99) - (b.slot_order ?? 99);
        if (orderDiff !== 0) return orderDiff;
        return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
      });
    }
    return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
  }, [cases]);

  // ── Sequencing warnings across all rooms ──
  const allWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const [, roomCases] of groupedByRoom) {
      warnings.push(...getSequencingWarnings(roomCases));
    }
    return warnings;
  }, [groupedByRoom]);

  // ── Can post surgery ──
  const canPostSurgery = ['surgeon', 'super_admin', 'department_head', 'ot_coordinator'].includes(userRole);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* ── Header: Date nav + title ── */}
      <div className="bg-white border-b border-gray-100 px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-gray-900">OT Schedule</h1>
          {canPostSurgery && (
            <button
              onClick={() => setShowWizard(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={14} />
              Post Surgery
            </button>
          )}
        </div>

        {/* Date selector */}
        <div className="flex items-center justify-between">
          <button onClick={goToPrev} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronLeft size={18} className="text-gray-600" />
          </button>

          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-gray-400" />
            <span className="text-sm font-semibold text-gray-800">
              {getDateLabel(selectedDate)}
            </span>
            {!isToday(selectedDate) && (
              <button
                onClick={goToToday}
                className="text-[10px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full hover:bg-blue-100"
              >
                Today
              </button>
            )}
          </div>

          <button onClick={goToNext} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronRight size={18} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* ── Stats header ── */}
      {stats && !loading && (
        <div className="bg-white border-b border-gray-100 px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-3 overflow-x-auto">
            <StatChip label="Total" value={stats.total} color="text-gray-700" bg="bg-gray-100" />
            <StatChip label="Ready" value={stats.ready} color="text-green-700" bg="bg-green-50" />
            <StatChip label="Partial" value={stats.partial} color="text-amber-700" bg="bg-amber-50" />
            <StatChip label="Not Ready" value={stats.not_ready} color="text-red-700" bg="bg-red-50" />
            {stats.blocked > 0 && (
              <StatChip label="Blocked" value={stats.blocked} color="text-red-800" bg="bg-red-100" />
            )}
          </div>
        </div>
      )}

      {/* ── Sequencing warnings ── */}
      {allWarnings.length > 0 && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-semibold text-amber-800 mb-1">Sequencing Warning</p>
              {allWarnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-700 leading-tight">{w}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Main content: case cards grouped by OT room ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="mt-6 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse bg-white rounded-xl h-28 border border-gray-100" />
            ))}
          </div>
        ) : cases.length === 0 ? (
          <div className="mt-12 text-center">
            <Activity size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No surgeries scheduled</p>
            <p className="text-xs text-gray-300 mt-1">{formatDisplayDate(selectedDate)}</p>
            {canPostSurgery && (
              <button
                onClick={() => setShowWizard(true)}
                className="mt-4 text-xs font-medium text-blue-600 bg-blue-50 px-4 py-2 rounded-lg hover:bg-blue-100"
              >
                + Post a Surgery
              </button>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-4 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-4 sm:space-y-0">
            {[...groupedByRoom.entries()].map(([room, roomCases]) => (
              <OTRoomColumn key={room} room={room} cases={roomCases} />
            ))}
          </div>
        )}
      </div>

      {/* ── Surgery Posting Wizard ── */}
      {showWizard && (
        <SurgeryPostingWizard
          onClose={() => setShowWizard(false)}
          onPosted={() => { setShowWizard(false); fetchSchedule(); }}
        />
      )}
    </div>
  );
}


// ── Sub-components ──

function StatChip({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0 ${bg}`}>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
      <span className={`text-[10px] font-medium ${color} opacity-70`}>{label}</span>
    </div>
  );
}

function OTRoomColumn({ room, cases }: { room: number; cases: ScheduleCase[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Room header */}
      <div className="px-3.5 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">OT {room}</span>
        <span className="text-[10px] text-gray-400">{cases.length} case{cases.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Case cards */}
      <div className="divide-y divide-gray-50">
        {cases.map((c, idx) => (
          <CaseCard key={c.id} posting={c} slotIndex={idx + 1} />
        ))}
      </div>
    </div>
  );
}

function CaseCard({ posting, slotIndex }: { posting: ScheduleCase; slotIndex: number }) {
  const readinessColor = READINESS_STATUS_DOT_COLORS[posting.overall_readiness as keyof typeof READINESS_STATUS_DOT_COLORS] || '#f59e0b';
  const readinessLabel = READINESS_STATUS_LABELS[posting.overall_readiness as keyof typeof READINESS_STATUS_LABELS] || posting.overall_readiness;
  const statusClass = SURGERY_STATUS_COLORS[posting.status] || 'bg-gray-100 text-gray-800';
  const woundLabel = posting.wound_class ? WOUND_CLASS_LABELS[posting.wound_class as keyof typeof WOUND_CLASS_LABELS] : null;
  const anaesthesiaLabel = posting.anaesthesia_type ? ANAESTHESIA_TYPE_LABELS[posting.anaesthesia_type as keyof typeof ANAESTHESIA_TYPE_LABELS] : null;

  const donutData = posting.readiness_items
    ? toDonutData(posting.readiness_items)
    : {
        confirmed: posting.overall_readiness === 'ready' ? 1 : 0,
        pending: posting.overall_readiness === 'partial' ? 1 : (posting.overall_readiness === 'not_ready' ? 1 : 0),
        flagged: 0,
        blocked: posting.overall_readiness === 'blocked' ? 1 : 0,
        not_applicable: 0,
      };

  return (
    <div className="px-3.5 py-3">
      {/* Row 1: Slot, procedure, readiness donut */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold text-gray-400 shrink-0">#{slotIndex}</span>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: readinessColor }}
            />
            <span className="text-xs font-semibold text-gray-900 truncate">
              {posting.procedure_name}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 ml-[30px] truncate">
            {posting.patient_name}
            {posting.uhid && <span className="text-gray-400"> · {posting.uhid}</span>}
          </p>
        </div>
        <ReadinessDonut data={donutData} size={32} strokeWidth={4} showLabel={false} />
      </div>

      {/* Row 2: Time, surgeon, meta chips */}
      <div className="mt-1.5 ml-[30px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
        {posting.scheduled_time && (
          <span className="flex items-center gap-0.5">
            <Clock size={10} className="text-gray-400" />
            {posting.scheduled_time}
          </span>
        )}
        <span className="flex items-center gap-0.5">
          <User size={10} className="text-gray-400" />
          {posting.primary_surgeon_name}
        </span>
        {anaesthesiaLabel && <span>{anaesthesiaLabel}</span>}
        {woundLabel && <span>{woundLabel}</span>}
        {posting.estimated_duration_minutes && (
          <span>{posting.estimated_duration_minutes}m</span>
        )}
      </div>

      {/* Row 3: Status + flags */}
      <div className="mt-1.5 ml-[30px] flex flex-wrap items-center gap-1.5">
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${statusClass}`}>
          {SURGERY_STATUS_LABELS[posting.status]}
        </span>
        <span
          className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
          style={{ color: readinessColor, backgroundColor: `${readinessColor}15` }}
        >
          {readinessLabel}
        </span>
        {posting.is_high_risk && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
            High Risk
          </span>
        )}
        {posting.implant_required && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700">
            Implant
          </span>
        )}
        {posting.blood_required && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
            Blood
          </span>
        )}
        {posting.case_type === 'Emergency' && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
            Emergency
          </span>
        )}
      </div>
    </div>
  );
}
