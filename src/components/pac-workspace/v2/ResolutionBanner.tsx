'use client';

// =============================================================================
// ResolutionBanner — PCW2.10
//
// Top-of-workspace banner showing the current resolution_state per PRD §11.
// Hidden on 'none' (workspace in flight, no signal to surface).
// =============================================================================

import { Lock, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import {
  getResolutionStateMeta,
  type ResolutionState,
} from '@/lib/pac-workspace/resolution-state';

interface Props {
  state: ResolutionState;
}

const STYLE: Record<string, { bg: string; text: string; border: string; Icon: typeof Info }> = {
  hidden: { bg: '', text: '', border: '', Icon: Info }, // never rendered
  info: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    Icon: CheckCircle2,
  },
  warning: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    Icon: AlertCircle,
  },
  locked: {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    border: 'border-gray-300',
    Icon: Lock,
  },
};

export function ResolutionBanner({ state }: Props) {
  const meta = getResolutionStateMeta(state);
  if (meta.bannerStyle === 'hidden') return null;
  const style = STYLE[meta.bannerStyle];
  const { Icon } = style;

  return (
    <section
      className={`${style.bg} border ${style.border} rounded-lg px-3 py-2 flex items-start gap-2`}
    >
      <Icon size={16} className={`${style.text} mt-0.5 shrink-0`} />
      <div className={`flex-1 ${style.text} text-xs`}>
        <div className="font-semibold">{meta.label}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{meta.description}</div>
        {meta.bannerStyle === 'info' && (
          <div className="mt-1 text-[10px] opacity-80">
            Day-of carve-outs: NPO confirmation, IV cannula, day-of checklist
            items, and anaesthetist re-publish remain editable.
          </div>
        )}
      </div>
    </section>
  );
}
