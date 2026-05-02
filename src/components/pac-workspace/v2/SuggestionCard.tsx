'use client';

// =============================================================================
// SuggestionCard — single Smart Suggestion row in the inbox (PCW2.4a)
//
// Renders per PRD §8.2:
//   • Severity dot (🔴 required, 🟡 recommended, 🔵 info)
//   • Headline — action verb + object derived from payload
//   • Reason — populated from the engine's reason() function
//   • Routes-to chip — destination section
//   • Three action buttons (Accept / Already done / Skip) — INFO has only
//     "Acknowledge". PCW2.4a renders these disabled with "PCW2.4b" tooltip;
//     PCW2.4b wires the click handlers + modals.
//   • Info expander — full SOP excerpt + rule_id (collapsed by default)
// =============================================================================

import { useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Info,
  Sparkles,
} from 'lucide-react';

export interface SuggestionData {
  id: string;
  rule_id: string;
  severity: 'required' | 'recommended' | 'info';
  status: 'pending' | 'accepted' | 'already_done' | 'skipped' | 'auto_dismissed' | 'superseded';
  routes_to: 'diagnostic' | 'clearance' | 'order' | 'pac_visit' | 'asa_review' | 'info_only';
  proposed_payload: Record<string, unknown> | null;
  reason_text: string | null;
  sop_reference: string | null;
  recency_window_days: number | null;
  decision_reason_code: string | null;
  decision_reason_notes: string | null;
}

interface Props {
  suggestion: SuggestionData;
  /** When false, action buttons render disabled. Wired in PCW2.4b. */
  actionsEnabled?: boolean;
  onAccept?: (s: SuggestionData) => void;
  onAlreadyDone?: (s: SuggestionData) => void;
  onSkip?: (s: SuggestionData) => void;
}

const SEVERITY_DOT: Record<SuggestionData['severity'], string> = {
  required: 'bg-rose-500',
  recommended: 'bg-amber-500',
  info: 'bg-sky-500',
};

const SEVERITY_LABEL: Record<SuggestionData['severity'], string> = {
  required: 'REQUIRED',
  recommended: 'RECOMMENDED',
  info: 'INFO',
};

const SEVERITY_TEXT: Record<SuggestionData['severity'], string> = {
  required: 'text-rose-700',
  recommended: 'text-amber-700',
  info: 'text-sky-700',
};

const ROUTES_LABEL: Record<SuggestionData['routes_to'], string> = {
  diagnostic: 'Diagnostics',
  clearance: 'Clearances',
  order: 'Orders',
  pac_visit: 'PAC visit',
  asa_review: 'ASA review',
  info_only: 'Info only',
};

function payloadHeadline(s: SuggestionData): string {
  const p = s.proposed_payload as Record<string, unknown> | null;
  if (!p) return 'Suggestion';
  const kind = p.kind as string | undefined;
  const label = (p.label as string | undefined) ?? null;
  const orderType = (p.orderType as string | undefined) ?? null;
  const specialty = (p.specialty as string | undefined) ?? null;
  const message = (p.message as string | undefined) ?? null;

  if (kind === 'diagnostic' && label) return `Add ${label} to Diagnostics`;
  if (kind === 'order' && label) return label;
  if (kind === 'clearance' && (label || specialty))
    return `Request ${label ?? specialty} clearance`;
  if (kind === 'asa_review') {
    const grade = (p.suggestedGrade as number | undefined);
    return grade ? `ASA review — suggested grade ${grade}` : 'ASA review';
  }
  if (kind === 'info_only' && message) {
    return message.length > 80 ? `${message.slice(0, 80).trim()}…` : message;
  }
  if (kind === 'pac_visit' && label) return label;
  return label ?? orderType ?? specialty ?? 'Suggestion';
}

