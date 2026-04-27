// ============================================
// GET /api/cron/sla-sweeper
//
// Runs every 5 minutes via Vercel cron. Scans for handoff form_submissions
// that haven't been acknowledged within the SLA window (default 30 min) and
// emits a breach summary to each hospital's -ehrc broadcast + the central
// `central-broadcast` channel.
//
// Auth: Bearer CRON_SECRET (same pattern as the LSQ cron).
//
// Dedup strategy: we use a JSONB metadata field on form_submissions
// (`metadata.sla_breach_posted_at`) to avoid re-posting the same breach on
// every 5-min tick. Sprint 3 can promote this to a proper `sla_breaches`
// table if we want historical analytics.
//
// Response:
//   { success: true, checked: N, breached: [{ submission_id, form_type, elapsed_min, hospital_slug, channel }] }
//
// Sprint 2 Day 10 (24 April 2026). Framework endpoint — SLA thresholds are
// conservative defaults; PRD can tune per form type in Sprint 3.
//
// 25 Apr 2026 fix: form_submissions has 'created_at' not 'submitted_at'; this
// route had been 500ing every 5 min since deploy. Aliased to keep the shape.
// Also added the metadata column via migration-form-submissions-metadata.sql.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getStreamServerClient } from '@/lib/getstream';

// Default SLA threshold per form type (in minutes). Per PRD v3 §8.3, defaults
// are 30 min for handoff acknowledgment. Sprint 3 can externalize these into
// a sla_config table.
const SLA_MINUTES_BY_FORM: Record<string, number> = {
  consolidated_marketing_handoff: 30,
  financial_counseling: 30,
  surgery_booking: 30,
  admission_advice: 60,
};

const CENTRAL_BROADCAST_ID = 'central-broadcast';
const HOSPITAL_BROADCAST_ID = 'hospital-broadcast'; // legacy single-channel — kept for back-compat fallback
// MH.5 — per-hospital broadcast channels (created via seed-channels endpoint).
// Channel id pattern: `broadcast-{slug}` (type ops-broadcast). EHIN is_active=false,
// so broadcast-ehin doesn't exist — the routing falls back to central-broadcast on miss.
const PER_HOSPITAL_BROADCAST_TYPE = 'ops-broadcast';
const perHospitalBroadcastChannelId = (slug: string) => `broadcast-${slug}`;

