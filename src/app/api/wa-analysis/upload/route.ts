// ============================================
// POST /api/wa-analysis/upload
// Accept a WhatsApp .txt export, run the full
// 3-pass LLM analysis pipeline, and post results
// to the WhatsApp Insights channel.
// Protected: super_admin only.
// Phase: WA.3
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStreamServerClient } from '@/lib/getstream';
import { runAnalysis } from '@/lib/wa-engine/orchestrator';
import type { AnalysisCardPayload } from '@/lib/wa-engine/types';

const WA_CHANNEL_ID = 'whatsapp-insights';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Increase Vercel function timeout for LLM pipeline (Pro plan: 60s max)
export const maxDuration = 60;

export async function POST(request: NextRequest) {
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

    // ── Run full analysis pipeline ──
    let cardPayload: AnalysisCardPayload;
    try {
      cardPayload = await runAnalysis(content, file.name, user.profileId);
    } catch (pipelineErr) {
      const msg = pipelineErr instanceof Error ? pipelineErr.message : 'Analysis failed';
      // Post failure notice to channel
      try {
        const streamClient = getStreamServerClient();
        const channel = streamClient.channel('whatsapp-analysis', WA_CHANNEL_ID);
        await channel.sendMessage({
          text: `❌ **Analysis failed** for ${file.name}: ${msg.substring(0, 200)}`,
          user_id: user.profileId,
        });
      } catch { /* non-fatal */ }
      return NextResponse.json(
        { success: false, error: msg },
        { status: 422 },
      );
    }

    // ── Post result to WhatsApp Insights channel ──
    try {
      const streamClient = getStreamServerClient();
      const channel = streamClient.channel('whatsapp-analysis', WA_CHANNEL_ID);

      if (cardPayload.status === 'no_new_messages') {
        await channel.sendMessage({
          text: `📎 **${file.name}** — All ${cardPayload.total_parsed} messages already analyzed. No new data.`,
          user_id: user.profileId,
          wa_analysis: cardPayload,
        });
      } else {
        const dateRange = cardPayload.date_range
          ? `📅 ${cardPayload.date_range.start} – ${cardPayload.date_range.end}`
          : '';
        const severity = cardPayload.severity_summary;
        const flagLine = (severity.red > 0 || severity.amber > 0)
          ? `🔴 ${severity.red} critical  🟡 ${severity.amber} warnings`
          : '';

        await channel.sendMessage({
          text: [
            `📊 **${cardPayload.source_group}** — ${cardPayload.new_processed} new messages analyzed`,
            cardPayload.duplicates_skipped > 0 ? `(${cardPayload.duplicates_skipped} duplicates skipped)` : '',
            `📋 ${severity.data_points} data points across ${cardPayload.departments_with_data.length} departments`,
            flagLine,
            dateRange,
            cardPayload.rubric_proposals_count > 0 ? `💡 ${cardPayload.rubric_proposals_count} rubric improvements suggested` : '',
            `⏱ ${(cardPayload.processing_time_ms / 1000).toFixed(1)}s`,
          ].filter(Boolean).join('\n'),
          user_id: user.profileId,
          wa_analysis: cardPayload,
        });
      }
    } catch (channelErr) {
      console.error('Failed to post to WA Insights channel:', channelErr);
    }

    return NextResponse.json({
      success: true,
      data: cardPayload,
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
