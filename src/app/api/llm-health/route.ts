// ============================================
// GET /api/llm-health — check LLM tunnel connectivity
// Returns { healthy, latency_ms, model, error? }
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import llm, { MODEL_PRIMARY } from '@/lib/llm';

export const dynamic = 'force-dynamic';
// Resilience pass (26 Apr 2026): cap at 90s — SDK timeout is 60s, leave headroom.
export const maxDuration = 90;

export async function GET() {
  // Require authentication — exposes internal model info
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();

  // Quick check: are env vars even set?
  if (!process.env.LLM_BASE_URL) {
    return NextResponse.json({
      healthy: false,
      latency_ms: 0,
      model: null,
      base_url_set: false,
      error: 'LLM_BASE_URL not configured in environment variables',
    });
  }

  try {
    // Minimal inference call — ask for a single token
    const response = await llm.chat.completions.create({
      model: MODEL_PRIMARY,
      max_tokens: 4,
      temperature: 0,
      messages: [{ role: 'user', content: 'Reply with OK' }],
    });

    const latency = Date.now() - start;
    const text = response.choices[0]?.message?.content || '';

    return NextResponse.json({
      healthy: true,
      latency_ms: latency,
      model: response.model || MODEL_PRIMARY,
      base_url_set: true,
      response: text.slice(0, 20),
    });
  } catch (error) {
    const latency = Date.now() - start;
    const msg = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json({
      healthy: false,
      latency_ms: latency,
      model: null,
      base_url_set: true,
      error: msg.length > 200 ? msg.slice(0, 200) + '...' : msg,
    });
  }
}
