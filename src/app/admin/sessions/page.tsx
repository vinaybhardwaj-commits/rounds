'use client';

import { useState, useEffect } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  Wrench,
  HelpCircle,
  AlertTriangle,
  Clipboard,
  Eye,
  Clock,
} from 'lucide-react';
import { AdminShell } from '@/components/admin/AdminShell';

// Types
interface SessionUser {
  id: string;
  full_name: string;
  email: string;
  department_name: string;
  department_slug: string;
  first_login_at: string;
  login_count: number;
}

interface SessionListItem {
  session_id: string;
  profile_id: string;
  full_name: string;
  email: string;
  department_name: string;
  department_slug: string;
  session_start: string;
  session_end: string;
  duration_seconds: number;
  page_count: number;
  error_count: number;
  total_events: number;
  is_first_session: boolean;
  pages_visited: string[];
}

interface TimelineEvent {
  id: number;
  event_type: string;
  page: string | null;
  feature: string | null;
  detail: string | null;
  created_at: string;
  time_spent_seconds: number;
}

interface ErrorEvent {
  id: number;
  message: string;
  component: string;
  severity: string;
  created_at: string;
}

interface HelpInteraction {
  id: number;
  question: string;
  matched_features: string[];
  response_source: string;
  created_at: string;
}

interface SessionSummary {
  start: string;
  end: string;
  duration_seconds: number;
  page_count: number;
  total_events: number;
  error_count: number;
  help_count: number;
  is_first_session: boolean;
}

interface SessionDetail {
  session_id: string;
  user: SessionUser;
  summary: SessionSummary;
  timeline: TimelineEvent[];
  errors: ErrorEvent[];
  help_interactions: HelpInteraction[];
}

interface SessionListResponse {
  success: boolean;
  data: {
    sessions: SessionListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

interface SessionDetailResponse {
  success: boolean;
  data: SessionDetail;
}

// Skeleton component
function SessionListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-14 bg-gray-100 rounded-lg animate-pulse"
        />
      ))}
    </div>
  );
}

// Format time duration
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

// Format timestamp
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Get user initials
function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Event icon mapping
function getEventIcon(eventType: string) {
  const iconProps = { size: 16, strokeWidth: 2 };
  switch (eventType) {
    case 'session_start':
      return <Circle {...iconProps} className="text-green-600 fill-green-100" />;
    case 'session_end':
      return <Circle {...iconProps} className="text-red-600 fill-red-100" />;
    case 'page_view':
      return <FileText {...iconProps} className="text-blue-600" />;
    case 'feature_use':
      return <Wrench {...iconProps} className="text-purple-600" />;
    case 'help_search':
    case 'help_view':
      return <HelpCircle {...iconProps} className="text-teal-600" />;
    case 'error_encountered':
      return <AlertTriangle {...iconProps} className="text-red-600" />;
    case 'form_field_focus':
    case 'form_abandon':
      return <Clipboard {...iconProps} className="text-orange-600" />;
    case 'tab_hidden':
    case 'tab_visible':
      return <Eye {...iconProps} className="text-gray-600" />;
    default:
      return <Circle {...iconProps} className="text-gray-400" />;
  }
}

// Event description
function getEventDescription(event: TimelineEvent): string {
  switch (event.event_type) {
    case 'session_start':
      return 'Session started';
    case 'session_end':
      return 'Session ended';
    case 'page_view':
      return `Viewed page: ${event.page}`;
    case 'feature_use':
      return `Used feature: ${event.feature}`;
    case 'help_search':
      return `Searched for help: ${event.detail}`;
    case 'help_view':
      return `Viewed help topic: ${event.detail}`;
    case 'error_encountered':
      return `Error: ${event.detail}`;
    case 'form_field_focus':
      return `Focused on form field: ${event.detail}`;
    case 'form_abandon':
      return `Abandoned form: ${event.detail}`;
    case 'tab_hidden':
      return 'Tab hidden';
    case 'tab_visible':
      return 'Tab visible';
    default:
      return event.event_type;
  }
}

