'use client';

// =============================================================================
// AddClearanceModal — picker for adding pac_clearances.
//
// Loads /api/pac-workspace/[caseId]/suggest with manual comorbidity flags;
// shows SOP §6.3 suggestions pre-checked, then full specialty list. Single
// batched POST to /clearances. Specific assignee user picker is parked to v1.x;
// in PCW.2 we route to the specialty queue (assigned_to=NULL).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import type { PacMode } from '@/lib/pac-workspace/types';

const COMORBIDITY_PRESETS = [
  // Cardiac / vascular
  'cardiac_disease', 'recent_mi', 'angina', 'hypertension_uncontrolled', 'ecg_changes', 'heart_failure', 'arrhythmia', 'valvular_disease',
  // Respiratory
  'asthma', 'copd', 'osa', 'recent_pneumonia', 'active_wheeze', 'spo2_low', 'urti_active', 'tuberculosis_history',
  // Endocrine
  'diabetes_uncontrolled', 'hba1c_high', 'thyroid_uncontrolled', 'tsh_elevated',
  // Renal
  'ckd', 'esrd', 'egfr_low', 'dialysis',
  // Neuro
  'recent_cva', 'seizure_disorder',
  // GI
  'cirrhosis', 'liver_disease',
  // Haem
  'anaemia_severe', 'coagulopathy', 'thrombocytopenia', 'anticoagulant_active',
  // Dental
  'dental_infection_active', 'prosthetic_valve',
];

interface Suggestion {
  code: string;
  label: string;
  default_assignee_role: string;
  reason: string;
  matched_flags: string[];
}

interface CatalogRow {
  code: string;
  label: string;
  default_assignee_role: string;
}

interface SuggestPayload {
  inputs: { asa: number | null; mode: PacMode; comorbidities: string[] };
  suggested_clearances: Suggestion[];
  clearance_catalog: CatalogRow[];
}

interface Props {
  caseId: string;
  pacMode: PacMode;
  alreadyAdded: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}

export function AddClearanceModal({ caseId, pacMode, alreadyAdded, onClose, onSaved }: Props) {
  const [comorbidities, setComorbidities] = useState<string[]>([]);
  const [data, setData] = useState<SuggestPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchSuggest = useCallback(
    async (flags: string[]) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          mode: pacMode,
          comorbidities: flags.join(','),
        });
        const res = await fetch(`/api/pac-workspace/${caseId}/suggest?${params}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json.data as SuggestPayload);
        setSelected(new Set((json.data as SuggestPayload).suggested_clearances.map((s) => s.code).filter((c) => !alreadyAdded.has(c))));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [caseId, pacMode, alreadyAdded],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchSuggest([]); }, []);

  const toggleFlag = (flag: string) => {
    const next = comorbidities.includes(flag) ? comorbidities.filter((f) => f !== flag) : [...comorbidities, flag];
    setComorbidities(next);
    fetchSuggest(next);
  };

  const toggleSelected = (code: string) => {
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
      const clearances = Array.from(selected).map((code) => ({ specialty: code }));
      if (clearances.length === 0) {
        onClose();
        return;
      }
      const res = await fetch(`/api/pac-workspace/${caseId}/clearances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearances }),
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

  const suggestedCodes = useMemo(
    () => new Set((data?.suggested_clearances ?? []).map((s) => s.code)),
    [data],
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
          <ShieldCheck size={16} className="text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Request clearances</h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </header>

        <div className="p-4 space-y-3">
          {error && (
            <div className="border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-xs">{error}</div>
          )}

          <div className="text-xs text-gray-600">
            Toggle the comorbidity flags that apply to this patient. SOP §6.3 trigger arrays will surface matching specialties.
          </div>
          <div className="flex flex-wrap gap-1">
            {COMORBIDITY_PRESETS.map((flag) => {
              const on = comorbidities.includes(flag);
              return (
                <button
                  key={flag}
                  type="button"
                  onClick={() => toggleFlag(flag)}
                  className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                    on ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {flag.replace(/_/g, ' ')}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 size={14} className="animate-spin" /> Fetching SOP suggestions…
            </div>
          ) : (
            data && (
              <>
                {data.suggested_clearances.length > 0 && (
                  <div className="border border-indigo-100 bg-indigo-50/30 rounded-md p-2">
                    <header className="flex items-center gap-1.5 mb-2">
                      <Sparkles size={12} className="text-indigo-600" />
                      <span className="text-xs font-medium text-indigo-800">
                        SOP §6.3 suggestions ({data.suggested_clearances.length})
                      </span>
                    </header>
                    <ul className="space-y-0.5">
                      {data.suggested_clearances.map((s) => {
                        const added = alreadyAdded.has(s.code);
                        return (
                          <li key={s.code}>
                            <label className={`flex items-center gap-2 text-xs px-1 py-1 rounded ${added ? 'opacity-50' : 'cursor-pointer hover:bg-indigo-50'}`}>
                              <input type="checkbox" disabled={added} checked={selected.has(s.code)} onChange={() => toggleSelected(s.code)} />
                              <span className="font-medium">{s.label}</span>
                              <span className="text-[10px] text-gray-500">because: {s.matched_flags.join(', ')}</span>
                              {added && <span className="text-[10px] text-gray-400 ml-auto">already added</span>}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="border border-gray-200 rounded-md p-2">
                  <header className="text-xs font-medium text-gray-700 mb-2">All available specialties</header>
                  <ul className="space-y-0.5">
                    {data.clearance_catalog.map((r) => {
                      const added = alreadyAdded.has(r.code);
                      const isSuggested = suggestedCodes.has(r.code);
                      return (
                        <li key={r.code}>
                          <label className={`flex items-center gap-2 text-xs px-1 py-1 rounded ${added ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50'}`}>
                            <input type="checkbox" disabled={added} checked={selected.has(r.code)} onChange={() => toggleSelected(r.code)} />
                            <span className={isSuggested ? 'text-indigo-700' : ''}>{r.label}</span>
                            <span className="text-[10px] text-gray-400">→ {r.default_assignee_role}</span>
                            {added && <span className="text-[10px] text-gray-400 ml-auto">already added</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
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
            Request {selected.size}
          </button>
        </footer>
      </div>
    </div>
  );
}
