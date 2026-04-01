// ============================================
// POST /api/admin/getstream/create-group
// Creates a cross-functional group chat visible
// to all active staff members.
// Protected: super_admin only.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { getStreamServerClient } from '@/lib/getstream';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin role required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    // Create a slug from the name
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50);

    if (!slug) {
      return NextResponse.json({ success: false, error: 'Invalid name — could not generate channel ID' }, { status: 400 });
    }

    const client = getStreamServerClient();

    // Create the channel as cross-functional type (visible to all)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = client.channel('cross-functional', slug, {
      name: name.trim(),
      description: description?.trim() || `Group chat: ${name.trim()}`,
      created_by_id: user.profileId,
      is_custom_group: true, // custom field to distinguish from system cross-functional channels
    } as any);

    await channel.create();

    // Add the creator as member
    await channel.addMembers([user.profileId]);

    // Add all active staff as members (group chats are visible to everyone)
    const activeStaff = await query<{ id: string }>(
      `SELECT id FROM profiles WHERE status = 'active' AND id != $1`,
      [user.profileId]
    );

    let membersAdded = 1; // creator
    if (activeStaff.length > 0) {
      // Batch add in groups of 100 to avoid API limits
      const ids = activeStaff.map(p => p.id);
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          await channel.addMembers(batch);
          membersAdded += batch.length;
        } catch (err) {
          console.error(`Failed to add batch ${i}-${i + batch.length} to group ${slug}:`, err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        channel_id: slug,
        channel_type: 'cross-functional',
        name: name.trim(),
        members_added: membersAdded,
      },
      message: `Group chat "${name.trim()}" created with ${membersAdded} members`,
    });
  } catch (error) {
    console.error('POST /api/admin/getstream/create-group error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create group';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
