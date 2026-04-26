'use client';

// =============================================================================
// CreateTaskModal (CT.6 — Chat Tasks PRD v1.4 §4.2)
//
// Modal opened from the message composer's `+` button. Lets the assigner
// fill assignee / patient / title / description / due / priority and POST
// to /api/chat-tasks. After save, the modal closes and the new card
// appears in the channel within ~2s (driven by Stream's message.created
// event hitting the existing message renderer).
//
// Patient channel: patient is pre-locked + read-only.
// Other channels: patient typeahead via /api/patients/searchable.
// Assignee typeahead via /api/profiles?search=<q>.
//
// Mobile: full-screen sheet (max-w-none + h-full at sm: breakpoint).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Loader2, Check, AlertCircle, ClipboardCheck } from 'lucide-react';

interface PatientHit {
  id: string;
  patient_name: string | null;
  uhid: string | null;
  current_stage: string;
}

interface ProfileHit {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  department_name: string | null;
}

interface Patient {
  id: string;
  name: string | null;
  uhid: string | null;
}

export interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Stream channel ID this task is being created in (custom data). */
  channelId: string;
  /** Stream channel type (patient-thread / direct / department / etc). */
  channelType: string;
  /** When the channel is patient-scoped, this pre-locks the patient field. */
  presetPatient?: Patient | null;
  /** Caller's profile id for self-assign default. */
  viewerProfileId: string;
  /** Optional: prefill from a selected source message ('Make this a task'). */
  presetTitle?: string;
  presetDescription?: string;
  presetSourceMessageId?: string;
  /** Called after successful create. Parent typically clears any source-msg state. */
  onCreated?: () => void;
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

