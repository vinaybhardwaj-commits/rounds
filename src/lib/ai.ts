// ============================================
// AI Integration — Local LLM via Ollama + Cloudflare Tunnel
// Uses OpenAI SDK pointed at Ollama's compatible API.
// Step 8.1–8.3: Gap Analysis, Briefing, Predictions
// ============================================

import llm, { MODEL_PRIMARY } from './llm';
import { sql } from '@/lib/db';

/**
 * Extract JSON from LLM response text.
 * Handles markdown code blocks, extra text around JSON, etc.
 */
function extractJSON(text: string): string | null {
  // Try markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  // Try raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : null;
}

// ── Types ──
export interface GapReport {
  score: number;
  summary: string;
  critical_gaps: Array<{
    field: string;
    reason: string;
    risk_level: 'high' | 'medium' | 'low';
  }>;
  recommendations: string[];
  flags: string[];
}

export interface DailyBriefing {
  date: string;
  summary: string;
  sections: {
    admissions: { count: number; highlights: string[] };
    surgeries: { count: number; highlights: string[] };
    discharges: { count: number; highlights: string[] };
    overdue_items: { count: number; highlights: string[] };
    escalations: { count: number; highlights: string[] };
    staff_alerts: string[];
  };
  action_items: Array<{ priority: 'high' | 'medium' | 'low'; text: string }>;
}

export interface PredictionResult {
  patient_thread_id: string;
  patient_name: string;
  predictions: {
    estimated_los_days: number | null;
    discharge_readiness_pct: number;
    escalation_risk: 'high' | 'medium' | 'low';
    risk_factors: string[];
  };
}

