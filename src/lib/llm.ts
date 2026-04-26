// ============================================
// LLM Client — OpenAI SDK pointed at local Ollama
// via Cloudflare Tunnel.
//
// Env vars (set in Vercel):
//   LLM_BASE_URL = https://llm.yourdomain.com/v1
//   LLM_API_KEY  = ollama  (placeholder — Ollama doesn't need a real key)
//
// Hardware: Mac Mini M4 Pro, 24GB unified memory
// Models:  qwen2.5:14b (primary), llama3.1:8b (fast)
// ============================================

import OpenAI from 'openai';

const LLM_BASE_URL = process.env.LLM_BASE_URL?.trim() || 'http://localhost:11434/v1';
const LLM_API_KEY = process.env.LLM_API_KEY?.trim() || 'ollama';

if (!process.env.LLM_BASE_URL && process.env.NODE_ENV === 'production') {
  console.warn('[LLM] LLM_BASE_URL not set — defaulting to localhost:11434. AI features will fail in production unless a tunnel or remote URL is configured.');
}

const llm = new OpenAI({
  baseURL: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
  // Resilience pass (26 Apr 2026 outage): the previous timeout 120000 + SDK
  // default maxRetries 2 = 240s burned per failure when the tunnel is down.
  // 60s is comfortably above qwen2.5:14b's typical 30-90s response window
  // for a 1500-token briefing prompt; maxRetries 0 means one shot, then the
  // caller decides what to do. Cron jobs should pre-flight via pingTunnel().
  timeout: 60000,
  maxRetries: 0,
});

// ── Lightweight tunnel pre-flight check (5s timeout) ──
// Use this in cron jobs / batch paths BEFORE calling llm.chat.completions —
// avoids burning a 60s timeout when the tunnel is down. Returns true on
// HTTP 200 from /v1/models, false on anything else.
export async function pingTunnel(): Promise<{ healthy: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const url = LLM_BASE_URL.endsWith('/v1') ? `${LLM_BASE_URL}/models` : `${LLM_BASE_URL.replace(/\/$/, '')}/v1/models`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${LLM_API_KEY}` },
    });
    clearTimeout(t);
    const latency_ms = Date.now() - start;
    if (res.ok) return { healthy: true, latency_ms };
    return { healthy: false, latency_ms, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      healthy: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

export default llm;

// ── Model aliases ──
// Use these in callLLM() to pick the right model for the job.
export const MODEL_PRIMARY = 'qwen2.5:14b';   // Complex analysis, reasoning, structured output
export const MODEL_FAST = 'llama3.1:8b';       // Tool use, classification, quick tasks
