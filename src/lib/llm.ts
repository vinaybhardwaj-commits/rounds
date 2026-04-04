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
  timeout: 120000, // 2 min — local inference can be slow on big prompts
});

export default llm;

// ── Model aliases ──
// Use these in callLLM() to pick the right model for the job.
export const MODEL_PRIMARY = 'qwen2.5:14b';   // Complex analysis, reasoning, structured output
export const MODEL_FAST = 'llama3.1:8b';       // Tool use, classification, quick tasks
