'use client';

// =============================================================================
// PatientPacSearch (26 Apr 2026 — V's typeahead ask)
//
// Lets an anaesthetist find ANY active patient (by name / UHID / phone) and
// pull them into the PAC queue without waiting for the IPD coordinator.
//
// Behaviour:
//   - Debounced 200ms input → /api/patients/searchable-for-pac?q=…
//   - Dropdown shows up to 8 results: name + UHID + stage chip
//   - Keyboard nav: ↑ / ↓ to walk results, Enter to pick, Esc to close
//   - On pick: POST /api/cases/schedule-pac with patient_thread_id
//     - 200 → call onScheduled() to refresh the parent queue
//     - 409 → display the conflict reason inline (e.g., already past PAC)
//     - other → display error inline
// =============================================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

interface SearchHit {
  id: string;
  patient_name: string | null;
  uhid: string | null;
  current_stage: string;
  hospital_slug: string | null;
  phone: string | null;
  case_id: string | null;
  case_state: string | null;
}

interface PatientPacSearchProps {
  /** Called after a successful schedule-pac. Parent typically re-fetches. */
  onScheduled?: () => void;
  /** Disable the input (e.g., when the caller lacks permission). */
  disabled?: boolean;
}

export default function PatientPacSearch({ onScheduled, disabled }: PatientPacSearchProps) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search.
  useEffect(() => {
    setError(null);
    setInfo(null);
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/patients/searchable-for-pac?q=${encodeURIComponent(q.trim())}&limit=8`)
        .then((r) => r.json())
        .then((b) => {
          if (b?.success && Array.isArray(b.data)) {
            setHits(b.data as SearchHit[]);
            setActiveIdx(0);
            setOpen(true);
          } else {
            setHits([]);
          }
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Close dropdown on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = useCallback(async (hit: SearchHit) => {
    setOpen(false);
    setScheduling(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/cases/schedule-pac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_thread_id: hit.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const verb = body.action === 'created'
        ? 'New case created and scheduled for PAC'
        : body.action === 'noop'
          ? 'Patient was already in the PAC queue'
          : 'Scheduled for PAC';
      setInfo(`${verb}: ${hit.patient_name ?? '(unnamed patient)'}`);
      setQ('');
      setHits([]);
      onScheduled?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduling(false);
    }
  }, [onScheduled]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || hits.length === 0) {
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[activeIdx];
      if (hit) pick(hit);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const inFlight = loading || scheduling;

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
        Add a patient to the queue
      </label>
      <div className="mt-1 flex items-center rounded-md border border-gray-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
        <Search className="ml-3 h-4 w-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (hits.length > 0) setOpen(true); }}
          onKeyDown={onKeyDown}
          disabled={disabled || scheduling}
          placeholder="Search any patient by name, UHID, or phone…"
          className="flex-1 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); setHits([]); setOpen(false); inputRef.current?.focus(); }}
            className="mr-2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {inFlight && <Loader2 className="mr-3 h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {/* Dropdown */}
      {open && hits.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {hits.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              className={`flex cursor-pointer items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 ${
                i === activeIdx ? 'bg-blue-50' : 'bg-white'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-gray-900">
                    {h.patient_name || '(no name)'}
                  </span>
                  {h.uhid && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-700">
                      {h.uhid}
                    </span>
                  )}
                  {h.hospital_slug && (
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] uppercase text-indigo-700">
                      {h.hospital_slug}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                  <span className="capitalize">{h.current_stage.replace(/_/g, ' ')}</span>
                  {h.case_state && (
                    <>
                      <span>·</span>
                      <span>case {h.case_state}</span>
                    </>
                  )}
                  {!h.case_state && <span>· no case yet</span>}
                  {h.phone && (
                    <>
                      <span>·</span>
                      <span>{h.phone}</span>
                    </>
                  )}
                </div>
              </div>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                Schedule PAC
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Empty-state hint when query is too short */}
      {q.trim().length > 0 && q.trim().length < 2 && (
        <p className="mt-1 text-[11px] text-gray-500">Type at least 2 characters…</p>
      )}

      {/* Empty-results hint */}
      {open && !loading && q.trim().length >= 2 && hits.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 shadow-lg">
          No matching patients available for PAC scheduling.
        </div>
      )}

      {/* Inline status messages */}
      {info && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {info}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
