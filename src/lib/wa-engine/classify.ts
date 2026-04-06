// ============================================
// WhatsApp Analysis Engine — Pass A: Classification
// Phase: WA.3
//
// Assigns each message to zero or more departments
// using LLM + department keyword registry from wa_rubric.
// Batches messages in groups of ~80 for manageable prompts.
// ============================================

import { neon } from '@neondatabase/serverless';
import llm, { MODEL_PRIMARY } from '@/lib/llm';
import type { ParsedWhatsAppMessage, ClassifiedMessage } from './types';

// 150 messages per batch keeps prompts manageable while minimizing
// the number of LLM calls (important for Vercel 60s timeout).
const BATCH_SIZE = 150;

interface DeptRegistry {
  slug: string;
  name: string;
  keywords: string[];
}

/**
 * Fetch department keyword registry from wa_rubric table.
 */
async function getDeptRegistry(): Promise<DeptRegistry[]> {
  const sql = neon(process.env.POSTGRES_URL!);
  const rows = await sql(
    `SELECT slug, name, keywords FROM wa_rubric WHERE slug != 'global-issues' ORDER BY name`
  ) as { slug: string; name: string; keywords: string[] }[];

  return rows.map(r => ({
    slug: r.slug,
    name: r.name,
    keywords: Array.isArray(r.keywords) ? r.keywords : JSON.parse(r.keywords as unknown as string),
  }));
}

function buildSystemPrompt(registry: DeptRegistry[]): string {
  const deptList = registry.map(d =>
    `{ "slug": "${d.slug}", "name": "${d.name}", "keywords": ${JSON.stringify(d.keywords)} }`
  ).join(',\n  ');

  return `You are a hospital operations message classifier for Even Hospital (EHRC).
Given a list of messages from WhatsApp groups, classify each message to zero or more hospital departments based on the keyword registry provided.

DEPARTMENT REGISTRY:
[
  ${deptList}
]

RULES:
- A message may belong to multiple departments (e.g., "OT had to wait for pharmacy" → ot + pharmacy)
- Messages with only greetings, thank-yous, personal chat, or no operational content → classify as [] (empty)
- If a message contains OPD appointment details with patient name, doctor, ailment → classify as customer-care
- If a message discusses billing, pipeline cases, counselling → classify as billing
- If unsure but the message seems operational, include the most likely department
- Return ONLY a JSON array. No explanation, no markdown fences.

OUTPUT FORMAT:
[
  { "hash": "<message_hash>", "departments": ["dept-slug", ...], "classification_reason": "brief reason" },
  ...
]`;
}

function buildUserPrompt(messages: ParsedWhatsAppMessage[]): string {
  const messageList = messages.map(m =>
    `[${m.hash.substring(0, 12)}] ${m.sender} (${m.timestamp.toISOString().split('T')[0]}): ${m.content.substring(0, 300)}`
  ).join('\n');

  return `Classify these ${messages.length} messages:\n\n${messageList}`;
}

function extractJSONArray(text: string): ClassifiedMessage[] | null {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  const startIdx = jsonStr.indexOf('[');
  const endIdx = jsonStr.lastIndexOf(']');
  if (startIdx === -1 || endIdx === -1) return null;
  try {
    return JSON.parse(jsonStr.substring(startIdx, endIdx + 1));
  } catch {
    return null;
  }
}

async function classifyBatch(
  messages: ParsedWhatsAppMessage[],
  registry: DeptRegistry[],
): Promise<{ results: ClassifiedMessage[]; tokensPrompt: number; tokensCompletion: number; latencyMs: number }> {
  const start = Date.now();

  const response = await llm.chat.completions.create({
    model: MODEL_PRIMARY,
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: buildSystemPrompt(registry) },
      { role: 'user', content: buildUserPrompt(messages) },
    ],
  });

  const latencyMs = Date.now() - start;
  const text = response.choices[0]?.message?.content || '';
  const tokensPrompt = response.usage?.prompt_tokens || 0;
  const tokensCompletion = response.usage?.completion_tokens || 0;

  const parsed = extractJSONArray(text);
  if (!parsed) {
    throw new Error(`Pass A: LLM did not return valid JSON. Raw: ${text.substring(0, 200)}`);
  }

  // Match results by full hash or prefix (we send 12-char prefix in prompt)
  const hashSet = new Set(messages.map(m => m.hash));
  const results: ClassifiedMessage[] = [];
  for (const item of parsed) {
    const matchedHash = item.hash.length >= 64
      ? item.hash
      : messages.find(m => m.hash.startsWith(item.hash))?.hash;

    if (matchedHash && hashSet.has(matchedHash)) {
      results.push({
        hash: matchedHash,
        departments: Array.isArray(item.departments) ? item.departments : [],
        classification_reason: item.classification_reason || '',
      });
    }
  }

  return { results, tokensPrompt, tokensCompletion, latencyMs };
}

/**
 * Pass A: Classify all messages by department.
 * Batches messages in groups of BATCH_SIZE and processes sequentially
 * (to avoid overwhelming local Ollama).
 */
export async function classifyMessages(
  messages: ParsedWhatsAppMessage[],
): Promise<{
  classified: ClassifiedMessage[];
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  totalLatencyMs: number;
  llmCalls: number;
}> {
  if (messages.length === 0) {
    return { classified: [], totalTokensPrompt: 0, totalTokensCompletion: 0, totalLatencyMs: 0, llmCalls: 0 };
  }

  const registry = await getDeptRegistry();

  const batches: ParsedWhatsAppMessage[][] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    batches.push(messages.slice(i, i + BATCH_SIZE));
  }

  let totalTokensPrompt = 0;
  let totalTokensCompletion = 0;
  let totalLatencyMs = 0;
  const allResults: ClassifiedMessage[] = [];

  for (const batch of batches) {
    const { results, tokensPrompt, tokensCompletion, latencyMs } = await classifyBatch(batch, registry);
    allResults.push(...results);
    totalTokensPrompt += tokensPrompt;
    totalTokensCompletion += tokensCompletion;
    totalLatencyMs += latencyMs;
  }

  return {
    classified: allResults,
    totalTokensPrompt,
    totalTokensCompletion,
    totalLatencyMs,
    llmCalls: batches.length,
  };
}
