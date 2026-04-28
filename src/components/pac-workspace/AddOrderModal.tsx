'use client';

// =============================================================================
// AddOrderModal — picker for adding pac_orders.
//
// Loads /api/pac-workspace/[caseId]/suggest with current ASA + (optional)
// comorbidities + mode, displays SOP-suggested orders pre-checked at the top,
// then full catalog grouped by category. Single batched POST to /orders.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, Sparkles, FlaskConical } from 'lucide-react';
import type { PacMode } from '@/lib/pac-workspace/types';

interface Suggestion {
  code: string;
  label: string;
  category: string | null;
  reason: 'asa_default' | 'mode_default' | 'manual_only';
}

interface CatalogRow {
  code: string;
  label: string;
  category: string | null;
}

interface SuggestPayload {
  inputs: { asa: number | null; mode: PacMode; comorbidities: string[] };
  suggested_orders: Suggestion[];
  order_catalog: CatalogRow[];
}

interface Props {
  caseId: string;
  pacMode: PacMode;
  alreadyAdded: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}

export function AddOrderModal({ caseId, pacMode, alreadyAdded, onClose, onSaved }: Props) {
  const [asa, setAsa] = useState<number>(2);
  const [data, setData] = useState<SuggestPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchSuggest = useCallback(
    async (asaVal: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ asa: String(asaVal), mode: pacMode });
        const res = await fetch(`/api/pac-workspace/${caseId}/suggest?${params}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json.data as SuggestPayload);
        // Pre-check suggestions that aren't already added.
        setSelected(new Set((json.data as SuggestPayload).suggested_orders.map((s) => s.code).filter((c) => !alreadyAdded.has(c))));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [caseId, pacMode, alreadyAdded],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchSuggest(asa); }, []);

  const onAsaChange = (n: number) => {
    setAsa(n);
    fetchSuggest(n);
  };

  const grouped = useMemo(() => {
    if (!data) return new Map<string, CatalogRow[]>();
    const m = new Map<string, CatalogRow[]>();
    for (const r of data.order_catalog) {
      const key = r.category || 'other';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return m;
  }, [data]);

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const orders = Array.from(selected).map((code) => ({ order_type: code }));
      if (orders.length === 0) {
        onClose();
        return;
      }
      const res = await fetch(`/api/pac-workspace/${caseId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [caseId, selected, onSaved, onClose]);

  const suggestedCodes = new Set((data?.suggested_orders ?? []).map((s) => s.code));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
          <FlaskConical size={16} className="text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Add PAC orders</h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </header>

        <div className="p-4 space-y-3">
          {error && (
            <div className="border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-xs">{error}</div>
          )}

          {/* ASA picker — drives suggest */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-600">ASA class:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onAsaChange(n)}
                className={`px-2 py-0.5 rounded border ${
                  asa === n ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-gray-400">·</span>
            <span className="text-gray-500">Mode: {pacMode.replace(/_/g, ' ')}</span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 size={14} className="animate-spin" /> Fetching SOP suggestions…
            </div>
          ) : (
            data && (
              <>
                {data.suggested_orders.length > 0 && (
                  <div className="border border-indigo-100 bg-indigo-50/30 rounded-md p-2">
                    <header className="flex items-center gap-1.5 mb-2">
                      <Sparkles size={12} className="text-indigo-600" />
                      <span className="text-xs font-medium text-indigo-800">
                        SOP §6.2 suggestions for ASA {asa} ({data.suggested_orders.length})
                      </span>
                    </header>
                    <ul className="space-y-0.5">
                      {data.suggested_orders.map((s) => {
                        const added = alreadyAdded.has(s.code);
                        return (
                          <li key={s.code}>
                            <label className={`flex items-center gap-2 text-xs px-1 py-1 rounded ${added ? 'opacity-50' : 'cursor-pointer hover:bg-indigo-50'}`}>
                              <input
                                type="checkbox"
                                disabled={added}
                                checked={selected.has(s.code)}
                                onChange={() => toggle(s.code)}
                              />
                              <span className="font-medium">{s.label}</span>
                              {s.category && <span className="text-gray-500">· {s.category}</span>}
                              {added && <span className="text-[10px] text-gray-400 ml-auto">already added</span>}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Full catalog grouped by category */}
                <div className="border border-gray-200 rounded-md p-2">
                  <header className="text-xs font-medium text-gray-700 mb-2">All available orders</header>
                  {Array.from(grouped.entries()).map(([cat, list]) => (
                    <div key={cat} className="mb-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{cat}</div>
                      <ul className="space-y-0.5">
                        {list.map((r) => {
                          const added = alreadyAdded.has(r.code);
                          const isSuggested = suggestedCodes.has(r.code);
                          return (
                            <li key={r.code}>
                              <label className={`flex items-center gap-2 text-xs px-1 py-1 rounded ${added ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50'}`}>
                                <input
                                  type="checkbox"
                                  disabled={added}
                                  checked={selected.has(r.code)}
                                  onChange={() => toggle(r.code)}
                                />
                                <span className={isSuggested ? 'text-indigo-700' : ''}>{r.label}</span>
                                {added && <span className="text-[10px] text-gray-400 ml-auto">already added</span>}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <footer className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-end gap-2">
          <span className="text-xs text-gray-500 mr-auto">{selected.size} selected</span>
          <button onClick={onClose} className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5">Cancel</button>
          <button
            onClick={save}
            disabled={saving || selected.size === 0}
            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded inline-flex items-center gap-1 disabled:opacity-50 hover:bg-indigo-700"
          >
            {saving && <Loader2 size={11} className="animate-spin" />}
            Add {selected.size}
          </button>
        </footer>
      </div>
    </div>
  );
}