// Session list row
function SessionListRow({
  session,
  isSelected,
  onClick,
}: {
  session: SessionListItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const startTime = new Date(session.session_start);
  const timeStr = startTime.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 text-left rounded-lg border transition-all ${
        isSelected
          ? 'border-even-blue bg-even-blue bg-opacity-5'
          : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Initials circle */}
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-8 h-8 rounded-full bg-even-blue text-white text-xs font-semibold flex items-center justify-center">
            {getInitials(session.full_name)}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-even-navy truncate">
              {session.full_name}
            </span>
            {session.is_first_session && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded whitespace-nowrap">
                🆕 NEW
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">
            {session.department_name}
          </div>
          <div className="flex gap-3 mt-1 text-xs text-gray-500">
            <span>{timeStr}</span>
            <span>{formatDuration(session.duration_seconds)}</span>
            <span>{session.page_count} pages</span>
            {session.error_count > 0 && (
              <span className="text-red-600 font-semibold">
                {session.error_count} errors
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// Session timeline
function SessionTimeline({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/admin/sessions/${sessionId}`)
      .then(res => res.json())
      .then((json: SessionDetailResponse) => {
        if (json.success) {
          setSession(json.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        Select a session to view details
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        Failed to load session
      </div>
    );
  }

  // Merge timeline, errors, and help interactions into chronological order
  const mergedEvents: Array<{
    type: 'timeline' | 'error' | 'help';
    timestamp: string;
    data: TimelineEvent | ErrorEvent | HelpInteraction;
  }> = [];

  session.timeline.forEach(e => {
    mergedEvents.push({
      type: 'timeline',
      timestamp: e.created_at,
      data: e,
    });
  });

  session.errors.forEach(e => {
    mergedEvents.push({
      type: 'error',
      timestamp: e.created_at,
      data: e,
    });
  });

  session.help_interactions.forEach(e => {
    mergedEvents.push({
      type: 'help',
      timestamp: e.created_at,
      data: e,
    });
  });

  mergedEvents.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeA - timeB;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
        {/* User info */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-even-blue text-white text-sm font-semibold flex items-center justify-center">
              {getInitials(session.user.full_name)}
            </div>
            <div>
              <h3 className="font-semibold text-even-navy">
                {session.user.full_name}
              </h3>
              <p className="text-xs text-gray-600">{session.user.email}</p>
            </div>
          </div>
          <div className="text-xs text-gray-600 space-y-1 ml-13">
            <div>Department: {session.user.department_name}</div>
            <div>
              Role: {session.user.login_count === 1 ? 'First-time user' : `Active user (${session.user.login_count} logins)`}
            </div>
          </div>
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {session.summary.is_first_session && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded">
              🆕 First Session
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
            ⏱ {formatDuration(session.summary.duration_seconds)}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded">
            📄 {session.summary.page_count} pages
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 text-xs font-semibold rounded">
            📋 {session.summary.total_events} events
          </span>
          {session.summary.error_count > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
              ⚠ {session.summary.error_count} errors
            </span>
          )}
          {session.summary.help_count > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-100 text-teal-700 text-xs font-semibold rounded">
              ❓ {session.summary.help_count} help queries
            </span>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {mergedEvents.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-4">
            No events recorded
          </div>
        ) : (
          mergedEvents.map((event, idx) => {
            const isTimelineEvent = event.type === 'timeline';
            const isErrorEvent = event.type === 'error';
            const isHelpEvent = event.type === 'help';

            if (isTimelineEvent) {
              const tlEvent = event.data as TimelineEvent;
              return (
                <div key={`${event.type}-${tlEvent.id}`} className="flex gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                  <div className="flex-shrink-0 mt-1">
                    {getEventIcon(tlEvent.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-gray-700">
                        {getEventDescription(tlEvent)}
                      </span>
                      {tlEvent.time_spent_seconds > 0 && tlEvent.event_type === 'page_view' && (
                        <span className="text-xs text-gray-500">
                          ({formatDuration(tlEvent.time_spent_seconds)})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatTime(tlEvent.created_at)}
                    </span>
                  </div>
                </div>
              );
            }

            if (isErrorEvent) {
              const err = event.data as ErrorEvent;
              return (
                <div
                  key={`${event.type}-${err.id}`}
                  className="flex gap-3 p-3 bg-red-50 border-b border-gray-100 last:border-b-0 hover:bg-red-100"
                >
                  <div className="flex-shrink-0 mt-1">
                    <AlertTriangle size={16} className="text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-red-700">
                      {err.message}
                    </div>
                    <div className="text-xs text-red-600 space-y-0.5">
                      <div>Component: {err.component}</div>
                      <div>Severity: {err.severity}</div>
                    </div>
                    <span className="text-xs text-gray-500 mt-1 block">
                      {formatTime(err.created_at)}
                    </span>
                  </div>
                </div>
              );
            }

            if (isHelpEvent) {
              const help = event.data as HelpInteraction;
              return (
                <div
                  key={`${event.type}-${help.id}`}
                  className="flex gap-3 p-3 bg-teal-50 border-b border-gray-100 last:border-b-0 hover:bg-teal-100"
                >
                  <div className="flex-shrink-0 mt-1">
                    <HelpCircle size={16} className="text-teal-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-teal-700">
                      Help: {help.question}
                    </div>
                    <div className="text-xs text-teal-600">
                      Source: {help.response_source}
                      {help.matched_features.length > 0 && ` • Matched: ${help.matched_features.join(', ')}`}
                    </div>
                    <span className="text-xs text-gray-500 mt-1 block">
                      {formatTime(help.created_at)}
                    </span>
                  </div>
                </div>
              );
            }
          })
        )}
      </div>
    </div>
  );
}

// Main page
export default function SessionsExplorer() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, admissions: 0, escalations: 0 });
  const [healthData, setHealthData] = useState(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [firstSessionsOnly, setFirstSessionsOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'longest' | 'most_pages'>('recent');

  // Fetch user role and badges
  useEffect(() => {
    fetch('/api/profiles/me')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data?.role) setUserRole(d.data.role);
      })
      .catch(() => {});

    Promise.all([
      fetch('/api/admin/approvals')
        .then(r => r.json())
        .catch(() => ({ data: [] })),
      fetch('/api/escalation/log?resolved=false')
        .then(r => r.json())
        .catch(() => ({ data: [] })),
      fetch('/api/admission-tracker')
        .then(r => r.json())
        .catch(() => ({ data: [] })),
    ]).then(([approvals, escalations, admissions]) => {
      setBadges({
        approvals: approvals.data?.length || 0,
        escalations: escalations.data?.length || 0,
        admissions: admissions.data?.length || 0,
      });
    });

    fetch('/api/admin/health')
      .then(r => r.json())
      .then(d => setHealthData({
        llm: { status: d.status || 'down', latency_ms: d.latency_ms || 0 },
        errors_1h: 0,
        error_sparkline: [],
        active_sessions: 0,
        api_p95_ms: 0,
        api_trend: 'stable' as const,
        forms_today: 0,
        forms_yesterday: 0,
        last_deploy: { time: '', sha: '' },
      }))
      .catch(() => {});
  }, []);

  // Fetch sessions
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: '30',
      sort: sortBy,
    });

    if (searchQuery) {
      params.append('search', searchQuery);
    }
    if (selectedDepartment) {
      params.append('department', selectedDepartment);
    }
    if (firstSessionsOnly) {
      params.append('first_session', 'true');
    }

    fetch(`/api/admin/sessions?${params}`)
      .then(res => res.json())
      .then((json: SessionListResponse) => {
        if (json.success) {
          setSessions(json.data.sessions);
          setTotalPages(json.data.pagination.totalPages);
          if (json.data.sessions.length === 0) {
            setSelectedSessionId(null);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, searchQuery, selectedDepartment, firstSessionsOnly, sortBy]);

  // Fetch departments list independently (not derived from session results)
  const [departments, setDepartments] = useState<{ name: string; slug: string }[]>([]);
  useEffect(() => {
    fetch('/api/admin/adoption/departments')
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.data)) {
          setDepartments(
            d.data.map((dept: any) => ({ name: dept.department_name, slug: dept.slug }))
              .sort((a: any, b: any) => a.name.localeCompare(b.name))
          );
        }
      })
      .catch(() => {});
  }, []);

  return (
    <AdminShell
      activeSection="sessions"
      userRole={userRole}
      badges={badges}
      health={healthData}
    >
      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-200px)]">
        {/* LEFT PANEL: Session List (35%) */}
        <div className="flex flex-col w-full lg:w-[35%] bg-white rounded-xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-gray-100 space-y-3">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
              />
            </div>

            {/* Filters and sort */}
            <div className="space-y-2">
              {/* Department dropdown */}
              <select
                value={selectedDepartment}
                onChange={e => {
                  setSelectedDepartment(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
              >
                <option value="">All departments</option>
                {departments.map(dept => (
                  <option key={dept.slug} value={dept.slug}>
                    {dept.name}
                  </option>
                ))}
              </select>

              {/* First sessions toggle */}
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={firstSessionsOnly}
                  onChange={e => {
                    setFirstSessionsOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="rounded"
                />
                <span className="text-gray-700">First sessions only</span>
              </label>

              {/* Sort selector */}
              <select
                value={sortBy}
                onChange={e => {
                  setSortBy(e.target.value as any);
                  setPage(1);
                }}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
              >
                <option value="recent">Most recent</option>
                <option value="longest">Longest duration</option>
                <option value="most_pages">Most pages viewed</option>
              </select>
            </div>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <SessionListSkeleton />
            ) : sessions.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-8">
                No sessions found
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map(session => (
                  <SessionListRow
                    key={session.session_id}
                    session={session}
                    isSelected={selectedSessionId === session.session_id}
                    onClick={() => setSelectedSessionId(session.session_id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className="border-t border-gray-100 p-3 flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-xs text-gray-600">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* RIGHT PANEL: Session Timeline (65%) */}
        <div className="flex flex-col w-full lg:w-[65%] bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            <SessionTimeline sessionId={selectedSessionId || ''} />
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