export default function CreateTaskModal({
  isOpen, onClose, channelId, channelType, presetPatient, viewerProfileId,
  presetTitle, presetDescription, presetSourceMessageId, onCreated,
}: CreateTaskModalProps) {
  // Form state.
  const [assignee, setAssignee] = useState<ProfileHit | null>(null);
  const [patient, setPatient] = useState<Patient | null>(presetPatient ?? null);
  const [title, setTitle] = useState(presetTitle ?? '');
  const [description, setDescription] = useState(presetDescription ?? '');
  const [dueAt, setDueAt] = useState<string>(''); // datetime-local string
  const [priority, setPriority] = useState<string>('normal');

  // Typeahead state — assignee.
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [assigneeHits, setAssigneeHits] = useState<ProfileHit[]>([]);
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);

  // Typeahead state — patient (only used when not pre-locked).
  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientHit[]>([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientOpen, setPatientOpen] = useState(false);
  const patientRef = useRef<HTMLDivElement>(null);

  // Submit state.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patientLocked = presetPatient !== undefined && presetPatient !== null;

  // Reset on open.
  useEffect(() => {
    if (!isOpen) return;
    setAssignee(null);
    setPatient(presetPatient ?? null);
    setTitle(presetTitle ?? '');
    setDescription(presetDescription ?? '');
    setDueAt('');
    setPriority('normal');
    setAssigneeQuery('');
    setAssigneeHits([]);
    setAssigneeOpen(false);
    setPatientQuery('');
    setPatientHits([]);
    setPatientOpen(false);
    setError(null);
  }, [isOpen, presetPatient, presetTitle, presetDescription]);

  // Debounced assignee search.
  useEffect(() => {
    if (!isOpen) return;
    if (assigneeQuery.trim().length < 2) {
      setAssigneeHits([]);
      return;
    }
    setAssigneeLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/profiles?search=${encodeURIComponent(assigneeQuery.trim())}&limit=8`)
        .then((r) => r.json())
        .then((b) => {
          const data = b?.data ?? [];
          setAssigneeHits(Array.isArray(data) ? (data as ProfileHit[]) : []);
        })
        .catch(() => setAssigneeHits([]))
        .finally(() => setAssigneeLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [assigneeQuery, isOpen]);

  // Debounced patient search (only when not pre-locked).
  useEffect(() => {
    if (!isOpen || patientLocked) return;
    if (patientQuery.trim().length < 2) {
      setPatientHits([]);
      return;
    }
    setPatientLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/patients/searchable?q=${encodeURIComponent(patientQuery.trim())}&limit=8`)
        .then((r) => r.json())
        .then((b) => {
          const data = b?.data ?? [];
          setPatientHits(Array.isArray(data) ? (data as PatientHit[]) : []);
        })
        .catch(() => setPatientHits([]))
        .finally(() => setPatientLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [patientQuery, isOpen, patientLocked]);

  // Outside-click closes typeahead dropdowns.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) {
        setAssigneeOpen(false);
      }
      if (patientRef.current && !patientRef.current.contains(e.target as Node)) {
        setPatientOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!title.trim()) return false;
    if (!assignee && !title.includes('/me')) return false; // require assignee unless explicit self
    return true;
  }, [submitting, title, assignee]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const assigneeId = assignee?.id ?? viewerProfileId; // self-assign fallback
      const dueIso = dueAt ? new Date(dueAt).toISOString() : null;

      const res = await fetch('/api/chat-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channelId,
          channel_type: channelType,
          assignee_profile_id: assigneeId,
          title: title.trim(),
          description: description.trim() || undefined,
          patient_thread_id: patient?.id ?? null,
          due_at: dueIso,
          priority,
          source_message_id: presetSourceMessageId ?? null,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        // Surface 429 retry-after specifically.
        if (res.status === 429 && body.retry_after_seconds) {
          throw new Error(`Rate limit: try again in ${body.retry_after_seconds}s`);
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, assignee, viewerProfileId, dueAt, channelId, channelType, title, description, patient, priority, presetSourceMessageId, onCreated, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-xl"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">New chat task</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Patient — pre-locked or typeahead */}
          <section ref={patientRef}>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Patient {patientLocked ? '· auto-filled from this channel' : '(optional)'}
            </label>
            {patientLocked && patient ? (
              <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <strong className="text-gray-900">{patient.name}</strong>
                {patient.uhid && <span className="ml-1 font-mono text-gray-600">· {patient.uhid}</span>}
                <span className="ml-2 text-[10px] uppercase text-gray-500">read-only</span>
              </div>
            ) : (
              <div className="relative mt-1">
                <div className="flex items-center rounded-md border border-gray-300 bg-white">
                  <Search className="ml-2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={patient ? `${patient.name ?? ''} ${patient.uhid ?? ''}` : patientQuery}
                    onChange={(e) => { setPatient(null); setPatientQuery(e.target.value); setPatientOpen(true); }}
                    onFocus={() => { if (patientHits.length > 0) setPatientOpen(true); }}
                    placeholder="Search by name, UHID, or phone…"
                    className="flex-1 bg-transparent px-2 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none"
                  />
                  {(patient || patientQuery) && (
                    <button onClick={() => { setPatient(null); setPatientQuery(''); }} className="mr-2 text-gray-400 hover:text-gray-600">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {patientLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin text-gray-400" />}
                </div>
                {patientOpen && patientHits.length > 0 && (
                  <ul role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                    {patientHits.map((h) => (
                      <li
                        key={h.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setPatient({ id: h.id, name: h.patient_name, uhid: h.uhid });
                          setPatientQuery('');
                          setPatientOpen(false);
                        }}
                        className="cursor-pointer border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-blue-50"
                      >
                        <div className="font-medium text-gray-900">{h.patient_name || '(no name)'}</div>
                        <div className="text-[11px] text-gray-500">
                          {h.uhid && <span className="font-mono">{h.uhid}</span>}
                          {h.uhid && <span> · </span>}
                          <span className="capitalize">{h.current_stage.replace(/_/g, ' ')}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* Assignee */}
          <section ref={assigneeRef}>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Assignee <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <div className="flex items-center rounded-md border border-gray-300 bg-white">
                <Search className="ml-2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={assignee ? (assignee.full_name || assignee.email || 'Picked') : assigneeQuery}
                  onChange={(e) => { setAssignee(null); setAssigneeQuery(e.target.value); setAssigneeOpen(true); }}
                  onFocus={() => { if (assigneeHits.length > 0) setAssigneeOpen(true); }}
                  placeholder="Search by name or email…"
                  className="flex-1 bg-transparent px-2 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none"
                />
                {(assignee || assigneeQuery) && (
                  <button onClick={() => { setAssignee(null); setAssigneeQuery(''); }} className="mr-2 text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                )}
                {assigneeLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin text-gray-400" />}
              </div>
              {assigneeOpen && assigneeHits.length > 0 && (
                <ul role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                  {assigneeHits.map((h) => (
                    <li
                      key={h.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAssignee(h);
                        setAssigneeQuery('');
                        setAssigneeOpen(false);
                      }}
                      className="cursor-pointer border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-blue-50"
                    >
                      <div className="font-medium text-gray-900">{h.full_name || h.email || '(no name)'}</div>
                      <div className="text-[11px] text-gray-500">
                        {h.role && <span className="capitalize">{h.role.replace(/_/g, ' ')}</span>}
                        {h.department_name && <span> · {h.department_name}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-1 text-[10px] text-gray-500">
              Tip: leave empty to assign to yourself.
            </p>
          </section>

          {/* Title */}
          <section>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 200))}
              placeholder="What needs doing?"
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="mt-1 text-right text-[10px] text-gray-400">{title.length}/200</div>
          </section>

          {/* Description */}
          <section>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
              rows={2}
              placeholder="Extra context"
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </section>

          {/* Due + priority — two columns on sm+, stacked on mobile */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Due (optional)</label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </section>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {submitting ? 'Creating…' : 'Create task'}
          </button>
        </footer>
      </div>
    </div>
  );
}
