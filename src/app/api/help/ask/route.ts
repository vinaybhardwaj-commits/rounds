/* ──────────────────────────────────────────────────────────────────
   Help API — POST /api/help/ask
   Answers a help question using the knowledge base + Qwen
   ────────────────────────────────────────────────────────────────── */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { answerHelpQuestion } from '@/lib/help-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request
    const body = await request.json();
    const { question, page } = body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Missing question parameter' }, { status: 400 });
    }

    // 3. Fetch user's hospital vars for {{user.*}} substitution (v1.1 — 28 Apr 2026).
    // The JWT payload only carries profileId/email/role/status; hospital info
    // lives in profiles + hospitals so we JOIN once per help request.
    // Failure is non-fatal — substitution falls back to generic labels
    // ('your hospital'). Same defensive posture as the audit() wires.
    let userVars: {
      full_name?: string | null;
      role?: string | null;
      role_scope?: 'hospital_bound' | 'multi_hospital' | 'central' | null;
      primary_hospital_id?: string | null;
      primary_hospital_slug?: string | null;
      primary_hospital_short_name?: string | null;
      primary_hospital_name?: string | null;
    } = { role: user.role };
    try {
      const rows = await sql`
        SELECT
          p.full_name,
          p.role,
          p.role_scope,
          p.primary_hospital_id::text AS primary_hospital_id,
          h.slug AS primary_hospital_slug,
          h.short_name AS primary_hospital_short_name,
          h.name AS primary_hospital_name
        FROM profiles p
        LEFT JOIN hospitals h ON h.id = p.primary_hospital_id
        WHERE p.id = ${user.profileId}::uuid
        LIMIT 1
      `;
      const rowArr = rows as unknown as Record<string, unknown>[];
      const row = rowArr[0];
      if (row) {
        userVars = {
          full_name: row.full_name as string | null,
          role: (row.role as string | null) ?? user.role,
          role_scope: row.role_scope as 'hospital_bound' | 'multi_hospital' | 'central' | null,
          primary_hospital_id: row.primary_hospital_id as string | null,
          primary_hospital_slug: row.primary_hospital_slug as string | null,
          primary_hospital_short_name: row.primary_hospital_short_name as string | null,
          primary_hospital_name: row.primary_hospital_name as string | null,
        };
      }
    } catch (err) {
      console.warn('[HelpAPI] Failed to fetch user vars (substitution will use fallbacks):', err);
    }

    // 4. Answer the question
    const response = await answerHelpQuestion(question.trim(), {
      role: user.role,
      page: page || undefined,
      userVars,
    });

    // 5. Log the interaction and get the ID back for feedback
    let interactionId: number | null = null;
    try {
      interactionId = await logInteraction(user.profileId, question.trim(), response.matched_features, response.source, page);
    } catch (err) {
      console.error('[HelpAPI] Failed to log interaction:', err);
    }

    return NextResponse.json({ ...response, interactionId });
  } catch (err) {
    console.error('[HelpAPI] Error:', err);
    return NextResponse.json({ success: false, error: 'Failed to process help request' }, { status: 500 });
  }
}

/**
 * Log help interaction to DB (fire-and-forget).
 */
async function logInteraction(
  profileId: string,
  question: string,
  matchedFeatures: string[],
  responseSource: string,
  contextPage?: string
): Promise<number | null> {
  try {
    const rows = await sql`
      INSERT INTO help_interactions (profile_id, question, matched_features, response_source, context_page)
      VALUES (${profileId}, ${question}, ${matchedFeatures as unknown as string}, ${responseSource}, ${contextPage || null})
      RETURNING id
    `;
    // v1.1 drive-by: cast for proper typed indexing (was a TS7053 baseline error).
    const rowArr = rows as unknown as { id: number }[];
    return rowArr[0]?.id ?? null;
  } catch (err) {
    // Table might not exist yet — silently fail
    console.warn('[HelpAPI] Could not log interaction (table may not exist):', err);
    return null;
  }
}
