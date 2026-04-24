// ============================================
// POST /api/admin/getstream/nuke-channels
//
// Destructive: deletes ALL department + cross-functional channels from the
// GetStream project. Used during Sprint 2 Day 9 channel-migration to wipe the
// pre-suffix channels so seed-channels can rebuild with the new {slug}-{hospital}
// id scheme.
//
// Guardrails:
//   - super_admin role only
//   - Requires body { confirm: 'NUKE CHANNELS' } — literal string, so an
//     accidental click / empty POST does nothing
//   - Does NOT touch patient channels (type='patient') or direct DMs — only
//     operational channels (types: department, cross-functional)
//
// Sprint 2 Day 9 (24 April 2026).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStreamServerClient } from '@/lib/getstream';

const CONFIRM_STRING = 'NUKE CHANNELS';
const CHANNEL_TYPES_TO_DELETE = ['department', 'cross-functional'];

interface NukeBody {
  confirm?: string;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as NukeBody;
    if (body.confirm !== CONFIRM_STRING) {
      return NextResponse.json(
        {
          success: false,
          error: `Confirmation string required. Send { confirm: '${CONFIRM_STRING}' } to proceed.`,
        },
        { status: 400 }
      );
    }

    const client = getStreamServerClient();
    const log: string[] = [];
    let totalDeleted = 0;
    let totalFailed = 0;

    for (const type of CHANNEL_TYPES_TO_DELETE) {
      // Query all channels of this type. GetStream paginates — do 100 at a time.
      let offset = 0;
      // Safety stop to avoid infinite loop on unexpected API behaviour.
      for (let page = 0; page < 50; page++) {
        const results = await client.queryChannels(
          { type },
          { last_message_at: -1 },
          { limit: 100, offset }
        );
        if (!results.length) break;

        for (const ch of results) {
          try {
            // `truncate: false` because we want delete, not just clear messages
            await ch.delete();
            totalDeleted += 1;
            log.push(`DEL ${type}:${ch.id}`);
          } catch (e) {
            totalFailed += 1;
            log.push(`FAIL ${type}:${ch.id} — ${(e as Error).message}`);
          }
        }

        // If fewer than 100 returned, we've exhausted this type. Delete-in-place
        // shifts pagination; reset offset to 0 so the next page_0 picks up
        // anything we missed.
        offset = 0;
        if (results.length < 100) break;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        deleted: totalDeleted,
        failed: totalFailed,
        log,
        types: CHANNEL_TYPES_TO_DELETE,
      },
    });
  } catch (error) {
    console.error('POST /api/admin/getstream/nuke-channels error:', error);
    return NextResponse.json(
      { success: false, error: 'Nuke failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
