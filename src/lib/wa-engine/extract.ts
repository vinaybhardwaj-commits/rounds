// ============================================
// WhatsApp Analysis Engine — Pass B: Extraction
// Phase: WA.3
//
// Extracts structured data points per department.
// Runs in parallel across departments via Promise.all().
// ============================================

import { neon } from '@neondatabase/serverless';
import llm, { MODEL_PRIMARY } from '@/lib/llm';
import type {
  ParsedWhatsAppMessage, ClassifiedMessage, ExtractionResult,
  ExtractedDataPoint, UnattributedMessage, RubricField,
} from './types';

interface DeptRubric {
  slug: string;
  name: string;
  fields: RubricField[];
  sender_authority: Record<string, string>;
}

/**
 * Fetch a single department's rubric from wa_rubric.
 */
async function getDeptRubric(slug: string): Promise<DeptRubric | null> {
  const sql = neon(process.env.POSTGRES_URL!);
  const rows = await sql(
    `SELECT slug, name, fields, sender_authority FROM wa_rubric WHERE slug = $1 LIMIT 1`,
    [slug]
  ) as { slug: string; name: string; fields: RubricField[] | string; sender_authority: Record<string, string> | string }[];

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    slug: r.slug,
    name: r.name,
    fields: typeof r.fields === 'string' ? JSON.parse(r.fields) : r.fields,
    sender_authority: typeof r.sender_authority === 'string' ? JSON.parse(r.sender_authority) : (r.sender_authority || {}),
  };
}

function buildExtractionPrompt(rubric: DeptRubric, messages: ParsedWhatsAppMessage[]): { system: string; user: string } {
  const fieldList = rubric.fields.map(f =>
    `{ "label": "${f.label}", "type": "${f.type}", "extraction_hint": "${f.extraction_hint}" }`
  ).join(',\n  ');

  const authorityJson = Object.keys(rubric.sender_authority).length > 0
    ? JSON.stringify(rubric.sender_authority)
    : '{}';

  const system = `You are a hospital data extraction engine for the ${rubric.name} department at Even Hospital (EHRC).

EXTRACTION FIELDS:
[
  ${fieldList}
]

SENDER AUTHORITY:
${authorityJson}

RULES:
- Extract exact values where possible; use the extraction_hint to guide matching
- For numeric fields: extract the number only; ignore surrounding text
- For text fields: extract a concise status (< 50 words)
- Date attribution: use the message timestamp date. If message says "yesterday", subtract one day.
- Confidence: "high" (explicit number from known authority), "medium" (approximate or inferred), "low" (secondhand or ambiguous)
- If same metric appears multiple times for same date, take the latest/most specific value
- Return ONLY a JSON object. No explanation, no markdown fences.

OUTPUT FORMAT:
{
  "data_points": [
    {
      "field_label": "exact label from EXTRACTION FIELDS",
      "value": <number or "text string">,
      "data_date": "YYYY-MM-DD",
      "confidence": "high"|"medium"|"low",
      "source_sender": "sender name",
      "source_time": "HH:MM",
      "context": "brief quote or context (< 30 words)",
      "source_hash": "<message_hash>"
    }
  ],
  "unattributed_messages": [
    {
      "hash": "<message_hash>",
      "raw_text": "first 100 chars of message",
      "reason": "why it couldn't be attributed to a field"
    }
  ]
}`;

  const messageList = messages.map(m =>
    `[${m.hash.substring(0, 12)}] ${m.sender} (${m.timestamp.toISOString().substring(0, 16)}): ${m.content.substring(0, 500)}`
  ).join('\n\n');

  const user = `Extract data points from these ${messages.length} messages classified under ${rubric.name}:\n\n${messageList}`;

  return { system, user };
}

function extractJSON(text: string): { data_points: ExtractedDataPoint[]; unattributed_messages: UnattributedMessage[] } | null {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  const startIdx = jsonStr.indexOf('{');
  const endIdx = jsonStr.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) return null;
  try {
    return JSON.parse(jsonStr.substring(startIdx, endIdx + 1));
  } catch {
    return null;
  }
}