export function SuggestionCard({
  suggestion: s,
  actionsEnabled = false,
  onAccept,
  onAlreadyDone,
  onSkip,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const isInfo = s.severity === 'info';
  const isAsaReview = s.routes_to === 'asa_review';
  const isInfoOnly = s.routes_to === 'info_only';
  const isSkipped = s.status === 'skipped';

  const headline = payloadHeadline(s);

  // Disabled-tooltip for the read-only PCW2.4a phase. PCW2.4b removes this.
  const disabledTitle = actionsEnabled
    ? undefined
    : 'Action wiring lands in PCW2.4b';

  return (
    <div className="border-l-4 pl-3 py-2.5"
      style={{
        borderLeftColor: s.severity === 'required'
          ? '#f43f5e'
          : s.severity === 'recommended' ? '#f59e0b' : '#0ea5e9',
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${SEVERITY_DOT[s.severity]}`}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[11px] font-bold uppercase tracking-wide ${SEVERITY_TEXT[s.severity]}`}>
              {SEVERITY_LABEL[s.severity]}
            </span>
            <span className="text-[11px] text-gray-400">·</span>
            <span className="text-[11px] text-gray-500">
              {ROUTES_LABEL[s.routes_to]}
            </span>
            {s.recency_window_days != null && (
              <>
                <span className="text-[11px] text-gray-400">·</span>
                <span className="text-[11px] text-gray-500">
                  recency {s.recency_window_days}d
                </span>
              </>
            )}
            {isSkipped && (
              <span className="ml-1 inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 uppercase tracking-wide">
                Skipped
              </span>
            )}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-900">
            {headline}
          </div>
          {s.reason_text && (
            <div className="mt-0.5 text-xs text-gray-600">{s.reason_text}</div>
          )}
          {isSkipped && s.decision_reason_notes && (
            <div className="mt-1 text-xs italic text-gray-500">
              Reason: {s.decision_reason_notes}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {!isSkipped && !isInfo && !isAsaReview && !isInfoOnly && (
              <>
                <button
                  type="button"
                  onClick={() => onAccept?.(s)}
                  disabled={!actionsEnabled}
                  title={disabledTitle}
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => onAlreadyDone?.(s)}
                  disabled={!actionsEnabled}
                  title={disabledTitle}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Already done
                </button>
                <button
                  type="button"
                  onClick={() => onSkip?.(s)}
                  disabled={!actionsEnabled}
                  title={disabledTitle}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Skip
                </button>
              </>
            )}
            {!isSkipped && isInfo && (
              <button
                type="button"
                onClick={() => onAccept?.(s)}
                disabled={!actionsEnabled}
                title={disabledTitle}
                className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Acknowledge
              </button>
            )}
            {!isSkipped && isAsaReview && (
              <button
                type="button"
                onClick={() => onAccept?.(s)}
                disabled={!actionsEnabled}
                title={disabledTitle ?? 'ASA override modal lands in PCW2.9'}
                className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Review ASA
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700"
              aria-expanded={expanded}
            >
              {expanded ? (
                <>
                  <ChevronDown className="h-3 w-3" /> Hide details
                </>
              ) : (
                <>
                  <ChevronRight className="h-3 w-3" /> Details
                </>
              )}
            </button>
          </div>

          {expanded && (
            <div className="mt-2 space-y-1 rounded bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-600">
              {s.sop_reference && (
                <div>
                  <span className="font-medium text-gray-700">SOP:</span>{' '}
                  {s.sop_reference}
                </div>
              )}
              <div>
                <span className="font-medium text-gray-700">Rule ID:</span>{' '}
                <span className="font-mono">{s.rule_id}</span>
              </div>
              {s.proposed_payload && (
                <div>
                  <span className="font-medium text-gray-700">Payload:</span>{' '}
                  <span className="font-mono break-all">
                    {JSON.stringify(s.proposed_payload)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const SuggestionCardIcon = Sparkles;
export { AlertCircle as SuggestionAlertIcon, Info as SuggestionInfoIcon };
