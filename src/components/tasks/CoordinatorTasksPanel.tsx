'use client';

// =============================================================================
// Rounds — CoordinatorTasksPanel (25 Apr 2026, Phase 3b)
//
// Surfaces auto-tasks from the `tasks` table inside TasksView. Distinct from
// the existing readiness-items flow (which is also visible in this view) —
// these are workflow-driver tasks scoped per case + role.
//
// Each task row shows: title, patient name, case procedure, due date, source
// pill, and a context-aware action button.
//
// Action button is mapped from source_ref:
//   case:initiate_pac      → 'Schedule PAC' → opens SchedulePacModal
//   case:verify_preop      → 'Open case' → routes to case detail (no inline modal yet)
//   default                → 'Open case' if case_id is set, else no-op
//
// On task action that mutates state (like Schedule PAC), the parent route
// closes the task automatically via the transition route's task-closure side
// effect. We re-fetch on close so the row disappears.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ClipboardList, ExternalLink, Stethoscope, MessageSquare, Eye, Play, Check } from 'lucide-react';
import SchedulePacModal from '@/components/drawer/SchedulePacModal';
// CT.10 — viewer-id helper for chat-task assignee permission gating.
import { useChatContext } from '@/providers/ChatProvider';
// CT.11 — telemetry hooks per PRD §CT.11.
import { trackFeature } from '@/lib/session-tracker';

interface TaskRow {
  id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  owner_role: string | null;
  due_at: string | null;
  status: string;
  source: string;
  source_ref: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  hospital_slug: string | null;
  patient_name: string | null;
  patient_thread_id: string | null;
  case_state: string | null;
  case_planned_procedure: string | null;
  case_planned_surgery_date: string | null;
  // CT.10: chat-task fields surfaced from CT.2's GET /api/tasks extension.
  priority: string;                       // 'low' | 'normal' | 'high' | 'urgent'
  source_channel_id: string | null;       // Stream channel.id (without type prefix)
  source_channel_type: string | null;     // 'patient-thread' | 'department' | 'direct' | 'broadcast'
  source_message_id: string | null;       // the original chat message that triggered the task (CT.8 path)
  posted_message_id: string | null;       // the chat-task-card message rendered in the channel
  uhid: string | null;                    // patient identifier
  assignee_profile_id: string | null;     // for ack/start/done permission gate
  metadata: Record<string, unknown> | null;
}

