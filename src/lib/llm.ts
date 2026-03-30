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

const llm = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || 'ollama',
  timeout: 120000, // 2 min — local inference can be slow on big prompts
});

export default llm;

// ── Model aliases ──
// Use these in callLLM() to pick the right model for the job.
export const MODEL_PRIMARY = 'qwen2.5:14b';   // Complex analysis, reasoning, structured output
export const MODEL_FAST = 'llama3.1:8b';       // Tool use, classification, quick tasks
