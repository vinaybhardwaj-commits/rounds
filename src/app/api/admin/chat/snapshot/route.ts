// ============================================
// POST /api/admin/chat/snapshot
// Populates chat_activity_log by fetching channel
// stats from GetStream for today's date
// Protected: super_admin only
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { getStreamServerClient } from '@/lib/getstream';

export const dynamic = 'force-dynamic';

interface ChannelData {
  id: string;
  type: string;
  data?: {
    name?: string;
    message_count?: number;
  };
  state?: {
    messages?: Array<{
      user_id?: string;
      type?: string;
    }>;
  };
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const streamClient = getStreamServerClient();
    const sql = neon(process.env.POSTGRES_URL!);

    // Get today's date (YYYY-MM-DD)
    const today = new Date().toISOString().split('T')[0];

    // Fetch all channels from GetStream
    // Using empty filter to get all channels, sorted by last_message_at desc
    let channels: ChannelData[] = [];
    try {
      const response = await streamClient.queryChannels({}, { last_message_at: -1 }, { limit: 100 });
      channels = response || [];
    } catch (error) {
      console.error('GetStream queryChannels error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch channels from GetStream' },
        { status: 500 }
      );
    }

    let insertCount = 0;
    const errors: string[] = [];

    // Process each channel
    for (const channel of channels) {
      try {
        const channelId = channel.id;
        const channelType = channel.type || 'unknown';
        const channelName = channel.data?.name || channelId;

        // Extract message count
        // Prefer channel.data.message_count if available, otherwise count from state.messages
        let messageCount = channel.data?.message_count || 0;
        if (messageCount === 0 && channel.state?.messages) {
          messageCount = channel.state.messages.length;
        }

        // Count unique senders and split by message type
        const messages = channel.state?.messages || [];
        const senderSet = new Set<string>();
        let humanMessages = 0;
        let systemMessages = 0;

        for (const msg of messages) {
          if (msg.user_id) {
            senderSet.add(msg.user_id);
          }
          // System messages either have type='system' or user_id contains 'system'
          if (msg.type === 'system' || (msg.user_id && msg.user_id.includes('system'))) {
            systemMessages++;
          } else {
            humanMessages++;
          }
        }

        const uniqueSenders = senderSet.size;

        // UPSERT into chat_activity_log
        // First, delete any existing row for today (since there's a UNIQUE constraint)
        // to ensure we can re-run the snapshot without conflicts
        try {
          await sql(`
            DELETE FROM chat_activity_log
            WHERE channel_id = $1 AND snapshot_date = $2
          `, [channelId, today]);
        } catch (delErr) {
          // Non-fatal, continue
          console.warn(`Delete failed for ${channelId}:`, delErr);
        }

        // Now insert the new data
        try {
          await sql(`
            INSERT INTO chat_activity_log
            (channel_id, channel_name, channel_type, snapshot_date, message_count, unique_senders, human_messages, system_messages)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            channelId,
            channelName,
            channelType,
            today,
            messageCount,
            uniqueSenders,
            humanMessages,
            systemMessages,
          ]);
          insertCount++;
        } catch (insertErr) {
          const insertErrorMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
          errors.push(`Channel ${channelId}: ${insertErrorMsg.substring(0, 100)}`);
          console.error(`Insert failed for ${channelId}:`, insertErr);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Processing ${channel.id}: ${errorMsg.substring(0, 100)}`);
        console.error(`Channel processing error:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        snapshot_date: today,
        channels_processed: channels.length,
        rows_inserted: insertCount,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error('POST /api/admin/chat/snapshot error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create chat activity snapshot' },
      { status: 500 }
    );
  }
}
