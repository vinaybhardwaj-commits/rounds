'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Clock, ChevronRight, ChevronLeft, Search, User, MessageSquare,
  ArrowRight, FileText, Edit3, Stethoscope, Bed, Building2, Shield,
  Activity, X,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { PATIENT_STAGE_LABELS, PATIENT_STAGE_COLORS } from '@/types';

// ─── Types ───────────────────────────────────────────

interface PatientSummary {
  id: string;
  patient_name: string;
  uhid: string | null;
  ip_number: string | null;
  current_stage: string;
  created_at: string;
  department_name: string | null;
  changelog_count: number;
  last_change_at: string | null;
}

interface TimelineEntry {
  id: string;
  type: 'changelog' | 'message' | 'form';
  timestamp: string;
  change_type?: string;
  field_name?: string;
  old_display?: string;
  new_display?: string;
  text?: string;
  message_type?: string;
  user_name: string;
  user_id?: string;
}

interface PatientTimeline {
  patient: {
    id: string;
    patient_name: string;
    uhid: string | null;
    ip_number: string | null;
    current_stage: string;
    getstream_channel_id: string | null;
  };
  timeline: TimelineEntry[];
}

// ─── Helpers ─────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateTime(iso: string) {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

function relativeTime(iso: string | null) {
  if (!iso) return 'No activity';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

function getEntryIcon(entry: TimelineEntry) {
  if (entry.type === 'message') return MessageSquare;
  if (entry.type === 'form') return FileText;
  switch (entry.change_type) {
    case 'stage_change': return ArrowRight;
    case 'field_edit': {
      if (entry.field_name === 'primary_consultant_id') return Stethoscope;
      if (entry.field_name === 'department_id') return Building2;
      if (entry.field_name === 'bed_number') return Bed;
      return Edit3;
    }
    case 'pac_status_change': return Shield;
    case 'form_submission': return FileText;
    default: return Activity;
  }
}

function getEntryColor(entry: TimelineEntry) {
  if (entry.type === 'message') return { bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-300' };
  if (entry.type === 'form') return { bg: 'bg-violet-100', text: 'text-violet-600', border: 'border-violet-300' };
  switch (entry.change_type) {
    case 'stage_change': return { bg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-300' };
    case 'pac_status_change': return { bg: 'bg-amber-100', text: 'text-amber-600', border: 'border-amber-300' };
    case 'field_edit': return { bg: 'bg-sky-100', text: 'text-sky-600', border: 'border-sky-300' };
    default: return { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-300' };
  }
}

function getEntryTitle(entry: TimelineEntry): string {
  if (entry.type === 'message') {
    return entry.message_type === 'system' ? 'System Message' : 'Chat Message';
  }
  if (entry.type === 'form') {
    const formLabel = entry.field_name?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Form';
    return `${formLabel} Submitted`;
  }
  switch (entry.change_type) {
    case 'stage_change': return 'Stage Changed';
    case 'pac_status_change': return 'PAC Status Changed';
    case 'field_edit': {
      const fieldLabels: Record<string, string> = {
        primary_consultant_id: 'Consultant Changed',
        department_id: 'Department Changed',
        bed_number: 'Bed/Room Changed',
      };
      return fieldLabels[entry.field_name || ''] || 'Field Updated';
    }
    default: return 'Change Recorded';
  }
}

function getEntryDetail(entry: TimelineEntry): string {
  if (entry.type === 'message') {
    const txt = entry.text || '';
    return txt.length > 120 ? txt.slice(0, 120) + '…' : txt;
  }
  if (entry.type === 'form') {
    return entry.new_display ? `Status: ${entry.new_display}` : 'Submitted';
  }
  if (entry.old_display && entry.new_display) {
    return `${entry.old_display} → ${entry.new_display}`;
  }
  if (entry.new_display) return entry.new_display;
  return '';
}

// ─── Patient List View ───────────────────────────────

function PatientList({
  patients,
  search,
  setSearch,
  onSelect,
}: {
  patients: PatientSummary[];
  search: string;
  setSearch: (s: string) => void;
  onSelect: (id: string) => void;
}) {
  const filtered = patients.filter(p => {
    const q = search.toLowerCase();
    return (
      p.patient_name.toLowerCase().includes(q) ||
      (p.uhid || '').toLowerCase().includes(q) ||
      (p.ip_number || '').toLowerCase().includes(q) ||
      (p.department_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name, UHID, IP number, department…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue/20 focus:border-even-blue"
        />
      </div>

      {/* Patient cards */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {search ? 'No patients match your search' : 'No patients found'}
          </div>
        )}
        {filtered.map(p => {
          const stageLabel = PATIENT_STAGE_LABELS[p.current_stage as keyof typeof PATIENT_STAGE_LABELS] || p.current_stage;
          const stageColor = PATIENT_STAGE_COLORS[p.current_stage as keyof typeof PATIENT_STAGE_COLORS] || '#6B7280';
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="w-full text-left bg-white border border-gray-100 rounded-lg px-4 py-3 hover:shadow-md hover:border-even-blue/30 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-even-navy truncate">{p.patient_name}</span>
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white shrink-0"
                      style={{ backgroundColor: stageColor }}
                    >
                      {stageLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {p.uhid && <span>UHID: {p.uhid}</span>}
                    {p.ip_number && <span>IP: {p.ip_number}</span>}
                    {p.department_name && <span>{p.department_name}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <div className="text-right hidden sm:block">
                    <div className="text-xs text-gray-400">{relativeTime(p.last_change_at)}</div>
                    <div className="text-xs text-gray-400">{p.changelog_count} event{p.changelog_count !== 1 ? 's' : ''}</div>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-even-blue transition-colors" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Fishbone Timeline ───────────────────────────────

function FishboneTimeline({ timeline }: { timeline: TimelineEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll);
      // Scroll to end (most recent)
      el.scrollLeft = el.scrollWidth;
      setTimeout(checkScroll, 100);
      return () => el.removeEventListener('scroll', checkScroll);
    }
  }, [timeline]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' });
  };

  if (timeline.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        No timeline events found for this patient
      </div>
    );
  }

  // Group events by date for the fishbone
  const dateGroups: { date: string; entries: TimelineEntry[] }[] = [];
  let currentDate = '';
  for (const entry of timeline) {
    const d = formatDate(entry.timestamp);
    if (d !== currentDate) {
      dateGroups.push({ date: d, entries: [] });
      currentDate = d;
    }
    dateGroups[dateGroups.length - 1].entries.push(entry);
  }

  return (
    <>
      {/* ── Desktop: Horizontal fishbone ── */}
      <div className="hidden md:block relative">
        {/* Scroll arrows */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white border border-gray-200 rounded-full shadow flex items-center justify-center hover:bg-gray-50"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white border border-gray-200 rounded-full shadow flex items-center justify-center hover:bg-gray-50"
          >
            <ChevronRight size={16} />
          </button>
        )}

        <div
          ref={scrollRef}
          className="overflow-x-auto pb-4 scrollbar-thin"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="inline-flex items-start min-w-full pt-4">
            {dateGroups.map((group, gi) => (
              <div key={gi} className="flex-shrink-0">
                {/* Date label */}
                <div className="text-center mb-3">
                  <span className="inline-block bg-even-navy text-white text-xs font-medium px-3 py-1 rounded-full">
                    {group.date}
                  </span>
                </div>

                <div className="flex items-start">
                  {group.entries.map((entry, ei) => {
                    const Icon = getEntryIcon(entry);
                    const color = getEntryColor(entry);
                    const isTop = ei % 2 === 0;

                    return (
                      <div key={entry.id} className="flex flex-col items-center w-56 relative">
                        {/* Card above or below the spine */}
                        {isTop ? (
                          <>
                            {/* Card */}
                            <div className={`w-48 border ${color.border} rounded-lg p-3 bg-white shadow-sm mb-2`}>
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`w-6 h-6 rounded-full ${color.bg} flex items-center justify-center flex-shrink-0`}>
                                  <Icon size={12} className={color.text} />
                                </div>
                                <span className="text-xs font-semibold text-gray-700 truncate">{getEntryTitle(entry)}</span>
                              </div>
                              <p className="text-xs text-gray-600 line-clamp-2 mb-1.5">{getEntryDetail(entry)}</p>
                              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                                <User size={10} />
                                <span className="truncate">{entry.user_name}</span>
                                <span className="ml-auto">{formatTime(entry.timestamp)}</span>
                              </div>
                            </div>
                            {/* Fishbone arm (downward) */}
                            <div className={`w-px h-4 ${color.border} border-l-2 border-dashed`} />
                            {/* Dot on spine */}
                            <div className={`w-3 h-3 rounded-full ${color.bg} border-2 ${color.border} z-10`} />
                            {/* Spine segment */}
                            <div className="w-full h-px bg-gray-300 absolute top-[calc(100%-6px)]" style={{ left: 0 }} />
                            {/* Spacer below spine */}
                            <div className="h-24" />
                          </>
                        ) : (
                          <>
                            {/* Spacer above spine */}
                            <div className="h-24" />
                            {/* Dot on spine */}
                            <div className={`w-3 h-3 rounded-full ${color.bg} border-2 ${color.border} z-10`} />
                            {/* Fishbone arm (upward from dot) */}
                            <div className={`w-px h-4 ${color.border} border-l-2 border-dashed`} />
                            {/* Card */}
                            <div className={`w-48 border ${color.border} rounded-lg p-3 bg-white shadow-sm mt-2`}>
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`w-6 h-6 rounded-full ${color.bg} flex items-center justify-center flex-shrink-0`}>
                                  <Icon size={12} className={color.text} />
                                </div>
                                <span className="text-xs font-semibold text-gray-700 truncate">{getEntryTitle(entry)}</span>
                              </div>
                              <p className="text-xs text-gray-600 line-clamp-2 mb-1.5">{getEntryDetail(entry)}</p>
                              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                                <User size={10} />
                                <span className="truncate">{entry.user_name}</span>
                                <span className="ml-auto">{formatTime(entry.timestamp)}</span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Connector between date groups */}
                {gi < dateGroups.length - 1 && (
                  <div className="h-px w-8 bg-gray-300 inline-block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile: Vertical fishbone ── */}
      <div className="md:hidden">
        {dateGroups.map((group, gi) => (
          <div key={gi} className="mb-6">
            {/* Date header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block bg-even-navy text-white text-xs font-medium px-3 py-1 rounded-full">
                {group.date}
              </span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Vertical spine with entries */}
            <div className="relative pl-8">
              {/* Spine line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />

              {group.entries.map((entry, ei) => {
                const Icon = getEntryIcon(entry);
                const color = getEntryColor(entry);

                return (
                  <div key={entry.id} className="relative mb-4 last:mb-0">
                    {/* Dot on spine */}
                    <div
                      className={`absolute -left-4 top-3 w-3 h-3 rounded-full ${color.bg} border-2 ${color.border} z-10`}
                      style={{ left: '10px' }}
                    />
                    {/* Fishbone arm (horizontal) */}
                    <div
                      className={`absolute top-[17px] w-4 ${color.border} border-t-2 border-dashed`}
                      style={{ left: '22px' }}
                    />

                    {/* Card */}
                    <div className={`ml-4 border ${color.border} rounded-lg p-3 bg-white shadow-sm`}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-6 h-6 rounded-full ${color.bg} flex items-center justify-center flex-shrink-0`}>
                          <Icon size={12} className={color.text} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">{getEntryTitle(entry)}</span>
                        <span className="ml-auto text-[10px] text-gray-400">{formatTime(entry.timestamp)}</span>
                      </div>
                      <p className="text-xs text-gray-600 mb-1">{getEntryDetail(entry)}</p>
                      <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        <User size={10} />
                        <span>{entry.user_name}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Main Page Component ─────────────────────────────

export default function ChangelogPage() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timelineData, setTimelineData] = useState<PatientTimeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Load patients list
  useEffect(() => {
    fetch('/api/admin/changelog')
      .then(r => r.json())
      .then(d => {
        if (d.success) setPatients(d.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Load timeline when patient selected
  useEffect(() => {
    if (!selectedId) {
      setTimelineData(null);
      return;
    }
    setTimelineLoading(true);
    fetch(`/api/admin/changelog/${selectedId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setTimelineData(d.data);
      })
      .catch(console.error)
      .finally(() => setTimelineLoading(false));
  }, [selectedId]);

  const handleBack = () => {
    setSelectedId(null);
    setTimelineData(null);
  };

  return (
    <AdminLayout
      breadcrumbs={
        selectedId && timelineData
          ? [
              { label: 'Admin', href: '/admin' },
              { label: 'Changelog', href: '/admin/changelog' },
              { label: timelineData.patient.patient_name },
            ]
          : [
              { label: 'Admin', href: '/admin' },
              { label: 'Changelog' },
            ]
      }
    >
      <div className="p-6">
        {/* ── Patient List View ── */}
        {!selectedId && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-even-navy">Patient Changelog</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Full history of all changes, messages, and form submissions per patient
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Clock size={14} />
                <span>{patients.length} patient{patients.length !== 1 ? 's' : ''}</span>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-16">
                <div className="inline-block w-6 h-6 border-2 border-even-blue border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-400 mt-3">Loading patients…</p>
              </div>
            ) : (
              <PatientList
                patients={patients}
                search={search}
                setSearch={setSearch}
                onSelect={setSelectedId}
              />
            )}
          </>
        )}

        {/* ── Timeline View ── */}
        {selectedId && (
          <>
            {/* Patient header */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handleBack}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-even-blue transition-colors"
              >
                <ChevronLeft size={16} />
                <span>All Patients</span>
              </button>
            </div>

            {timelineLoading ? (
              <div className="text-center py-16">
                <div className="inline-block w-6 h-6 border-2 border-even-blue border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-400 mt-3">Loading timeline…</p>
              </div>
            ) : timelineData ? (
              <>
                {/* Patient info bar */}
                <div className="bg-white border border-gray-100 rounded-xl p-4 mb-6">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <h2 className="text-lg font-bold text-even-navy">{timelineData.patient.patient_name}</h2>
                    {timelineData.patient.uhid && (
                      <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">UHID: {timelineData.patient.uhid}</span>
                    )}
                    {timelineData.patient.ip_number && (
                      <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">IP: {timelineData.patient.ip_number}</span>
                    )}
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white"
                      style={{
                        backgroundColor:
                          PATIENT_STAGE_COLORS[timelineData.patient.current_stage as keyof typeof PATIENT_STAGE_COLORS] || '#6B7280',
                      }}
                    >
                      {PATIENT_STAGE_LABELS[timelineData.patient.current_stage as keyof typeof PATIENT_STAGE_LABELS] ||
                        timelineData.patient.current_stage}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {timelineData.timeline.length} event{timelineData.timeline.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-3 mb-4 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Stage Change
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> Field Edit
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> PAC Status
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-400" /> Form
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> Chat Message
                  </span>
                </div>

                {/* Fishbone Timeline */}
                <div className="bg-white border border-gray-100 rounded-xl p-4 md:p-6 overflow-hidden">
                  <FishboneTimeline timeline={timelineData.timeline} />
                </div>

                {/* Read-only notice */}
                <div className="mt-4 text-center text-xs text-gray-400">
                  This changelog is read-only. No changes can be made to the patient history from this view.
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">
                Failed to load timeline data
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
