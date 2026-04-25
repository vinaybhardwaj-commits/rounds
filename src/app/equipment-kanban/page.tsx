'use client';

// ============================================
// Rounds — /equipment-kanban page (Sprint 2 Day 9)
//
// Arul's Kanban: 5 columns for the equipment_requests status chain:
//   requested → vendor_confirmed → in_transit → delivered → verified_ready
//
// Each card shows patient + case planned date + item label + vendor/eta.
// HTML5 native drag-drop (lightweight, no react-dnd dep): drag a card to a
// column → PATCH status → refetch. Arrow-key quick-advance too: click a card,
// then → to move forward, ← to move back.
//
// Cross-hospital view filtered by user_accessible_hospital_ids at the
// endpoint. Role gate mirror: biomedical_engineer / ot_coordinator / super_admin
// can mutate; others see read-only.
//
// Day 9 scope excludes create-request UI (small form) — Arul creates from
// drawer Track 3 today; kanban is for status management. Creation form
// planned as Sprint 3 polish.
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import EquipmentRequestModal from '@/components/ot/EquipmentRequestModal';

interface EquipmentRow {
  id: string;
  case_id: string;
  hospital_slug: string;
  patient_name: string | null;
  planned_surgery_date: string | null;
  ot_room: number | null;
  case_state: string;
  item_type: string;
  item_label: string;
  quantity: number;
  status: string;
  vendor_name: string | null;
  vendor_phone: string | null;
  eta: string | null;
  notes: string | null;
  kit_id: string | null;
  auto_verified: boolean;
}

const COLS = [
  { key: 'requested', label: 'Requested', tone: 'bg-gray-100 border-gray-300 text-gray-900' },
  { key: 'vendor_confirmed', label: 'Vendor confirmed', tone: 'bg-amber-50 border-amber-200 text-amber-900' },
  { key: 'in_transit', label: 'In transit', tone: 'bg-sky-50 border-sky-200 text-sky-900' },
  { key: 'delivered', label: 'Delivered', tone: 'bg-indigo-50 border-indigo-200 text-indigo-900' },
  { key: 'verified_ready', label: 'Verified ready', tone: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
] as const;

const MUTATE_ROLES = new Set(['biomedical_engineer', 'ot_coordinator', 'super_admin']);

export default function EquipmentKanbanPage() {
  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/equipment-requests?limit=500`)
      .then((r) => r.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data)) {
          setRows(body.data);
          if (body.feature_enabled === false) setFeatureEnabled(false);
          else setFeatureEnabled(true);
        } else {
          setError(body?.error || 'Failed to load');
        }
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

  const canMutate = role ? MUTATE_ROLES.has(role) : false;

  const grouped = useMemo(() => {
    const m = new Map<string, EquipmentRow[]>();
    for (const col of COLS) m.set(col.key, []);
    for (const r of rows) {
      const list = m.get(r.status);
      if (list) list.push(r);
    }
    return m;
  }, [rows]);

  const moveTo = useCallback(
    async (rowId: string, newStatus: string) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.status === newStatus) return;
      if (!canMutate) return;

      setBusyId(rowId);
      // Optimistic update — revert if server fails.
      const prev = rows;
      setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, status: newStatus } : r)));
      try {
        const res = await fetch(`/api/cases/${row.case_id}/equipment/${rowId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error(body?.error || `HTTP ${res.status}`);
      } catch (e) {
        setRows(prev);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [rows, canMutate]
  );

  // Keyboard quick-advance
  useEffect(() => {
    if (!selectedId || !canMutate) return;
    const onKey = (e: KeyboardEvent) => {
      const row = rows.find((r) => r.id === selectedId);
      if (!row) return;
      const idx = COLS.findIndex((c) => c.key === row.status);
      if (e.key === 'ArrowRight' && idx < COLS.length - 1) {
        e.preventDefault();
        moveTo(row.id, COLS[idx + 1].key);
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        moveTo(row.id, COLS[idx - 1].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, rows, canMutate, moveTo]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Equipment Kanban</h1>
          <p className="mt-1 text-sm text-gray-600">
            5-step chain across your accessible hospitals.
            {canMutate && ' Drag cards between columns to advance status. Click a card then use ← / → keys.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canMutate && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <span aria-hidden>＋</span> New request
            </button>
          )}
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
          <strong>Feature-flagged:</strong> Case model is disabled.
        </div>
      )}
      {role && !canMutate && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          Read-only for role <code>{role}</code>. Mutations require biomedical_engineer / ot_coordinator / super_admin.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-5 gap-3">
        {COLS.map((col) => {
          const list = grouped.get(col.key) ?? [];
          return (
            <section
              key={col.key}
              className={`flex min-h-[300px] flex-col rounded-lg border-2 ${col.tone} ${busyId ? 'opacity-90' : ''}`}
              onDragOver={(e) => { if (canMutate) e.preventDefault(); }}
              onDrop={(e) => {
                if (!canMutate) return;
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) moveTo(id, col.key);
              }}
            >
              <header className="flex items-center justify-between border-b border-gray-200 bg-white/60 px-3 py-2 rounded-t-md">
                <h2 className="text-xs font-semibold uppercase tracking-wide">{col.label}</h2>
                <span className="text-xs font-medium text-gray-600">{list.length}</span>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {list.length === 0 && (
                  <p className="px-1 py-3 text-center text-[11px] text-gray-400">—</p>
                )}
                {list.map((r) => {
                  const selected = selectedId === r.id;
                  return (
                    <article
                      key={r.id}
                      draggable={canMutate}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', r.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => setSelectedId(selected ? null : r.id)}
                      tabIndex={0}
                      className={`cursor-${canMutate ? 'grab' : 'pointer'} rounded-md border bg-white px-2 py-2 text-xs shadow-sm hover:shadow ${
                        selected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'
                      } ${busyId === r.id ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start gap-1">
                        <span className="flex-1">
                          <span className="font-medium text-gray-900">{r.item_label}</span>
                          {r.quantity > 1 && <span className="ml-1 text-gray-500">×{r.quantity}</span>}
                        </span>
                        <span className="inline-flex items-center rounded bg-gray-100 px-1 py-0 text-[10px] text-gray-700">
                          {r.item_type}
                        </span>
                      </div>
                      <p className="mt-1 text-gray-700">
                        {r.patient_name || '(no patient)'} ·{' '}
                        <span className="inline-flex items-center rounded bg-gray-100 px-1 py-0 text-[10px]">
                          {r.hospital_slug.toUpperCase()}
                        </span>
                      </p>
                      {r.planned_surgery_date && (
                        <p className="mt-0.5 text-gray-600">
                          Surgery {new Date(r.planned_surgery_date).toLocaleDateString()}
                          {r.ot_room ? ` · OT-${r.ot_room}` : ''}
                        </p>
                      )}
                      {(r.vendor_name || r.eta) && (
                        <p className="mt-0.5 text-gray-500">
                          {r.vendor_name && <>🏷 {r.vendor_name} </>}
                          {r.eta && <>· ETA {new Date(r.eta).toLocaleDateString()}</>}
                        </p>
                      )}
                      {r.auto_verified && (
                        <p className="mt-0.5 text-[10px] text-emerald-700">· auto-verified kit</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <EquipmentRequestModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => { setModalOpen(false); load(); }}
      />
    </main>
  );
}