// ── 8.1: Gap Analysis ──
export async function analyzeFormGaps(
  formType: string,
  formData: Record<string, unknown>,
  patientContext?: {
    stage: string;
    patient_name: string;
    admission_date?: string;
  }
): Promise<GapReport> {
  const contextStr = patientContext
    ? `Patient: ${patientContext.patient_name}, Stage: ${patientContext.stage}${
        patientContext.admission_date ? `, Admitted: ${patientContext.admission_date}` : ''
      }`
    : 'No patient context';

  const response = await llm.chat.completions.create({
    model: MODEL_PRIMARY,
    temperature: 0.3,
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: 'You are a hospital operations analyst at Even Hospital, Indore. Analyze medical forms for completeness, gaps, and risks. Respond ONLY with valid JSON. No markdown, no explanation — just the JSON object.',
      },
      {
        role: 'user',
        content: `Analyze this ${formType} form submission for gaps and risks.

Context: ${contextStr}

Form data:
${JSON.stringify(formData, null, 2)}

Return ONLY this JSON (no other text):
{
  "score": <0-100 completeness>,
  "summary": "<one paragraph assessment>",
  "critical_gaps": [{"field": "...", "reason": "...", "risk_level": "high|medium|low"}],
  "recommendations": ["..."],
  "flags": ["<any concerning patterns or values>"]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '';
  const jsonStr = extractJSON(text);

  if (!jsonStr) {
    return {
      score: 0,
      summary: 'Unable to analyze form — LLM did not return valid JSON',
      critical_gaps: [],
      recommendations: ['Resubmit form for analysis'],
      flags: [],
    };
  }

  const report = JSON.parse(jsonStr) as GapReport;

  // Cache the result
  try {
    const tokens = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);
    await sql`
      INSERT INTO ai_analysis (analysis_type, source_type, result, model, token_count)
      VALUES ('gap_analysis', ${formType}, ${JSON.stringify(report)}::jsonb, ${response.model || MODEL_PRIMARY}, ${tokens})
    `;
  } catch {
    // Non-fatal
  }

  return report;
}

// ── 8.2: Daily Briefing ──
export async function generateDailyBriefing(): Promise<DailyBriefing> {
  const today = new Date().toISOString().split('T')[0];

  const [patients, overdueItems, escalations, dutyRoster] = await Promise.all([
    sql`
      SELECT id, patient_name, current_stage, admission_date, discharge_date, created_at
      FROM patient_threads
      WHERE current_stage NOT IN ('post_discharge')
      ORDER BY created_at DESC
      LIMIT 50
    `,
    sql`
      SELECT ri.item_name, ri.item_category, ri.status, ri.due_by, ri.escalated,
             fs.form_type, pt.patient_name
      FROM readiness_items ri
      JOIN form_submissions fs ON ri.form_submission_id = fs.id
      LEFT JOIN patient_threads pt ON fs.patient_thread_id = pt.id
      WHERE ri.status = 'pending'
      AND (ri.due_by IS NULL OR ri.due_by <= NOW())
      ORDER BY ri.due_by ASC NULLS LAST
      LIMIT 30
    `,
    sql`
      SELECT source_type, level, reason, resolved, created_at
      FROM escalation_log
      WHERE resolved = false
      ORDER BY level DESC, created_at DESC
      LIMIT 20
    `,
    sql`
      SELECT dr.shift_type, dr.role, p.full_name, d.name as dept_name
      FROM duty_roster dr
      JOIN profiles p ON dr.user_id = p.id
      LEFT JOIN departments d ON dr.department_id = d.id
      WHERE dr.effective_from <= ${today}
      AND (dr.effective_to IS NULL OR dr.effective_to >= ${today})
      LIMIT 30
    `,
  ]);

  const stageCounts: Record<string, number> = {};
  for (const p of patients) {
    const stage = p.current_stage as string;
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
  }

  const todaySurgeries = patients.filter((p) => p.current_stage === 'surgery' || p.current_stage === 'pre_op');
  const todayDischarges = patients.filter((p) => p.current_stage === 'discharge');
  const admitted = patients.filter((p) => p.current_stage === 'admitted');

  const response = await llm.chat.completions.create({
    model: MODEL_PRIMARY,
    temperature: 0.3,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: 'You are the AI operations assistant for Even Hospital Race Course Road, Indore. Generate a concise morning briefing. Be specific with numbers and names. Respond ONLY with valid JSON.',
      },
      {
        role: 'user',
        content: `Generate today's morning briefing (${today}).

Active patients by stage: ${JSON.stringify(stageCounts)}
Total active: ${patients.length}

Surgery/pre-op (${todaySurgeries.length}):
${todaySurgeries.map((p) => `- ${p.patient_name} (${p.current_stage})`).join('\n') || 'None'}

Discharge (${todayDischarges.length}):
${todayDischarges.map((p) => `- ${p.patient_name}`).join('\n') || 'None'}

Admitted (${admitted.length}):
${admitted.map((p) => `- ${p.patient_name} (since ${p.admission_date || 'unknown'})`).join('\n') || 'None'}

Overdue items (${overdueItems.length}):
${overdueItems.slice(0, 10).map((i) => `- ${i.patient_name}: ${i.item_name} (${i.item_category})`).join('\n') || 'None'}

Escalations (${escalations.length}):
${escalations.slice(0, 5).map((e) => `- ${e.source_type}: ${e.reason} (level: ${e.level})`).join('\n') || 'None'}

On-duty (${dutyRoster.length}):
${dutyRoster.slice(0, 10).map((d) => `- ${d.full_name} (${d.role}, ${d.shift_type}${d.dept_name ? ', ' + d.dept_name : ''})`).join('\n') || 'No roster entries'}

Return ONLY this JSON:
{
  "date": "${today}",
  "summary": "<2-3 sentence overview>",
  "sections": {
    "admissions": {"count": ${admitted.length}, "highlights": ["..."]},
    "surgeries": {"count": ${todaySurgeries.length}, "highlights": ["..."]},
    "discharges": {"count": ${todayDischarges.length}, "highlights": ["..."]},
    "overdue_items": {"count": ${overdueItems.length}, "highlights": ["..."]},
    "escalations": {"count": ${escalations.length}, "highlights": ["..."]},
    "staff_alerts": ["<any concerns>"]
  },
  "action_items": [{"priority": "high|medium|low", "text": "..."}]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '';
  const jsonStr = extractJSON(text);

  let briefing: DailyBriefing;
  if (jsonStr) {
    briefing = JSON.parse(jsonStr);
  } else {
    briefing = {
      date: today,
      summary: 'Unable to generate briefing — check that Ollama is running and the Cloudflare Tunnel is active.',
      sections: {
        admissions: { count: admitted.length, highlights: [] },
        surgeries: { count: todaySurgeries.length, highlights: [] },
        discharges: { count: todayDischarges.length, highlights: [] },
        overdue_items: { count: overdueItems.length, highlights: [] },
        escalations: { count: escalations.length, highlights: [] },
        staff_alerts: [],
      },
      action_items: [],
    };
  }

  try {
    const tokens = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);
    await sql`
      INSERT INTO ai_analysis (analysis_type, source_type, result, model, token_count)
      VALUES ('daily_briefing', 'hospital', ${JSON.stringify(briefing)}::jsonb, ${response.model || MODEL_PRIMARY}, ${tokens})
    `;
  } catch {
    // Non-fatal
  }

  return briefing;
}

// ── 8.3: Predictive Intelligence ──
export async function predictPatientOutcomes(
  patientThreadId: string
): Promise<PredictionResult | null> {
  const patients = await sql`
    SELECT pt.*, p.full_name as consultant_name, d.name as department_name
    FROM patient_threads pt
    LEFT JOIN profiles p ON pt.primary_consultant_id = p.id
    LEFT JOIN departments d ON pt.department_id = d.id
    WHERE pt.id = ${patientThreadId}
  `;

  if (patients.length === 0) return null;
  const patient = patients[0];

  const forms = await sql`
    SELECT form_type, status, completion_score, created_at
    FROM form_submissions
    WHERE patient_thread_id = ${patientThreadId}
    ORDER BY created_at DESC
  `;

  const readiness = await sql`
    SELECT ri.item_name, ri.status, ri.item_category, ri.due_by, ri.escalated
    FROM readiness_items ri
    JOIN form_submissions fs ON ri.form_submission_id = fs.id
    WHERE fs.patient_thread_id = ${patientThreadId}
  `;

  const escalations = await sql`
    SELECT level, resolved, reason
    FROM escalation_log
    WHERE source_id = ${patientThreadId} AND source_type = 'readiness_item'
  `;

  const readinessStats = {
    total: readiness.length,
    confirmed: readiness.filter((r) => r.status === 'confirmed').length,
    pending: readiness.filter((r) => r.status === 'pending').length,
    flagged: readiness.filter((r) => r.status === 'flagged').length,
    overdue: readiness.filter(
      (r) => r.status === 'pending' && r.due_by && new Date(r.due_by as string) < new Date()
    ).length,
  };

  const admissionDate = patient.admission_date ? new Date(patient.admission_date as string) : null;
  const losToDate = admissionDate
    ? Math.ceil((Date.now() - admissionDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const response = await llm.chat.completions.create({
    model: MODEL_PRIMARY,
    temperature: 0.2,
    max_tokens: 800,
    messages: [
      {
        role: 'system',
        content: 'You are a hospital operations AI for Even Hospital. Predict patient outcomes conservatively. Respond ONLY with valid JSON.',
      },
      {
        role: 'user',
        content: `Predict outcomes for:

Patient: ${patient.patient_name}, Stage: ${patient.current_stage}
Dept: ${patient.department_name || 'Unknown'}, Consultant: ${patient.consultant_name || 'Unknown'}
LOS: ${losToDate !== null ? losToDate + ' days' : 'Not admitted'}, Admitted: ${patient.admission_date || 'N/A'}
Forms: ${forms.length} (avg score: ${forms.length > 0 ? Math.round((forms.reduce((s, f) => s + ((f.completion_score as number) || 0), 0) / forms.length) * 100) : 0}%)
Readiness: ${readinessStats.confirmed}/${readinessStats.total} confirmed, ${readinessStats.pending} pending, ${readinessStats.flagged} flagged, ${readinessStats.overdue} overdue
Escalations: ${escalations.length} total, ${escalations.filter((e) => !e.resolved).length} unresolved

Return ONLY this JSON:
{
  "estimated_los_days": <number or null>,
  "discharge_readiness_pct": <0-100>,
  "escalation_risk": "high|medium|low",
  "risk_factors": ["..."]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '';
  const jsonStr = extractJSON(text);
  if (!jsonStr) return null;

  const predictions = JSON.parse(jsonStr);
  const result: PredictionResult = {
    patient_thread_id: patientThreadId,
    patient_name: patient.patient_name as string,
    predictions,
  };

  try {
    const tokens = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);
    await sql`
      INSERT INTO ai_analysis (analysis_type, source_id, source_type, result, model, token_count)
      VALUES ('prediction', ${patientThreadId}::uuid, 'patient_thread', ${JSON.stringify(result)}::jsonb, ${response.model || MODEL_PRIMARY}, ${tokens})
    `;
  } catch {
    // Non-fatal
  }

  return result;
}
