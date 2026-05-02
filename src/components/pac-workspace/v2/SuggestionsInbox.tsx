'use client';

// =============================================================================
// SuggestionsInbox — top-of-workspace block (PCW2.4a + 2.4b)
//
// Per PRD §8.1:
//   • Visible only when ≥ 1 pending suggestion exists.
//   • When 0 pending: collapses to a single line "✓ All SOP suggestions
//     reviewed · Skipped (N) — view".
//   • Sort: REQUIRED first (by created_at asc), then RECOMMENDED, then INFO.
//
// PCW2.4b wires the click handlers + Skip/AlreadyDone modals + bulk Accept
// All. Skipped drawer renders inline.
//
// Mounted by PACWorkspaceView when usePacWorkspaceV2Enabled() returns true.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { SuggestionCard, type SuggestionData } from './SuggestionCard';
import { SkipModal } from './SkipModal';
import { AlreadyDoneModal } from './AlreadyDoneModal';

interface SuggestionsResponse {
  caseId: string;
  pending: SuggestionData[];
  skipped: SuggestionData[];
  decided: SuggestionData[];
  counts: {
    pending: number;
    skipped: number;
    decided: number;
    requiredPending: number;
    recommendedPending: number;
    infoPending: number;
  };
}

interface Props {
  caseId: string;
  /**
   * When true, the inbox renders action buttons enabled. PCW2.4a defaulted
   * to false (read-only); PCW2.4b defaults to true now that decision API
   * + modals are live.
   */
  actionsEnabled?: boolean;
}

type ModalState =
  | { kind: 'skip'; suggestion: SuggestionData }
  | { kind: 'already_done'; suggestion: SuggestionData }
  | null;

/** Suggestions whose accept path doesn't insert a section row — bulk accept skips them. */
function isAsaOrInfoOnly(s: SuggestionData): boolean {
  return (
    s.routes_to === 'asa_review' ||
    s.routes_to === 'info_only' ||
    s.routes_to === 'pac_visit'
  );
}

export function SuggestionsInbox({ caseId, actionsEnabled = true }: Props) {
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [bulkInFlight, setBulkInFlight] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/pac-workspace/${caseId}/suggestions`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json.data as SuggestionsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  const handleManualRecompute = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/pac-workspace/${caseId}/recompute`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRefreshing(false);
    }
  }, [caseId, load]);

  // PCW2.4b — direct accept (no modal): info_only ack, asa_review ack,
  // pac_visit ack, plus single-button accept on the card.
  const handleAccept = useCallback(
    async (s: SuggestionData) => {
      setActionInFlight(s.id);
      setError(null);
      try {
        const res = await fetch(
          `/api/pac-workspace/${caseId}/suggestions/${s.id}/decision`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept' }),
          }
        );
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setActionInFlight(null);
      }
    },
    [caseId, load]
  );

  const handleSkip = useCallback((s: SuggestionData) => {
    setModal({ kind: 'skip', suggestion: s });
  }, []);

  const handleAlreadyDone = useCallback((s: SuggestionData) => {
    setModal({ kind: 'already_done', suggestion: s });
  }, []);

  const handleModalSubmitted = useCallback(async () => {
    setModal(null);
    await load();
  }, [load]);

  const handleBulkAccept = useCallback(async () => {
    if (!data) return;
    const requiredIds = data.pending
      .filter((s) => s.severity === 'required' && !isAsaOrInfoOnly(s))
      .map((s) => s.id);
    if (requiredIds.length === 0) return;
    setBulkInFlight(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pac-workspace/${caseId}/suggestions/bulk-accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestion_ids: requiredIds }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkInFlight(false);
    }
  }, [caseId, data, load]);

  // Loading state — render a thin placeholder so the layout doesn't jump.
  if (loading) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Smart
          Suggestions…
        </div>
      </section>
    );
  }

  // Failure state — render a quiet error strip; doesn't block the rest of
  // the workspace.
  if (error || !data) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Couldn&apos;t load Smart Suggestions: {error ?? 'unknown error'}.
        <button
          type="button"
          onClick={handleRefresh}
          className="ml-2 underline hover:no-underline"
        >
          Retry
        </button>
      </section>
    );
  }

  const pendingCount = data.counts.pending;
  const skippedCount = data.counts.skipped;
  const decidedCount = data.counts.decided;

  // 0 pending — collapsed line per PRD §8.1
  if (pendingCount === 0) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          All SOP suggestions reviewed
          {decidedCount > 0 && (
            <span className="ml-1 text-emerald-700/70">
              · {decidedCount} accepted / done
            </span>
          )}
          {skippedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowSkipped((v) => !v)}
              className="ml-2 underline hover:no-underline"
            >
              Skipped ({skippedCount}) — {showSkipped ? 'hide' : 'view'}
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={handleManualRecompute}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-emerald-800/80 hover:text-emerald-900 disabled:opacity-50"
          title="Recompute suggestions"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />{' '}
          Recompute
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-indigo-200 bg-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          Smart Suggestions
          <span className="text-xs font-normal text-gray-500">
            · {pendingCount} to review
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          {data.counts.requiredPending > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">
              {data.counts.requiredPending} required
            </span>
          )}
          {data.counts.recommendedPending > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
              {data.counts.recommendedPending} recommended
            </span>
          )}
          {data.counts.infoPending > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
              {data.counts.infoPending} info
            </span>
          )}
          <button
            type="button"
            onClick={handleManualRecompute}
            disabled={refreshing}
            className="ml-1 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 disabled:opacity-50"
            title="Recompute suggestions"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />{' '}
            Recompute
          </button>
        </div>
      </header>

      {/* Cards (already sorted REQUIRED→RECOMMENDED→INFO by API) */}
      <div className="divide-y divide-gray-100">
        {data.pending.map((s) => (
          <div
            key={s.id}
            className={`px-3 ${actionInFlight === s.id ? 'opacity-60' : ''}`}
          >
            <SuggestionCard
              suggestion={s}
              actionsEnabled={actionsEnabled && actionInFlight !== s.id}
              onAccept={handleAccept}
              onAlreadyDone={handleAlreadyDone}
              onSkip={handleSkip}
            />
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
        <button
          type="button"
          onClick={handleBulkAccept}
          disabled={
            !actionsEnabled || bulkInFlight || data.counts.requiredPending === 0
          }
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {bulkInFlight ? 'Accepting…' : `Accept all required (${data.counts.requiredPending})`}
        </button>
        {skippedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowSkipped((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Skipped ({skippedCount}) — {showSkipped ? 'hide' : 'view'}
          </button>
        )}
      </footer>

      {/* Skipped drawer — read-only display */}
      {showSkipped && skippedCount > 0 && (
        <div className="border-t border-dashed border-gray-200 bg-gray-50">
          <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Skipped suggestions
          </div>
          <div className="divide-y divide-gray-200">
            {data.skipped.map((s) => (
              <div key={s.id} className="px-3">
                <SuggestionCard suggestion={s} actionsEnabled={false} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals — single instance via modal state */}
      {modal?.kind === 'skip' && (
        <SkipModal
          caseId={caseId}
          suggestion={modal.suggestion}
          onClose={() => setModal(null)}
          onSubmitted={handleModalSubmitted}
        />
      )}
      {modal?.kind === 'already_done' && (
        <AlreadyDoneModal
          caseId={caseId}
          suggestion={modal.suggestion}
          onClose={() => setModal(null)}
          onSubmitted={handleModalSubmitted}
        />
      )}
    </section>
  );
}
