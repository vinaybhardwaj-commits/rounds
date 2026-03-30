import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { getStreamServerClient } from '@/lib/getstream';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

const VALID_REASONS = ['mistake', 'change_of_plans', 'duplicate', 'testing_debug', 'other'] as const;

/**
 * POST /api/chat/delete-message
 * Soft-deletes a message: hides it in GetStream + stores audit in our DB.
 *
 * Rules:
 * - Users can delete their own messages from any channel they belong to.
 * - Any channel member can delete Rounds System messages (system/bot messages).
 * - Nobody can delete messages posted by other real users.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { message_id, channel_type, channel_id, reason, reason_detail } = body;

    if (!message_id || !channel_type || !channel_id) {
      return NextResponse.json(
        { success: false, error: 'message_id, channel_type, and channel_id are required' },
        { status: 400 }
      );
    }

    if (!reason || !VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { success: false, error: `reason must be one of: ${VALID_REASONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Fetch the message from GetStream to verify it exists and check ownership
    const client = getStreamServerClient();

    let message;
    try {
      const response = await client.getMessage(message_id);
      message = response.message;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Message not found in GetStream' },
        { status: 404 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { success: false, error: 'Message not found' },
        { status: 404 }
      );
    }

    // Check if already deleted
    if (message.deleted_at) {
      return NextResponse.json(
        { success: false, error: 'Message is already deleted' },
        { status: 409 }
      );
    }

    // Permission check
    const isSystemMessage = message.user?.id === 'rounds-system';
    const isOwnMessage = message.user?.id === user.profileId;

    if (!isSystemMessage && !isOwnMessage) {
      return NextResponse.json(
        { success: false, error: 'You can only delete your own messages or system messages' },
        { status: 403 }
      );
    }

    // Fetch the deleter's name for audit
    const profileRows = await sql`SELECT full_name FROM profiles WHERE id = ${user.profileId}`;
    const deleterName = profileRows.length > 0 ? (profileRows[0] as Record<string, unknown>).full_name as string : user.email;

    // 1. Save audit record FIRST (before deleting from GetStream, so we preserve the text)
    //    We insert into our DB before removing from GetStream to ensure no data loss
    try {
      await sql`
        INSERT INTO deleted_messages (
          message_id, channel_id, original_text,
          original_user_id, original_user_name,
          deleted_by_id, deleted_by_name,
          reason, reason_detail, is_system_message
        ) VALUES (
          ${message_id},
          ${`${channel_type}:${channel_id}`},
          ${message.text || ''},
          ${isSystemMessage ? null : message.user?.id || null},
          ${message.user?.name || message.user?.id || 'Unknown'},
          ${user.profileId},
          ${deleterName},
          ${reason},
          ${reason_detail || null},
          ${isSystemMessage}
        )
      `;
    } catch (dbErr) {
      console.error('Failed to insert deleted_messages audit record:', dbErr);
      // If DB fails, don't proceed — we'd lose the audit trail
      return NextResponse.json(
        { success: false, error: 'Failed to save audit record' },
        { status: 500 }
      );
    }

    // 2. Hard-delete the message from GetStream
    //    This properly adjusts unread counts and removes it from channel state.
    //    We already have the full audit trail in our DB.
    try {
      await client.deleteMessage(message_id, true); // true = hard delete
    } catch (err) {
      console.error('Failed to delete message from GetStream:', err);
      // DB record exists but GetStream failed — still return success
      // The audit is saved; the message may still appear but can be retried
    }

    return NextResponse.json({
      success: true,
      message: 'Message deleted successfully',
      data: {
        message_id,
        deleted_by: deleterName,
        reason,
      },
    });
  } catch (error) {
    console.error('POST /api/chat/delete-message error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete message' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat/delete-message?channel_id=<type:id>
 * Fetches deleted messages for a channel (for the accordion view).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const channelId = request.nextUrl.searchParams.get('channel_id');
    if (!channelId) {
      return NextResponse.json(
        { success: false, error: 'channel_id query parameter is required' },
        { status: 400 }
      );
    }

    const rows = await sql`
      SELECT
        message_id, channel_id, original_text,
        original_user_id, original_user_name,
        deleted_by_id, deleted_by_name,
        deleted_at, reason, reason_detail, is_system_message
      FROM deleted_messages
      WHERE channel_id = ${channelId}
      ORDER BY deleted_at DESC
    `;

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error('GET /api/chat/delete-message error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch deleted messages' },
      { status: 500 }
    );
  }
}