function fmt(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

export default function CoordinatorTasksPanel() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pacModalCaseId, setPacModalCaseId] = useState<string | null>(null);
  const [pacModalCaseState, setPacModalCaseState] = useState<string>('draft');
  const [pacModalPatientName, setPacModalPatientName] = useState<string | null>(null);
  // CT.10: viewer profile id (for assignee permission gate on chat-task action buttons).
  const { client } = useChatContext();
  const viewerProfileId = client?.userID || null;
  // CT.10: in-flight status mutations (taskId → boolean) so we can disable buttons during PATCH.
  const [statusBusy, setStatusBusy] = useState<Record<string, boolean>>({});

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/tasks?status=pending&limit=100')
      .then((r) => r.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data)) setRows(body.data);
        else setError(body?.error || 'Failed to load tasks');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openSchedulePac = (task: TaskRow) => {
    if (!task.case_id) return;
    setPacModalCaseId(task.case_id);
    setPacModalCaseState(task.case_state || 'draft');
    setPacModalPatientName(task.patient_name || null);
  };
  const closeSchedulePac = () => {
    setPacModalCaseId(null);
    setPacModalCaseState('draft');
    setPacModalPatientName(null);
  };
  const onScheduled = () => {
    closeSchedulePac();
    reload();
  };

  // CT.10: PATCH /api/chat-tasks/[id]/status — optimistic, rollback on error.
  const mutateChatTaskStatus = async (taskId: string, nextStatus: 'acknowledged' | 'in_progress' | 'done') => {
    setStatusBusy((m) => ({ ...m, [taskId]: true }));
    // Optimistic: update local row state.
    // 'acknowledged' is a metadata flag — status column stays 'pending' (per PRD §5.2),
    // so we don't update the row's status string for it. We still surface the next button
    // ('Start') by checking metadata.acknowledged_at via a refetch.
    const prevRow = rows.find((r) => r.id === taskId);
    if (!prevRow) return;
    const optimisticRow = nextStatus === 'acknowledged'
      ? { ...prevRow, metadata: { ...(prevRow.metadata || {}), acknowledged_at: new Date().toISOString() } }
      : { ...prevRow, status: nextStatus };
    setRows((rs) => rs.map((r) => (r.id === taskId ? optimisticRow : r)));
    try {
      const res = await fetch(`/api/chat-tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      // CT.11 — telemetry. fromStatus from prevRow (post-optimistic UI but pre-server confirm).
      const fromStatus = prevRow.status || 'pending';
      const createdAt = prevRow.created_at;
      const latency_ms = createdAt ? Math.max(0, Date.now() - new Date(createdAt).getTime()) : null;
      if (nextStatus === 'acknowledged') {
        trackFeature('chat_task_acknowledged', { task_id: taskId, latency_ms, source: 'panel' });
      }
      trackFeature('chat_task_status_changed', {
        task_id: taskId,
        from_status: fromStatus,
        to_status: nextStatus,
        source: 'panel',
      });
      // 'done' rows usually drop out of the pending list — refetch to reflect server truth.
      if (nextStatus === 'done') reload();
    } catch (err) {
      // Rollback.
      setRows((rs) => rs.map((r) => (r.id === taskId ? prevRow : r)));
      alert(`Status update failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setStatusBusy((m) => {
        const next = { ...m };
        delete next[taskId];
        return next;
      });
    }
  };

  // CT.10: open the source channel in chat tab via custom event (same React tree).
  // Falls back to nothing if AppShell hasn't subscribed (no-op, harmless).
  const openInChat = (channelId: string | null, channelType: string | null, messageId: string | null) => {
    if (!channelId) return;
    window.dispatchEvent(new CustomEvent('rounds:open-chat', {
      detail: { channelId, channelType, messageId },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading coordinator tasks…
      </div>
    );
  }
  if (error) {
    return <p className="py-12 text-center text-sm text-red-600">Error: {error}</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-gray-400">
        <ClipboardList size={32} />
        <p className="text-sm">No coordinator tasks pending.</p>
        <p className="text-xs">Auto-tasks from marketing handoffs and case scheduling appear here.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {rows.map((t) => {
          const isInitiatePac = t.source_ref === 'case:initiate_pac';
          const isVerifyPreop = t.source_ref === 'case:verify_preop';
          // CT.10: chat-task detection + permission + state derivations.
          const isChatTask = t.source === 'chat';
          const isAssignee = !!viewerProfileId && t.assignee_profile_id === viewerProfileId;
          const isAcked = !!(t.metadata && (t.metadata as Record<string, unknown>).acknowledged_at);
          const busy = !!statusBusy[t.id];
          const priority = (t.priority || 'normal').toLowerCase();
          const priorityCfg: Record<string, { bg: string; text: string; label: string }> = {
            urgent: { bg: 'bg-red-100', text: 'text-red-700', label: 'urgent' },
            high:   { bg: 'bg-orange-100', text: 'text-orange-700', label: 'high' },
            normal: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'normal' },
            low:    { bg: 'bg-slate-50', text: 'text-slate-500', label: 'low' },
          };
          const pCfg = priorityCfg[priority] || priorityCfg.normal;
          return (
            <li
              key={t.id}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{t.title}</span>
                    {t.source === 'auto' && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-purple-700">
                        auto
                      </span>
                    )}
                    {/* CT.10: chat pill — distinguishes chat-tasks from auto-tasks */}
                    {isChatTask && (
                      <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-indigo-700">
                        <MessageSquare size={9} /> chat
                      </span>
                    )}
                    {/* CT.10: priority chip — only meaningful for chat-tasks (auto-tasks default 'normal') */}
                    {isChatTask && (
                      <span className={`rounded ${pCfg.bg} px-1.5 py-0.5 text-[10px] font-medium uppercase ${pCfg.text}`}>
                        {pCfg.label}
                      </span>
                    )}
                    {/* CT.10: surface acknowledged state for chat-tasks */}
                    {isChatTask && isAcked && t.status === 'pending' && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700">
                        ack'd
                      </span>
                    )}
                    {isChatTask && t.status === 'in_progress' && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
                        in progress
                      </span>
                    )}
                    {t.owner_role && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-700">
                        {t.owner_role.replace(/_/g, ' ')}
                      </span>
                    )}
                    {t.hospital_slug && (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sky-700">
                        {t.hospital_slug}
                      </span>
                    )}
                  </div>
                  {t.patient_name && (
                    <p className="mt-1 text-xs text-gray-700">
                      Patient: <span className="font-medium">{t.patient_name}</span>
                      {/* CT.10: surface UHID for chat-tasks (auto-tasks already have case context) */}
                      {isChatTask && t.uhid && <span className="ml-1 text-gray-500">({t.uhid})</span>}
                      {t.case_planned_procedure && <> · {t.case_planned_procedure}</>}
                      {t.case_planned_surgery_date && <> · planned {new Date(t.case_planned_surgery_date).toLocaleDateString()}</>}
                    </p>
                  )}
                  {t.description && (
                    <p className="mt-1 text-xs text-gray-600 line-clamp-3">{t.description}</p>
                  )}
                  <p className="mt-1 text-[11px] text-gray-400">
                    {t.due_at ? <>Due {fmt(t.due_at)} · </> : null}created {fmt(t.created_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {/* Existing auto-task action buttons — unchanged */}
                  {isInitiatePac && t.case_id && (
                    <button
                      type="button"
                      onClick={() => openSchedulePac(t)}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Stethoscope size={12} /> Schedule PAC
                    </button>
                  )}
                  {isVerifyPreop && t.case_id && (
                    <a
                      href={`/case/${t.case_id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <ExternalLink size={12} /> Open case
                    </a>
                  )}
                  {!isChatTask && !isInitiatePac && !isVerifyPreop && t.case_id && (
                    <a
                      href={`/case/${t.case_id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <ExternalLink size={12} /> Open
                    </a>
                  )}

                  {/* CT.10: chat-task action stack — Open in chat + status mutate buttons */}
                  {isChatTask && t.source_channel_id && (
                    <button
                      type="button"
                      onClick={() => openInChat(t.source_channel_id, t.source_channel_type, t.posted_message_id || t.source_message_id)}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      <MessageSquare size={12} /> Open in chat
                    </button>
                  )}
                  {isChatTask && isAssignee && t.status === 'pending' && !isAcked && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => mutateChatTaskStatus(t.id, 'acknowledged')}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Eye size={12} /> Acknowledge
                    </button>
                  )}
                  {/* CT.10: Start button — assignee can move pending → in_progress.
                      'acknowledged' is a metadata flag (status stays 'pending' per PRD §5.2),
                      so the gate is just status === 'pending'. */}
                  {isChatTask && isAssignee && t.status === 'pending' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => mutateChatTaskStatus(t.id, 'in_progress')}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      <Play size={12} /> Start
                    </button>
                  )}
                  {isChatTask && isAssignee && t.status === 'in_progress' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => mutateChatTaskStatus(t.id, 'done')}
                      className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      <Check size={12} /> Mark done
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pacModalCaseId && (
        <SchedulePacModal
          caseId={pacModalCaseId}
          patientName={pacModalPatientName}
          currentState={pacModalCaseState}
          isOpen={true}
          onClose={closeSchedulePac}
          onScheduled={onScheduled}
        />
      )}
    </>
  );
}