/**
 * Extract data points for a single department.
 */
async function extractForDepartment(
  deptSlug: string,
  messages: ParsedWhatsAppMessage[],
): Promise<{
  result: ExtractionResult;
  tokensPrompt: number;
  tokensCompletion: number;
  latencyMs: number;
}> {
  const rubric = await getDeptRubric(deptSlug);
  if (!rubric) {
    return {
      result: { department_slug: deptSlug, data_points: [], unattributed_messages: [] },
      tokensPrompt: 0, tokensCompletion: 0, latencyMs: 0,
    };
  }

  const { system, user } = buildExtractionPrompt(rubric, messages);
  const start = Date.now();

  const response = await llm.chat.completions.create({
    model: MODEL_PRIMARY,
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const latencyMs = Date.now() - start;
  const text = response.choices[0]?.message?.content || '';
  const tokensPrompt = response.usage?.prompt_tokens || 0;
  const tokensCompletion = response.usage?.completion_tokens || 0;

  const parsed = extractJSON(text);

  // Resolve hash prefixes to full hashes
  const hashMap = new Map(messages.map(m => [m.hash.substring(0, 12), m.hash]));

  const dataPoints: ExtractedDataPoint[] = (parsed?.data_points || []).map(dp => ({
    ...dp,
    source_hash: dp.source_hash?.length >= 64
      ? dp.source_hash
      : (hashMap.get(dp.source_hash?.substring(0, 12) || '') || dp.source_hash || ''),
  }));

  const unattributed: UnattributedMessage[] = (parsed?.unattributed_messages || []).map(u => ({
    ...u,
    hash: u.hash?.length >= 64 ? u.hash : (hashMap.get(u.hash?.substring(0, 12) || '') || u.hash || ''),
  }));

  return {
    result: {
      department_slug: deptSlug,
      data_points: dataPoints,
      unattributed_messages: unattributed,
    },
    tokensPrompt,
    tokensCompletion,
    latencyMs,
  };
}

/**
 * Pass B: Extract metrics from classified messages, per department.
 * Runs department extractions in parallel via Promise.all().
 */
export async function extractByDepartment(
  messages: ParsedWhatsAppMessage[],
  classifications: ClassifiedMessage[],
): Promise<{
  extractions: ExtractionResult[];
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  totalLatencyMs: number;
  llmCalls: number;
}> {
  // Group messages by department
  const deptMessages = new Map<string, ParsedWhatsAppMessage[]>();
  const hashToMessage = new Map(messages.map(m => [m.hash, m]));

  for (const c of classifications) {
    for (const dept of c.departments) {
      const msg = hashToMessage.get(c.hash);
      if (msg) {
        if (!deptMessages.has(dept)) deptMessages.set(dept, []);
        deptMessages.get(dept)!.push(msg);
      }
    }
  }

  if (deptMessages.size === 0) {
    return { extractions: [], totalTokensPrompt: 0, totalTokensCompletion: 0, totalLatencyMs: 0, llmCalls: 0 };
  }

  // Run all departments in parallel
  const tasks = Array.from(deptMessages.entries()).map(([slug, msgs]) =>
    extractForDepartment(slug, msgs)
  );

  const results = await Promise.all(tasks);

  let totalTokensPrompt = 0;
  let totalTokensCompletion = 0;
  let totalLatencyMs = 0;
  const extractions: ExtractionResult[] = [];

  for (const r of results) {
    extractions.push(r.result);
    totalTokensPrompt += r.tokensPrompt;
    totalTokensCompletion += r.tokensCompletion;
    totalLatencyMs += r.latencyMs;
  }

  return {
    extractions,
    totalTokensPrompt,
    totalTokensCompletion,
    totalLatencyMs: Math.max(...results.map(r => r.latencyMs)), // wall-clock = slowest
    llmCalls: results.length,
  };
}
