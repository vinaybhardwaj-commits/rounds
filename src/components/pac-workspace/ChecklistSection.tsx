'use client';

// =============================================================================
// ChecklistSection — PCW.3 live Checklist panel
//
// Renders pac_workspace_progress.checklist_state items with per-item:
//   - Tick / Untick / Mark N/A actions
//   - Required pill
//   - Day-of-surgery gating (button disabled + chip explainer)
//   - SOP ref tooltip (e.g. §6.4 NPO)
//   - Inline notes editor (collapsed by default)
//   - Actor + ticked_at timestamp display when state='done' or 'na'
//   - Add ad-hoc item form
// =============================================================================

import { useCallback, useMemo, useState } from 'react';
import {
  ListChecks, Plus, Loader2, Check, Circle, Slash, AlertCircle, Lock, BookOpen,
} from 'lucide-react';
import type { PacChecklistItem } from '@/lib/pac-workspace/types';

interface Props {
  caseId: string;
  templateCode: string;
  items: PacChecklistItem[];
  plannedSurgeryDate: string | null;
  canWrite: boolean;
  onUpdated: () => void;
}

export function ChecklistSection({
  caseId, templateCode, items, plannedSurgeryDate, canWrite, onUpdated,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isDayOfSurgery = plannedSurgeryDate === today;
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newRequired, setNewRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedNotesId, setExpandedNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const counts = useMemo(() => {
    const total = items.length;
    const done = items.filter((it) => it.state === 'done').length;
    const na = items.filter((it) => it.state === 'na').length;
    const required = items.filter((it) => it.required).length;
    const requiredDone = items.filter((it) => it.required && (it.state === 'done' || it.state === 'na')).length;
    return { total, done, na, required, requiredDone };
  }, [items]);

  const send = useCallback(
    async (body: Record<string, unknown>, opLabel: string) => {
      setError(null);
      setSavingId(opLabel);
      try {
        const res = await fetch(`/api/pac-workspace/${caseId}/checklist`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        onUpdated();
        if (Array.isArray(json.blocked) && json.blocked.length > 0) {
          setError(`Blocked: ${json.blocked.length} item(s) need day-of-surgery to tick`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingId(null);
      }
    },
    [caseId, onUpdated],
  );

  const toggle = (item: PacChecklistItem, nextState: PacChecklistItem['state']) =>
    send({ items: [{ id: item.id, state: nextState }] }, item.id);

  const saveNotes = (item: PacChecklistItem, notes: string) =>
    send({ items: [{ id: item.id, notes }] }, item.id);

  const addAdhoc = () => {
    const label = newLabel.trim();
    if (!label) return;
    send({ add: { label, required: newRequired } }, '__add__').then(() => {
      setNewLabel('');
      setNewRequired(false);
      setShowAdd(false);
    });
  };

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <ListChecks size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Checklist</h3>
        <span className="text-[11px] text-gray-400">
          {counts.done}/{counts.total} done
          {counts.required > 0 && ` · required ${counts.requiredDone}/${counts.required}`}
        </span>
        <span className="text-[10px] text-gray-400 italic">{templateCode}</span>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="ml-auto text-xs bg-indigo-600 text-white px-2.5 py-1 rounded inline-flex items-center gap-1 hover:bg-indigo-700"
          >
            <Plus size={11} /> Add item
          </button>
        )}
      </header>

      {error && (
        <div className="mb-2 border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-1.5 text-xs flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {showAdd && canWrite && (
        <div className="mb-3 bg-indigo-50/30 border border-indigo-100 rounded-md p-2 flex items-center gap-2">
          <input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Custom checklist item (e.g. 'Confirm consent witnessed')"
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
            onKeyDown={(e) => e.key === 'Enter' && addAdhoc()}
          />
          <label className="text-xs text-gray-600 inline-flex items-center gap-1">
            <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
            required
          </label>
          <button
            type="button"
            disabled={savingId === '__add__' || !newLabel.trim()}
            onClick={addAdhoc}
            className="text-xs bg-indigo-600 text-white px-2 py-1 rounded inline-flex items-center gap-1 disabled:opacity-50"
          >
            {savingId === '__add__' ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Add
          </button>
          <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-gray-500 px-2 py-1">
            Cancel
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No checklist items.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => {
            const blocked = item.gating_condition === 'day_of_surgery' && !isDayOfSurgery;
            const expanded = expandedNotesId === item.id;
            const stateBadgeClass =
              item.state === 'done' ? 'bg-green-100 text-green-700' :
              item.state === 'na'   ? 'bg-gray-200 text-gray-600' :
                                       'bg-gray-100 text-gray-700';
            const stateLabel = item.state === 'done' ? 'Done' : item.state === 'na' ? 'N/A' : 'Pending';
            return (
              <li key={item.id} className={`border rounded-md p-2 ${blocked ? 'border-gray-100 bg-gray-50' : 'border-gray-100 hover:bg-gray-50/50'}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${stateBadgeClass}`}>
                        {stateLabel}
                      </span>
                      <span className={`text-sm font-medium ${blocked ? 'text-gray-400' : 'text-gray-900'}`}>
                        {item.label}
                      </span>
                      {item.required && (
                        <span className="text-[9px] uppercase tracking-wide bg-red-50 text-red-700 px-1 py-0.5 rounded">
                          required
                        </span>
                      )}
                      {item.sop_ref && (
                        <span
                          title="SOP reference"
                          className="text-[10px] text-gray-500 inline-flex items-center gap-0.5"
                        >
                          <BookOpen size={10} /> {item.sop_ref}
                        </span>
                      )}
                      {blocked && (
                        <span className="text-[10px] text-amber-700 inline-flex items-center gap-0.5">
                          <Lock size={10} /> Day of surgery
                        </span>
                      )}
                    </div>
                    {item.notes && !expanded && (
                      <p className="text-xs text-gray-600 mt-1 italic">{item.notes}</p>
                    )}
                    {item.state === 'done' && item.ticked_at && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        Ticked {item.actor_name ?? 'unknown'} · {new Date(item.ticked_at).toLocaleString()}
                      </p>
                    )}
                    {item.state === 'na' && item.ticked_at && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        Marked N/A by {item.actor_name ?? 'unknown'} · {new Date(item.ticked_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {canWrite && (
                    <div className="flex flex-col gap-1 items-stretch">
                      {item.state !== 'done' && (
                        <button
                          type="button"
                          disabled={savingId === item.id || blocked}
                          onClick={() => toggle(item, 'done')}
                          className="text-[11px] bg-green-50 text-green-700 hover:bg-green-100 px-2 py-0.5 rounded disabled:opacity-50 inline-flex items-center justify-center gap-1"
                        >
                          {savingId === item.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Tick
                        </button>
                      )}
                      {item.state !== 'pending' && (
                        <button
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => toggle(item, 'pending')}
                          className="text-[11px] text-gray-500 hover:text-gray-800 px-2 py-0.5 rounded disabled:opacity-50 inline-flex items-center justify-center gap-1"
                        >
                          <Circle size={10} /> Untick
                        </button>
                      )}
                      {item.state !== 'na' && !item.required && (
                        <button
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => toggle(item, 'na')}
                          className="text-[11px] text-gray-500 hover:text-gray-800 px-2 py-0.5 rounded disabled:opacity-50 inline-flex items-center justify-center gap-1"
                        >
                          <Slash size={10} /> N/A
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (expanded) {
                            setExpandedNotesId(null);
                          } else {
                            setExpandedNotesId(item.id);
                            setNotesDraft(item.notes ?? '');
                          }
                        }}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded inline-flex items-center justify-center gap-1"
                      >
                        Notes
                      </button>
                    </div>
                  )}
                </div>
                {expanded && canWrite && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      autoFocus
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Notes (e.g., NPO from 10pm Sun)"
                      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        await saveNotes(item, notesDraft);
                        setExpandedNotesId(null);
                      }}
                      className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedNotesId(null)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
