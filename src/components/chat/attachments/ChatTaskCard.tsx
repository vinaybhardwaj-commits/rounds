'use client';

// =============================================================================
// ChatTaskCard (CT.5 — Chat Tasks PRD v1.4 §4.5)
//
// Renders the structured chat_task_card custom data attached to a Stream
// message. Shows: title, patient + UHID, assignee + assigner, due date,
// priority chip, status pill. Action buttons gated by viewer's role:
//
//   - Acknowledge — assignee only (hidden after first ack)
//   - Mark in progress / Mark done — assignee, assigner, super_admin
//   - More menu (...) — Reassign / Edit / Cancel / Open in Tasks tab
//
// Re-renders automatically when Stream emits message.updated for this
// message (the partialUpdateMessage call in syncChatTaskCard, CT.4).
//
// Orphan-card defense: every action click first calls GET /api/chat-tasks/[id].
// If 404, the card switches to "(task no longer exists)" state with a
// Hide-message option. Stops users from clicking dead actions.
//
// Urgent priority: red border + pulsing dot.
// =============================================================================

import { useState, useCallback } from 'react';
import {
  ClipboardCheck, CheckCircle2, Circle, AlertCircle, MoreHorizontal,
  Clock, User as UserIcon, Hash,
} from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CardPayload = any;  // Stream custom data is opaque; PRD §4.5 documents shape.

interface ChatTaskCardProps {
  payload: CardPayload;
  /** The viewer's profile id (from useAuth or AppShell context). */
  viewerProfileId: string | null;
  /** The viewer's role — used for super_admin gate. */
  viewerRole: string | null;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800 ring-gray-200',
  in_progress: 'bg-blue-100 text-blue-900 ring-blue-200',
  done: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
  cancelled: 'bg-red-100 text-red-900 ring-red-200',
};

const PRIORITY_TONE: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  normal: 'bg-blue-50 text-blue-800',
  high: 'bg-orange-100 text-orange-900',
  urgent: 'bg-red-100 text-red-900',
};

