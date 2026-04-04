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

    // 3. Answer the question
    const response = await answerHelpQuestion(question.trim(), {
      role: user.role,
      page: page || undefined,
    });

    // 4. Log the interaction and get the ID back for feedback
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
    return rows[0]?.id ?? null;
  } catch (err) {
    // Table might not exist yet — silently fail
    console.warn('[HelpAPI] Could not log interaction (table may not exist):', err);
    return null;
  }
}
