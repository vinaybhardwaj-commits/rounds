// ============================================
// WhatsApp Analysis Engine — Pass C: Synthesis
// Phase: WA.3
//
// Produces final summary, flags global issues,
// and proposes rubric improvements.
// ============================================

import { neon } from '@neondatabase/serverless';
import llm, { MODEL_PRIMARY } from '@/lib/llm';
import type {
  ExtractionResult, SynthesisResult, GlobalFlag, AnalysisSummary,
  RubricProposal, GlobalIssuesConfig, UnattributedMessage,
} from './types';

/**
 * Fetch global issues definitions from wa_rubric.
 */
async function getGlobalIssues(): Promise<GlobalIssuesConfig | null> {
  const sql = neon(process.env.POSTGRES_URL!);
  const rows = await sql(
    `SELECT global_issues FROM wa_rubric WHERE slug = 'global-issues' LIMIT 1`
  ) as { global_issues: GlobalIssuesConfig | string | null }[];

  if (rows.length === 0 || !rows[0].global_issues) return null;
  const gi = rows[0].global_issues;
  return typeof gi === 'string' ? JSON.parse(gi) : gi;
}

function buildSynthesisPrompt(
  extractions: ExtractionResult[],
  globalIssues: GlobalIssuesConfig,
  allUnattributed: UnattributedMessage[],
  sourceGroup: string,
): { system: string; user: string } {
  const system = `You are the synthesis engine for Even Hospital's (EHRC) WhatsApp analysis system.

PART 1 — GLOBAL ISSUES:
Review extracted data points against this global issues registry and flag any matches:
${JSON.stringify(globalIssues, null, 2)}

For each flagged issue, provide: issue_id, issue_label, severity ("red" or "amber"), details, data_date, source_group, source_sender, source_time.

PART 2 — RUBRIC PROPOSALS (analyze unattributed messages):
Identify:
1. NEW KEYWORDS: Words/phrases in operational context not in any department's keywords
2. NEW FIELDS: Metrics discussed but no matching field label
3. SENDER AUTHORITY: Senders with consistent accurate departmental data
For each proposal, provide evidence with message excerpts and occurrence count.

Return ONLY a JSON object. No explanation, no markdown fences.

OUTPUT FORMAT:
{
  "global_issues": [
    { "issue_id": "...", "issue_label": "...", "severity": "red"|"amber", "details": "...", "data_date": "YYYY-MM-DD", "source_group": "...", "source_sender": "...", "source_time": "HH:MM" }
  ],
  "rubric_proposals": [
    {
      "rubric_slug": "dept-slug",
      "proposal_type": "new_keyword"|"new_field"|"sender_authority"|"new_dept_association",
      "proposal_detail": { "keyword": "...", "reason": "..." },
      "evidence": { "message_excerpts": ["..."], "occurrence_count": 1, "first_seen": "YYYY-MM-DD" }
    }
  ]
}`;

  // Build compact extraction summary for user prompt
  const deptSummaries = extractions.map(e => {
    const points = e.data_points.map(dp =>
      `  - ${dp.field_label}: ${dp.value} (${dp.confidence}, ${dp.source_sender}, ${dp.data_date})`
    ).join('\n');
    return `## ${e.department_slug} (${e.data_points.length} points)\n${points}`;
  }).join('\n\n');

  const unattributedList = allUnattributed.slice(0, 30).map(u =>
    `  [${u.hash.substring(0, 8)}] ${u.raw_text.substring(0, 100)} — ${u.reason}`
  ).join('\n');

  const user = `Source group: ${sourceGroup}

EXTRACTED DATA POINTS BY DEPARTMENT:
${deptSummaries || '(no data points extracted)'}

UNATTRIBUTED MESSAGES (${allUnattributed.length} total, showing first 30):
${unattributedList || '(none)'}

Analyze the above and produce global issues flags and rubric improvement proposals.`;

  return { system, user };
}

function extractJSON(text: string): { global_issues?: GlobalFlag[]; rubric_proposals?: RubricProposal[] } | null {
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
 * Pass C: Synthesize extraction results into summary + global flags + rubric proposals.
 */
export async function synthesizeResults(
  extractions: ExtractionResult[],
  sourceGroup: string,
  totalMessagesScanned: number,
  dateRange: { start: string; end: string } | null,
): Promise<{
  synthesis: SynthesisResult;
  tokensPrompt: number;
  tokensCompletion: number;
  latencyMs: number;
  llmCalls: number;
}> {
  const globalIssuesDef = await getGlobalIssues();

  // Collect all unattributed messages across departments
  const allUnattributed: UnattributedMessage[] = [];
  for (const e of extractions) {
    allUnattributed.push(...e.unattributed_messages);
  }

  // Compute summary stats
  const totalDataPoints = extractions.reduce((sum, e) => sum + e.data_points.length, 0);
  const deptsWithData = extractions.filter(e => e.data_points.length > 0).map(e => e.department_slug);

  const summary: AnalysisSummary = {
    total_messages_scanned: totalMessagesScanned,
    total_data_points: totalDataPoints,
    global_issues_count: 0, // updated after LLM call
    unattributed_count: allUnattributed.length,
    departments_with_data: deptsWithData,
    date_range: dateRange || { start: '', end: '' },
  };

  // If no data points and no unattributed, skip LLM call
  if (totalDataPoints === 0 && allUnattributed.length === 0) {
    return {
      synthesis: { global_issues: [], summary, rubric_proposals: [] },
      tokensPrompt: 0, tokensCompletion: 0, latencyMs: 0, llmCalls: 0,
    };
  }

  // Call LLM for synthesis
  let globalIssues: GlobalFlag[] = [];
  let rubricProposals: RubricProposal[] = [];
  let tokensPrompt = 0;
  let tokensCompletion = 0;
  let latencyMs = 0;

  if (globalIssuesDef) {
    const { system, user } = buildSynthesisPrompt(extractions, globalIssuesDef, allUnattributed, sourceGroup);
    const start = Date.now();

    const response = await llm.chat.completions.create({
      model: MODEL_PRIMARY,
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    latencyMs = Date.now() - start;
    const text = response.choices[0]?.message?.content || '';
    tokensPrompt = response.usage?.prompt_tokens || 0;
    tokensCompletion = response.usage?.completion_tokens || 0;

    const parsed = extractJSON(text);
    if (parsed) {
      globalIssues = parsed.global_issues || [];
      rubricProposals = parsed.rubric_proposals || [];
    }
  }

  summary.global_issues_count = globalIssues.length;

  return {
    synthesis: {
      global_issues: globalIssues,
      summary,
      rubric_proposals: rubricProposals,
    },
    tokensPrompt,
    tokensCompletion,
    latencyMs,
    llmCalls: globalIssuesDef ? 1 : 0,
  };
}
