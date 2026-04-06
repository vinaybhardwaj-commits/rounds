// ============================================
// POST /api/wa-analysis/upload
// Accept a WhatsApp .txt export, parse it, dedup,
// and kick off the analysis pipeline.
// Protected: super_admin only.
// Phase: WA.2
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { getStreamServerClient } from '@/lib/getstream';
import { parseWhatsAppExport } from '@/lib/wa-engine/parser';
import { deduplicateMessages, recordProcessedHashes } from '@/lib/wa-engine/dedup';
import type { AnalysisCardPayload, AnalysisStatus } from '@/lib/wa-engine/types';

const WA_CHANNEL_ID = 'whatsapp-insights';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // ── Auth: super_admin only ──
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403 },
      );
    }

    // ── Parse multipart form data ──
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided. Send a .txt file as "file" field.' },
        { status: 400 },
      );
    }

    // ── Validate file ──
    if (!file.name.endsWith('.txt')) {
      return NextResponse.json(
        { success: false, error: 'Only .txt files are accepted.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.` },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { success: false, error: 'File is empty.' },
        { status: 400 },
      );
    }

    // ── Read file content ──
    const content = await file.text();

    // ── Parse ──
    let allMessages;
    try {
      allMessages = parseWhatsAppExport(content, file.name);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : 'Parse failed';
      return NextResponse.json(
        { success: false, error: msg },
        { status: 422 },
      );
    }

    if (allMessages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No messages found in file. Is this a WhatsApp export?' },
        { status: 422 },
      );
    }

    // Group name from first non-system message (or first message)
    const sourceGroup = allMessages[0]?.group_name || file.name.replace(/\.txt$/i, '');

    // ── Dedup ──
    const { newMessages, duplicateCount } = await deduplicateMessages(allMessages);
    const userMessages = allMessages.filter(m => !m.is_system_message);
    const systemMessages = allMessages.length - userMessages.length;

    // ── Create wa_analyses row ──
    const sql = neon(process.env.POSTGRES_URL!);

    // Date range from all messages
    const timestamps = userMessages.map(m => m.timestamp).filter(d => !isNaN(d.getTime()));
    const dateStart = timestamps.length > 0 ? new Date(Math.min(...timestamps.map(d => d.getTime()))) : null;
    const dateEnd = timestamps.length > 0 ? new Date(Math.max(...timestamps.map(d => d.getTime()))) : null;

    let status: AnalysisStatus;
    if (newMessages.length === 0) {
      status = 'no_new_messages';
    } else {
      // WA.3 will change this to 'processing' and run the LLM pipeline.
      // For WA.2, we mark as 'completed' since parse+dedup is the extent of this phase.
      status = 'completed';
    }

    const analysisRows = await sql(
      `INSERT INTO wa_analyses (
        uploaded_by, source_filename, source_type, source_group,
        total_messages_parsed, new_messages_processed, duplicate_messages_skipped,
        date_range_start, date_range_end,
        processing_time_ms, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        user.profileId,
        file.name,
        'whatsapp',
        sourceGroup,
        userMessages.length,
        newMessages.length,
        duplicateCount,
        dateStart ? dateStart.toISOString().split('T')[0] : null,
        dateEnd ? dateEnd.toISOString().split('T')[0] : null,
        Date.now() - startTime,
        status,
      ],
    ) as { id: string }[];

    const analysisId = analysisRows[0].id;

    // ── Record hashes for new messages (so re-uploads are deduped) ──
    if (newMessages.length > 0) {
      await recordProcessedHashes(newMessages, analysisId);
    }

    // ── Update processing time ──
    const processingTime = Date.now() - startTime;
    await sql(
      `UPDATE wa_analyses SET processing_time_ms = $1, completed_at = NOW() WHERE id = $2`,
      [processingTime, analysisId],
    );

    // ── Build response card payload ──
    const cardPayload: AnalysisCardPayload = {
      type: 'wa_analysis',
      analysis_id: analysisId,
      status,
      source_filename: file.name,
      source_group: sourceGroup,
      total_parsed: userMessages.length,
      new_processed: newMessages.length,
      duplicates_skipped: duplicateCount,
      departments_with_data: [], // WA.3: populated after LLM classification
      date_range: dateStart && dateEnd ? {
        start: dateStart.toISOString().split('T')[0],
        end: dateEnd.toISOString().split('T')[0],
      } : null,
      severity_summary: { red: 0, amber: 0, data_points: 0 }, // WA.3: populated after extraction
      rubric_proposals_count: 0, // WA.4: populated after rubric evolution
      processing_time_ms: processingTime,
    };

    // ── Post result to WhatsApp Insights channel ──
    try {
      const streamClient = getStreamServerClient();
      const channel = streamClient.channel('whatsapp-analysis', WA_CHANNEL_ID);

      if (status === 'no_new_messages') {
        await channel.sendMessage({
          text: `📎 **${file.name}** — All ${userMessages.length} messages already analyzed. No new data.`,
          user_id: user.profileId,
          wa_analysis: cardPayload,
        });
      } else {
        const dateRange = dateStart && dateEnd
          ? `${dateStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${dateEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : '';
        await channel.sendMessage({
          text: [
            `📎 **${sourceGroup}** — ${newMessages.length} new messages analyzed`,
            duplicateCount > 0 ? `(${duplicateCount} duplicates skipped)` : '',
            dateRange ? `📅 ${dateRange}` : '',
            `⏱ ${processingTime}ms`,
          ].filter(Boolean).join('\n'),
          user_id: user.profileId,
          wa_analysis: cardPayload,
        });
      }
    } catch (channelErr) {
      // Non-fatal — analysis is saved, just channel post failed
      console.error('Failed to post to WA Insights channel:', channelErr);
    }

    return NextResponse.json({
      success: true,
      data: cardPayload,
      meta: {
        system_messages_skipped: systemMessages,
        total_lines_in_file: allMessages.length,
      },
    });
  } catch (error) {
    console.error('POST /api/wa-analysis/upload error:', error);
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