function formatDue(dueAt: string | null): string | null {
  if (!dueAt) return null;
  try {
    const d = new Date(dueAt);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return `today ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
      ' ' +
      d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return dueAt;
  }
}

export default function ChatTaskCard({ payload, viewerProfileId, viewerRole }: ChatTaskCardProps) {
  // Derive viewer permissions from the latest payload (re-renders on
  // message.updated when assignee changes, etc.).
  const taskId = String(payload?.task_id ?? '');
  const status = String(payload?.status ?? 'pending');
  const priority = String(payload?.priority ?? 'normal');
  const title = String(payload?.title ?? '(untitled task)');
  const dueAt = payload?.due_at ?? null;
  const isPing = !!payload?.is_ping;

  const assigneeId: string | null = payload?.assignee?.id ?? null;
  const assigneeName: string = payload?.assignee?.name ?? 'Assignee';
  const assignerId: string | null = payload?.assigner?.id ?? null;
  const assignerName: string = payload?.assigner?.name ?? 'Assigner';
  const patient = payload?.patient ?? null;

  const isAssignee = !!viewerProfileId && viewerProfileId === assigneeId;
  const isAssigner = !!viewerProfileId && viewerProfileId === assignerId;
  const isSuper = viewerRole === 'super_admin';
  const canTransition = isAssignee || isAssigner || isSuper;
  const canEditOrCancel = isAssigner || isSuper;

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orphan, setOrphan] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Orphan check: GET /api/chat-tasks/[id]; on 404 → mark orphan.
  const checkOrphan = useCallback(async (): Promise<boolean> => {
    if (!taskId) return false;
    try {
      const res = await fetch(`/api/chat-tasks/${encodeURIComponent(taskId)}`);
      if (res.status === 404) {
        setOrphan(true);
        return true;
      }
      return false;
    } catch {
      // Network blip — don't false-positive an orphan; let action proceed.
      return false;
    }
  }, [taskId]);

  const callStatus = useCallback(async (newStatus: 'acknowledged' | 'in_progress' | 'done') => {
    if (busyAction) return;
    setBusyAction(newStatus);
    setError(null);
    try {
      if (await checkOrphan()) return;
      const res = await fetch(`/api/chat-tasks/${encodeURIComponent(taskId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      // Stream's message.updated event will fan the new payload back into
      // this component automatically — no local state update needed.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, checkOrphan, taskId]);

  const callCancel = useCallback(async () => {
    if (busyAction) return;
    if (!confirm('Cancel this task? This cannot be undone.')) return;
    setBusyAction('cancel');
    setError(null);
    try {
      if (await checkOrphan()) return;
      const res = await fetch(`/api/chat-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, checkOrphan, taskId]);

  if (hidden) return null;

  // Orphan state.
  if (orphan) {
    return (
      <div className="my-1 inline-flex max-w-md items-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        <AlertCircle className="h-3.5 w-3.5" />
        <span className="italic">Task no longer exists — created in error or cancelled.</span>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="ml-auto rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] hover:bg-gray-100"
        >
          Hide
        </button>
      </div>
    );
  }

  const dueLabel = formatDue(dueAt);
  const isUrgent = priority === 'urgent';
  const isAcknowledged = !!(payload?.metadata?.acknowledged_at) ||
                         !!(payload?.acknowledged_at);
  const showAcknowledge = isAssignee && status === 'pending' && !isAcknowledged;

  return (
    <div
      className={`my-1.5 inline-flex w-full max-w-xl flex-col gap-2 rounded-lg border bg-white p-3 shadow-sm ${
        isUrgent ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200'
      }`}
    >
      {/* Header row: type label · status pill · priority chip · ping flag */}
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-blue-600 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          {isPing ? 'Task — ping' : 'Task'}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${STATUS_TONE[status] || STATUS_TONE.pending}`}>
          {status.replace(/_/g, ' ')}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_TONE[priority] || PRIORITY_TONE.normal}`}>
          {priority}
        </span>
        {isUrgent && (
          <span className="ml-auto inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
            URGENT
          </span>
        )}
      </div>

      {/* Title */}
      <div className="text-sm font-semibold text-gray-900">{title}</div>

      {/* Patient + due + people */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
        {patient && (
          <span className="inline-flex items-center gap-1">
            <UserIcon className="h-3 w-3" />
            <span className="font-medium text-gray-800">{patient.name || '(unnamed patient)'}</span>
            {patient.uhid && <span className="font-mono text-gray-500">· {patient.uhid}</span>}
          </span>
        )}
        {dueLabel && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            due {dueLabel}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Hash className="h-3 w-3" />
          @{assigneeName}
          <span className="text-gray-400">· by {assignerName}</span>
        </span>
      </div>

      {/* Action row */}
      {status !== 'cancelled' && status !== 'done' && (canTransition || showAcknowledge) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
          {showAcknowledge && (
            <button
              type="button"
              onClick={() => callStatus('acknowledged')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50"
            >
              <Circle className="h-3 w-3" /> Acknowledge
            </button>
          )}
          {canTransition && status !== 'in_progress' && (
            <button
              type="button"
              onClick={() => callStatus('in_progress')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
            >
              <Clock className="h-3 w-3" /> Mark in progress
            </button>
          )}
          {canTransition && (
            <button
              type="button"
              onClick={() => callStatus('done')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-400 bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" /> Mark done
            </button>
          )}
          {canEditOrCancel && (
            <details className="ml-auto group relative">
              <summary className="cursor-pointer rounded-md border border-gray-200 bg-white p-1 text-gray-500 hover:bg-gray-50 list-none">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </summary>
              <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-md">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-[11px] text-gray-700 hover:bg-gray-50"
                  disabled
                  title="Edit / reassign UI ships in CT.6"
                >
                  Edit task… <span className="text-[10px] text-gray-400">(soon)</span>
                </button>
                <button
                  type="button"
                  onClick={callCancel}
                  disabled={busyAction !== null}
                  className="block w-full px-3 py-1.5 text-left text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel task
                </button>
                <a
                  href="/tasks"
                  className="block px-3 py-1.5 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  Open in Tasks tab
                </a>
              </div>
            </details>
          )}
        </div>
      )}

      {/* Inline error */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </div>
      )}

      {/* Acknowledged hint */}
      {isAcknowledged && status === 'pending' && (
        <div className="text-[10px] italic text-gray-500">
          Acknowledged by @{assigneeName}.
        </div>
      )}
    </div>
  );
}
