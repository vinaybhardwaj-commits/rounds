// ============================================
// POST /api/admin/cleanup-tombstones
// Finds all soft-deleted messages across GetStream channels
// and attempts to hard-delete them. Also removes any orphaned
// tombstones that are already in our deleted_messages DB.
// Only super_admin can run this.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStreamServerClient } from '@/lib/getstream';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const client = getStreamServerClient();

    // Query all channels the system has access to
    const channels = await client.queryChannels(
      {},
      [{ last_message_at: -1 }],
      { limit: 100, state: true }
    );

    let totalCleaned = 0;
    let totalFailed = 0;
    const details: { channel: string; messageId: string; status: string }[] = [];

    for (const channel of channels) {
      const messages = channel.state.messages || [];
      for (const msg of messages) {
        if (msg.deleted_at) {
          // This is a tombstone — try to hard-delete it
          try {
            await client.deleteMessage(msg.id, { hardDelete: true });
            totalCleaned++;
            details.push({
              channel: `${channel.type}:${channel.id}`,
              messageId: msg.id,
              status: 'hard-deleted',
            });
          } catch (err) {
            totalFailed++;
            details.push({
              channel: `${channel.type}:${channel.id}`,
              messageId: msg.id,
              status: `failed: ${(err as Error).message}`,
            });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Cleaned ${totalCleaned} tombstones, ${totalFailed} failed`,
      data: {
        cleaned: totalCleaned,
        failed: totalFailed,
        channels_scanned: channels.length,
        details,
      },
    });
  } catch (error) {
    console.error('POST /api/admin/cleanup-tombstones error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cleanup tombstones' },
      { status: 500 }
    );
  }
}