interface FormRow {
  id: string;
  form_type: string;
  submitted_at: string;
  hospital_id: string;
  hospital_slug: string;
  patient_name: string | null;
  cc_card_message_id: string | null;
  ot_card_message_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface BreachRecord {
  submission_id: string;
  form_type: string;
  elapsed_min: number;
  hospital_slug: string;
  patient_name: string | null;
  channel_card_ids: { cc: string | null; ot: string | null };
}

export async function GET(request: NextRequest) {
  try {
    // Auth: Bearer CRON_SECRET (or Vercel's own cron signature header).
    const authHeader = request.headers.get('authorization') || '';
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    const lookbackMs = 24 * 60 * 60 * 1000; // Only consider last 24h — older is irrecoverable.

    // Query recent handoff-family submissions that have posted cards.
    // Filter to records older than the minimum SLA (30 min) to avoid churning
    // on everything submitted in the last 30 min.
    const formTypes = Object.keys(SLA_MINUTES_BY_FORM);
    const rows = await query<FormRow>(
      `
      SELECT
        fs.id, fs.form_type, fs.created_at AS submitted_at,
        fs.hospital_id, h.slug AS hospital_slug,
        pt.patient_name,
        fs.cc_card_message_id, fs.ot_card_message_id,
        fs.metadata
      FROM form_submissions fs
      JOIN hospitals h ON h.id = fs.hospital_id
      LEFT JOIN patient_threads pt ON pt.id = fs.patient_thread_id
      WHERE fs.form_type = ANY($1::text[])
        AND fs.created_at > NOW() - $2::interval
        AND fs.created_at < NOW() - INTERVAL '30 minutes'
        AND (fs.cc_card_message_id IS NOT NULL OR fs.ot_card_message_id IS NOT NULL)
      ORDER BY fs.created_at ASC
      LIMIT 500
      `,
      [formTypes, `${Math.floor(lookbackMs / 1000)} seconds`]
    );

    const breached: BreachRecord[] = [];
    const toPost: Map<string, string[]> = new Map(); // hospital_slug → summary lines

    for (const r of rows) {
      const elapsedMin = Math.floor((now - new Date(r.submitted_at).getTime()) / 60000);
      const slaThreshold = SLA_MINUTES_BY_FORM[r.form_type] ?? 30;
      if (elapsedMin < slaThreshold) continue;

      // Dedup: skip if we've already posted a breach for this submission.
      const alreadyPosted = r.metadata && typeof r.metadata === 'object'
        ? (r.metadata as Record<string, unknown>).sla_breach_posted_at
        : undefined;
      if (alreadyPosted) continue;

      const rec: BreachRecord = {
        submission_id: r.id,
        form_type: r.form_type,
        elapsed_min: elapsedMin,
        hospital_slug: r.hospital_slug,
        patient_name: r.patient_name,
        channel_card_ids: { cc: r.cc_card_message_id, ot: r.ot_card_message_id },
      };
      breached.push(rec);

      const line = `⚠️ ${r.form_type} · ${r.patient_name ?? '(no name)'} · ${elapsedMin} min elapsed (SLA ${slaThreshold} min)`;
      if (!toPost.has(r.hospital_slug)) toPost.set(r.hospital_slug, []);
      toPost.get(r.hospital_slug)!.push(line);

      // Mark as posted BEFORE attempting the Stream post — better to have a
      // false positive dedup than spam users if Stream retries flake.
      await query(
        `
        UPDATE form_submissions
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('sla_breach_posted_at', NOW())
        WHERE id = $1
        `,
        [r.id]
      );
    }

    // MH.5 — Post digest to each hospital's per-hospital broadcast channel
    // (broadcast-{slug}, type ops-broadcast). Falls back to central-broadcast on
    // GetStream miss (e.g. EHIN where is_active=false → channel doesn't exist).
    // Per-channel try/catch so one hospital's GetStream hiccup doesn't lose
    // breaches for the others — DB metadata.sla_breach_posted_at is already
    // stamped before this loop.
    const channelPosted: Record<string, string> = {};
    if (toPost.size > 0) {
      const client = getStreamServerClient();
      for (const [slug, lines] of toPost.entries()) {
        const text = `🚨 *SLA breach digest — ${slug.toUpperCase()}*\n\n${lines.join('\n')}`;
        const perHospitalId = perHospitalBroadcastChannelId(slug);
        let postedTo: string | null = null;
        try {
          const channel = client.channel(PER_HOSPITAL_BROADCAST_TYPE, perHospitalId);
          await channel.sendMessage({ text, user_id: 'rounds-system' });
          postedTo = perHospitalId;
        } catch (perHospitalErr) {
          // Fallback to central-broadcast — covers EHIN (is_active=false → no
          // broadcast-ehin channel) plus any transient per-hospital errors.
          console.warn(
            `[sla-sweeper] per-hospital post to ${perHospitalId} failed, falling back to ${CENTRAL_BROADCAST_ID}:`,
            (perHospitalErr as Error).message
          );
          try {
            const fallback = client.channel('cross-functional', CENTRAL_BROADCAST_ID);
            await fallback.sendMessage({ text, user_id: 'rounds-system' });
            postedTo = CENTRAL_BROADCAST_ID;
          } catch (fallbackErr) {
            console.error(
              `[sla-sweeper] both per-hospital and central post failed for ${slug} (breaches recorded in DB):`,
              (fallbackErr as Error).message
            );
          }
        }
        if (postedTo) channelPosted[slug] = postedTo;
      }
    }

    return NextResponse.json({
      success: true,
      checked: rows.length,
      breach_count: breached.length,
      breached,
      channel_posted: channelPosted, // MH.5 — per-hospital map (slug → channel id used)
      legacy_hospital_broadcast_id: HOSPITAL_BROADCAST_ID, // unused; kept for back-compat awareness
    });
  } catch (error) {
    console.error('GET /api/cron/sla-sweeper error:', error);
    return NextResponse.json(
      { success: false, error: 'SLA sweep failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
