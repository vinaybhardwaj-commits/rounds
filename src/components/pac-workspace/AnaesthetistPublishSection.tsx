'use client';

// =============================================================================
// AnaesthetistPublishSection — PCW.4 live publish panel
//
// PRD D10 — match today's PacPublishModal: outcome + conditions text + notes.
// Inline panel inside the workspace; no separate modal.
//
// Disabled when:
//   - User isn't anesthesiologist or super_admin
//   - Workspace already published (read-only summary view in that case)
//
// Conditions textarea is required for fit_conds and defer outcomes;
// outcome 'fit' must NOT have conditions text. Server-validated too.
// =============================================================================

import { useCallback, useState } from 'react';
import {
  ClipboardCheck, Loader2, AlertCircle, CheckCircle2, ShieldAlert, ShieldX,
  Sparkles, ArrowRight,
  type LucideIcon,
} from 'lucide-react';

type Outcome = 'fit' | 'fit_conds' | 'defer' | 'unfit';

const OUTCOMES: ReadonlyArray<{
  value: Outcome;
  label: string;
  helper: string;
  chipBg: string;
  chipText: string;
  icon: LucideIcon;
}> = [
  { value: 'fit',         label: 'Fit',                 helper: 'Cleared for surgery as planned.',                  chipBg: 'bg-green-100',  chipText: 'text-green-800',  icon: CheckCircle2 },
  { value: 'fit_conds',   label: 'Fit (with conditions)', helper: 'Cleared if conditions are met (specify below).',   chipBg: 'bg-amber-100',  chipText: 'text-amber-800',  icon: Sparkles },
  { value: 'defer',       label: 'Defer',               helper: 'Postpone — needs further workup or optimisation.',  chipBg: 'bg-orange-100', chipText: 'text-orange-800', icon: ArrowRight },
  { value: 'unfit',       label: 'Unfit',               helper: 'Not safe for surgery. Document strongly recommended.', chipBg: 'bg-red-100',    chipText: 'text-red-800',    icon: ShieldX },
];

interface Props {
  caseId: string;
  caseState: string;
  subState: string;
  canPublish: boolean;
  onPublished: () => void;
}

export function AnaesthetistPublishSection({
  caseId, caseState, subState, canPublish, onPublished,
}: Props) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [conditions, setConditions] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isPublished = subState === 'published';
  const requiresConditions = outcome === 'fit_conds' || outcome === 'defer';
  const canSubmit = !!outcome &&
    (!requiresConditions || conditions.trim().length > 0) &&
    (outcome !== 'fit' || conditions.trim().length === 0);

  const submit = useCallback(async () => {
    if (!outcome) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/pac-workspace/${caseId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome,
          conditions: requiresConditions ? conditions.trim() : '',
          notes: notes.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }, [caseId, outcome, conditions, notes, requiresConditions, onPublished]);

  if (isPublished) {
    return (
      <section className="bg-green-50/30 border border-green-200 rounded-lg p-4 shadow-sm">
        <header className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-green-700" />
          <h3 className="text-sm font-semibold text-gray-800">Anaesthetist publish</h3>
          <span className="text-[10px] uppercase tracking-wide bg-green-200 text-green-900 px-1.5 py-0.5 rounded ml-2">
            published — case state {caseState.replace(/_/g, ' ')}
          </span>
        </header>
        <p className="text-xs text-gray-600 mt-2">
          Outcome already on the case. Re-publish from this panel to amend (anaesthetist + super_admin only).
        </p>
      </section>
    );
  }

  if (!canPublish) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm opacity-70">
        <header className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-700">Anaesthetist publish</h3>
        </header>
        <p className="text-xs text-gray-500 mt-2">
          Publish access is limited to <code className="text-gray-700">anesthesiologist</code> and{' '}
          <code className="text-gray-700">super_admin</code> per PRD D2 + D10.
          Required clinical checklist items (ASA classification, airway exam) must be ticked first.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <ClipboardCheck size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">Anaesthetist publish</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
          guaranteed audit
        </span>
      </header>

      {error && (
        <div className="mb-3 border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-1.5 text-xs flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        {OUTCOMES.map((o) => {
          const selected = outcome === o.value;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setOutcome(o.value);
                if (o.value === 'fit') setConditions('');
              }}
              className={[
                'border rounded-md px-3 py-2 text-left transition-all',
                selected
                  ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-300'
                  : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50',
              ].join(' ')}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${o.chipBg} ${o.chipText} font-semibold inline-flex items-center gap-1`}>
                  <Icon size={10} /> {o.label}
                </span>
              </div>
              <p className="text-[11px] text-gray-600">{o.helper}</p>
            </button>
          );
        })}
      </div>

      {requiresConditions && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Conditions <span className="text-red-600">*</span>
          </label>
          <textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            rows={3}
            placeholder={
              outcome === 'fit_conds'
                ? 'e.g. continue ramipril, hold metformin morning of surgery, anaesthetist on standby for difficult airway'
                : 'e.g. defer 48h pending HbA1c <8%, repeat ECG in 24h'
            }
            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:border-indigo-300 focus:outline-none"
          />
        </div>
      )}

      {outcome && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Notes {outcome === 'unfit' && <span className="text-red-600 italic">(strongly recommended)</span>}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={outcome === 'fit' ? 2 : 3}
            placeholder={outcome === 'fit' ? 'Optional comments' : 'Why this outcome; what the patient needs to work on'}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:border-indigo-300 focus:outline-none"
          />
        </div>
      )}

      {!confirming ? (
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => setConfirming(true)}
          className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded inline-flex items-center gap-1 disabled:opacity-50 hover:bg-indigo-700"
        >
          <ClipboardCheck size={14} /> Publish PAC outcome
        </button>
      ) : (
        <div className="flex items-center gap-2 p-2 border border-amber-200 bg-amber-50/40 rounded-md">
          <ShieldAlert size={14} className="text-amber-700" />
          <span className="text-xs text-amber-800 mr-auto">Confirm publish — this transitions the case state.</span>
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="text-xs bg-indigo-600 text-white px-3 py-1 rounded inline-flex items-center gap-1 disabled:opacity-50 hover:bg-indigo-700"
          >
            {submitting ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            Confirm publish
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
