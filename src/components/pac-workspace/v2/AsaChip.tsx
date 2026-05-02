'use client';

// =============================================================================
// AsaChip — PCW2.9
//
// Pill that shows the current ASA state per PRD §7.3:
//   null         → gray "ASA pending — fill Marketing Handoff"
//   inferred     → blue "Provisional ASA N · inferred · {high|low} confidence"
//                  (confidence not yet persisted; display "inferred" for now)
//   coordinator  → amber "Provisional ASA N · coordinator-set"
//   anaesthetist → green "ASA N · anaesthetist · {date}"
//
// Click → AsaOverrideModal (role-gated to PAC write roles + super_admin).
// =============================================================================

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { AsaOverrideModal } from './AsaOverrideModal';

interface Props {
  caseId: string;
  asaGrade: 1 | 2 | 3 | 4 | 5 | null | undefined;
  asaSource: 'inferred' | 'coordinator' | 'anaesthetist' | null | undefined;
  asaOverrideReason: string | null | undefined;
  canWrite: boolean;
  /** Called after a successful override so the workspace reloads (engine
   * may have fired new Layer 1 baseline rules). */
  onOverridden: () => void;
}

const SOURCE_BG: Record<string, string> = {
  null: 'bg-gray-100 text-gray-700 border-gray-200',
  inferred: 'bg-sky-50 text-sky-800 border-sky-200',
  coordinator: 'bg-amber-50 text-amber-800 border-amber-200',
  anaesthetist: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

const SOURCE_LABEL: Record<string, string> = {
  inferred: 'inferred',
  coordinator: 'coordinator-set',
  anaesthetist: 'anaesthetist',
};

export function AsaChip({
  caseId,
  asaGrade,
  asaSource,
  asaOverrideReason,
  canWrite,
  onOverridden,
}: Props) {
  const [overrideOpen, setOverrideOpen] = useState(false);

  const sourceKey = asaSource ?? 'null';
  const bg = SOURCE_BG[sourceKey] ?? SOURCE_BG.null;

  return (
    <>
      <button
        type="button"
        onClick={() => canWrite && setOverrideOpen(true)}
        disabled={!canWrite}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${bg} hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70`}
        title={asaOverrideReason ? `Override reason: ${asaOverrideReason}` : undefined}
      >
        <Activity size={12} />
        {asaGrade == null ? (
          <span>ASA pending — fill Marketing Handoff</span>
        ) : asaSource === 'anaesthetist' ? (
          <span>
            ASA {asaGrade} · {SOURCE_LABEL[asaSource]}
          </span>
        ) : (
          <span>
            Provisional ASA {asaGrade} · {SOURCE_LABEL[sourceKey] ?? 'unknown'}
          </span>
        )}
        {canWrite && (
          <span className="ml-1 text-[10px] underline opacity-70">override</span>
        )}
      </button>

      {overrideOpen && (
        <AsaOverrideModal
          caseId={caseId}
          currentGrade={asaGrade ?? null}
          currentSource={asaSource ?? null}
          onClose={() => setOverrideOpen(false)}
          onSubmitted={() => {
            setOverrideOpen(false);
            onOverridden();
          }}
        />
      )}
    </>
  );
}
