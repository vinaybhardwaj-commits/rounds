// ============================================
// WhatsApp Analysis Engine — Pipeline Orchestrator
// Phase: WA.3
//
// Coordinates the full analysis pipeline:
// Parse → Dedup → Classify → Extract → Synthesize → Store
// ============================================

import { neon } from '@neondatabase/serverless';
import { logLLMCall } from '@/lib/ai';
import { MODEL_PRIMARY } from '@/lib/llm';
import { parseWhatsAppExport } from './parser';
import { deduplicateMessages, recordProcessedHashes } from './dedup';
import { classifyMessages } from './classify';
import { extractByDepartment } from './extract';
import { synthesizeResults } from './synthesize';
import type { AnalysisCardPayload, AnalysisStatus } from './types';

/**
 * Run the complete WhatsApp analysis pipeline.
 * Called by POST /api/wa-analysis/upload after file is received.
 *
 * Returns an AnalysisCardPayload with all results.
 * On failure, updates DB with error status and re-throws.
 */
export async function runAnalysis(
  fileContent: string,
  filename: string,
  uploadedBy: string,
): Promise<AnalysisCardPayload> {
  const startTime = Date.now();
  const sql = neon(process.env.POSTGRES_URL!);
  let analysisId: string | null = null;

  try {
    // ── 1. Parse ──
    const allMessages = parseWhatsAppExport(fileContent, filename);
    if (allMessages.length === 0) {
      throw new Error('No messages found in file.');
    }

    const sourceGroup = allMessages[0]?.group_name || filename.replace(/\.txt$/i, '');
    const userMessages = allMessages.filter(m => !m.is_system_message);
    const systemMsgCount = allMessages.length - userMessages.length;

    // ── 2. Dedup ──
    const { newMessages, duplicateCount } = await deduplicateMessages(allMessages);

    // Date range
    const timestamps = userMessages.map(m => m.timestamp).filter(d => !isNaN(d.getTime()));
    const dateStart = timestamps.length > 0 ? new Date(Math.min(...timestamps.map(d => d.getTime()))) : null;
    const dateEnd = timestamps.length > 0 ? new Date(Math.max(...timestamps.map(d => d.getTime()))) : null;

    // ── 3. Create wa_analyses row (status: 'processing') ──
    const status: AnalysisStatus = newMessages.length === 0 ? 'no_new_messages' : 'processing';

    const analysisRows = await sql(
      `INSERT INTO wa_analyses (
        uploaded_by, source_filename, source_type, source_group,
        total_messages_parsed, new_messages_processed, duplicate_messages_skipped,
        date_range_start, date_range_end,
        processing_time_ms, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        uploadedBy, filename, 'whatsapp', sourceGroup,
        userMessages.length, newMessages.length, duplicateCount,
        dateStart ? dateStart.toISOString().split('T')[0] : null,
        dateEnd ? dateEnd.toISOString().split('T')[0] : null,
        0, status,
      ],
    ) as { id: string }[];

    analysisId = analysisRows[0].id;

    // ── 4. Early exit if no new messages ──
    if (newMessages.length === 0) {
      const processingTime = Date.now() - startTime;
      await sql(
        `UPDATE wa_analyses SET processing_time_ms = $1, completed_at = NOW(), status = 'no_new_messages' WHERE id = $2`,
        [processingTime, analysisId],
      );

      return {
        type: 'wa_analysis',
        analysis_id: analysisId,
        status: 'no_new_messages',
        source_filename: filename,
        source_group: sourceGroup,
        total_parsed: userMessages.length,
        new_processed: 0,
        duplicates_skipped: duplicateCount,
        departments_with_data: [],
        date_range: dateStart && dateEnd ? {
          start: dateStart.toISOString().split('T')[0],
          end: dateEnd.toISOString().split('T')[0],
        } : null,
        severity_summary: { red: 0, amber: 0, data_points: 0 },
        rubric_proposals_count: 0,
        processing_time_ms: processingTime,
      };
    }

    // ── 5. Pass A: Classify ──
    const classifyResult = await classifyMessages(newMessages);

    // Log Pass A
    await logLLMCall({
      route: '/api/wa-analysis/upload',
      analysisType: 'wa_classify',
      promptMessages: [{ role: 'system', content: `Pass A: ${classifyResult.llmCalls} batches, ${newMessages.length} messages` }],
      responseRaw: `${classifyResult.classified.length} classified`,
      responseParsed: { classified_count: classifyResult.classified.length },
      model: MODEL_PRIMARY,
      tokensPrompt: classifyResult.totalTokensPrompt,
      tokensCompletion: classifyResult.totalTokensCompletion,
      latencyMs: classifyResult.totalLatencyMs,
      status: 'success',
      sourceId: analysisId,
      sourceType: 'wa_analysis',
      triggeredBy: uploadedBy,
    }).catch(() => {}); // non-fatal

    // ── 6. Pass B: Extract (parallel per department) ──
    const extractResult = await extractByDepartment(newMessages, classifyResult.classified);

    // Log Pass B
    await logLLMCall({
      route: '/api/wa-analysis/upload',
      analysisType: 'wa_extract',
      promptMessages: [{ role: 'system', content: `Pass B: ${extractResult.llmCalls} departments in parallel` }],
      responseRaw: `${extractResult.extractions.reduce((s, e) => s + e.data_points.length, 0)} data points`,
      responseParsed: { dept_count: extractResult.llmCalls },
      model: MODEL_PRIMARY,
      tokensPrompt: extractResult.totalTokensPrompt,
      tokensCompletion: extractResult.totalTokensCompletion,
      latencyMs: extractResult.totalLatencyMs,
      status: 'success',
      sourceId: analysisId,
      sourceType: 'wa_analysis',
      triggeredBy: uploadedBy,
    }).catch(() => {});

    // ── 7. Pass C: Synthesize ──
    const dateRangeStr = dateStart && dateEnd ? {
      start: dateStart.toISOString().split('T')[0],
      end: dateEnd.toISOString().split('T')[0],
    } : null;

    const synthResult = await synthesizeResults(
      extractResult.extractions, sourceGroup, newMessages.length, dateRangeStr,
    );

    // Log Pass C
    if (synthResult.llmCalls > 0) {
      await logLLMCall({
        route: '/api/wa-analysis/upload',
        analysisType: 'wa_synthesize',
        promptMessages: [{ role: 'system', content: `Pass C: synthesis + global issues` }],
        responseRaw: `${synthResult.synthesis.global_issues.length} issues, ${synthResult.synthesis.rubric_proposals.length} proposals`,
        responseParsed: null,
        model: MODEL_PRIMARY,
        tokensPrompt: synthResult.tokensPrompt,
        tokensCompletion: synthResult.tokensCompletion,
        latencyMs: synthResult.latencyMs,
        status: 'success',
        sourceId: analysisId,
        sourceType: 'wa_analysis',
        triggeredBy: uploadedBy,
      }).catch(() => {});
    }

    // ── 8. Store results in DB ──

    // Store extracted data points
    for (const extraction of extractResult.extractions) {
      for (const dp of extraction.data_points) {
        await sql(
          `INSERT INTO wa_extracted_points (
            analysis_id, department_slug, field_label,
            value_text, value_numeric, data_date,
            confidence, source_group, source_sender, source_time,
            source_message_hash, context
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            analysisId, extraction.department_slug, dp.field_label,
            typeof dp.value === 'string' ? dp.value : null,
            typeof dp.value === 'number' ? dp.value : null,
            dp.data_date || null,
            dp.confidence || 'medium',
            sourceGroup, dp.source_sender || '', dp.source_time || '',
            dp.source_hash || '', dp.context || '',
          ],
        );
      }
    }

    // Store global flags
    for (const flag of synthResult.synthesis.global_issues) {
      await sql(
        `INSERT INTO wa_global_flags (
          analysis_id, issue_id, issue_label, severity,
          details, data_date, source_group, source_sender, source_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          analysisId, flag.issue_id || '', flag.issue_label || '', flag.severity || 'amber',
          flag.details || '', flag.data_date || '', sourceGroup,
          flag.source_sender || '', flag.source_time || '',
        ],
      );
    }

    // Store rubric proposals
    for (const proposal of synthResult.synthesis.rubric_proposals) {
      // Look up rubric_id for the slug
      const rubricRows = await sql(
        `SELECT id FROM wa_rubric WHERE slug = $1 LIMIT 1`,
        [proposal.rubric_slug || 'global-issues'],
      ) as { id: string }[];
      const rubricId = rubricRows[0]?.id;
      if (rubricId) {
        await sql(
          `INSERT INTO wa_rubric_proposals (
            analysis_id, rubric_id, proposal_type, proposal_detail, evidence
          ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            analysisId, rubricId,
            proposal.proposal_type || 'new_keyword',
            JSON.stringify(proposal.proposal_detail || {}),
            JSON.stringify(proposal.evidence || { message_excerpts: [], occurrence_count: 0, first_seen: '' }),
          ],
        );
      }
    }

    // ── 9. Record message hashes (only after successful analysis) ──
    await recordProcessedHashes(newMessages, analysisId);

    // ── 10. Update wa_analyses to completed ──
    const totalLLMCalls = classifyResult.llmCalls + extractResult.llmCalls + synthResult.llmCalls;
    const totalTokensPrompt = classifyResult.totalTokensPrompt + extractResult.totalTokensPrompt + synthResult.tokensPrompt;
    const totalTokensCompletion = classifyResult.totalTokensCompletion + extractResult.totalTokensCompletion + synthResult.tokensCompletion;
    const processingTime = Date.now() - startTime;
    const deptsWithData = extractResult.extractions
      .filter(e => e.data_points.length > 0)
      .map(e => e.department_slug);

    await sql(
      `UPDATE wa_analyses SET
        status = 'completed',
        completed_at = NOW(),
        processing_time_ms = $1,
        llm_calls_made = $2,
        llm_tokens_used = $3,
        model_used = $4,
        departments_with_data = $5::jsonb
      WHERE id = $6`,
      [
        processingTime, totalLLMCalls,
        totalTokensPrompt + totalTokensCompletion,
        MODEL_PRIMARY,
        JSON.stringify(deptsWithData),
        analysisId,
      ],
    );

    // ── 11. Build and return card payload ──
    const totalDataPoints = extractResult.extractions.reduce((s, e) => s + e.data_points.length, 0);
    const redCount = synthResult.synthesis.global_issues.filter(i => i.severity === 'red').length;
    const amberCount = synthResult.synthesis.global_issues.filter(i => i.severity === 'amber').length;

    const cardPayload: AnalysisCardPayload = {
      type: 'wa_analysis',
      analysis_id: analysisId,
      status: 'completed',
      source_filename: filename,
      source_group: sourceGroup,
      total_parsed: userMessages.length,
      new_processed: newMessages.length,
      duplicates_skipped: duplicateCount,
      departments_with_data: deptsWithData,
      date_range: dateRangeStr,
      severity_summary: { red: redCount, amber: amberCount, data_points: totalDataPoints },
      rubric_proposals_count: synthResult.synthesis.rubric_proposals.length,
      processing_time_ms: processingTime,
    };

    return cardPayload;

  } catch (error) {
    // ── Error handling: mark analysis as failed, do NOT record hashes ──
    if (analysisId) {
      const processingTime = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await sql(
        `UPDATE wa_analyses SET status = 'failed', error_detail = $1, processing_time_ms = $2 WHERE id = $3`,
        [errorMsg.substring(0, 1000), processingTime, analysisId],
      ).catch(() => {}); // don't throw on error logging
    }
    throw error;
  }
}
