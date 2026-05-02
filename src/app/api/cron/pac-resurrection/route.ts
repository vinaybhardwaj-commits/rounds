// =============================================================================
// GET /api/cron/pac-resurrection   (PCW2.6)
//
// Runs hourly via Vercel cron. Resurrects pac_suggestions rows where:
//   - status = 'already_done'
//   - recency_window_days IS NOT NULL
//   - already_done_evidence.done_at + recency_window_days < NOW()
//
// For each match (PRD §5.5):
//   1. UPDATE status='pending'
//   2. Append marker to decision_reason_notes:
//      "Auto-resurrected on YYYY-MM-DD — previously done YYYY-MM-DD,
//       rule recency window N days."
//   3. Audit pac.suggestion.auto_resurrect with from-status / done_at / window
//
// PRD §5.5 carve-outs: workspaces in resolution_state ∈ {completed, cancelled,
// superseded} are skipped — those are frozen lifecycles. (active_for_surgery
// still resurrects but the inbox should surface as a notification rather than
// blocking publish; that UX layer ships in PCW2.10/2.11.)
//
// Auth: Bearer CRON_SECRET (same pattern as sla-sweeper / lsq sync).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

const CRON_SECRET = process.env.CRON_SECRET || '';

interface ResurrectRow {
  id: string;
  case_id: string;
  rule_id: string;
  recency_window_days: number;
  done_at: string | null;
  prior_notes: string | null;
  hospital_id: string;
}

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    console.error('[pcw2.6 cron] CRON_SECRET not configured — refusing');
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET not configured' },
      { status: 503 }
    );
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();

  try {
    // Find all rows due for resurrection. Skip frozen workspaces by joining
    // pac_workspace_progress and excluding completed/cancelled/superseded
    // resolution_state. NULL resolution_state (no v2 progress row yet) is
    // included so backfilled suggestions on legacy cases still get checked.
    const candidates = await sqlQuery<ResurrectRow>(
      `SELECT s.id, s.case_id, s.rule_id, s.recency_window_days,
              (s.already_done_evidence->>'done_at') AS done_at,
              s.decision_reason_notes AS prior_notes,
              sc.hospital_id
         FROM pac_suggestions s
         JOIN surgical_cases sc ON sc.id = s.case_id
         LEFT JOIN pac_workspace_progress pwp ON pwp.case_id = s.case_id
        WHERE s.status = 'already_done'
          AND s.recency_window_days IS NOT NULL
          AND s.already_done_evidence ? 'done_at'
          AND (s.already_done_evidence->>'done_at')::timestamptz
              < NOW() - (s.recency_window_days || ' days')::interval
          AND sc.archived_at IS NULL
          AND COALESCE(pwp.resolution_state, 'none')
              NOT IN ('completed', 'cancelled', 'superseded')
        LIMIT 500`,
      []
    );

    let resurrected = 0;
    let failed = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const r of candidates) {
      try {
        const marker = `Auto-resurrected on ${today} — previously done ${
          r.done_at ?? 'unknown'
        }, rule recency window ${r.recency_window_days} days.`;
        const newNotes = r.prior_notes
          ? `${r.prior_notes}\n${marker}`
          : marker;

        const updated = await queryOne<{ id: string }>(
          `UPDATE pac_suggestions
              SET status = 'pending',
                  decision_reason_notes = $2,
                  updated_at = NOW()
            WHERE id = $1
              AND status = 'already_done'
            RETURNING id`,
          [r.id, newNotes]
        );

        if (updated) {
          resurrected += 1;
          // Audit per resurrection — coordinator dashboard can filter by
          // action='pac.suggestion.auto_resurrect' to see today's wave.
          audit({
            actorId: null,
            actorRole: 'system',
            hospitalId: r.hospital_id,
            action: 'pac.suggestion.auto_resurrect',
            targetType: 'pac_suggestion',
            targetId: r.id,
            summary: `Resurrected ${r.rule_id}: previously done ${r.done_at ?? 'unknown'}, recency window ${r.recency_window_days}d expired`,
            payloadAfter: {
              rule_id: r.rule_id,
              done_at: r.done_at,
              recency_window_days: r.recency_window_days,
              resurrected_at: today,
            },
            request,
          }).catch((e) =>
            console.error('[pcw2.6 cron] audit auto_resurrect failed:', e)
          );
        }
      } catch (e) {
        failed += 1;
        console.error(
          `[pcw2.6 cron] resurrect failed for suggestion ${r.id}:`,
          (e as Error).message
        );
      }
    }

    const result = {
      scanned: candidates.length,
      resurrected,
      failed,
      durationMs: Date.now() - t0,
    };
    console.log('[pcw2.6 cron] pac-resurrection summary', result);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /api/cron/pac-resurrection error:', err);
    return NextResponse.json(
      { success: false, error: 'Resurrection cron failed' },
      { status: 500 }
    );
  }
}
