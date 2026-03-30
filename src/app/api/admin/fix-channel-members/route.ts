// ============================================
// POST /api/admin/fix-channel-members
// Adds ALL active Rounds users to ALL patient-thread
// and cross-functional channels. Ensures full visibility.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { getStreamServerClient } from '@/lib/getstream';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'department_head')) {
      return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 });
    }

    const client = getStreamServerClient();

    // Get ALL active user profile IDs
    const allUsers = await query<{ id: string }>(
      `SELECT id FROM profiles WHERE status = 'active'`
    );
    const allUserIds = allUsers.map(u => u.id);

    if (allUserIds.length === 0) {
      return NextResponse.json({ success: true, data: { message: 'No active users found' } });
    }

    const results = {
      users: allUserIds.length,
      patient_channels: { total: 0, fixed: 0 },
      cross_functional: { total: 0, fixed: 0 },
      errors: [] as string[],
    };

    // 1. Fix all patient-thread channels
    const patients = await query<{
      id: string;
      patient_name: string;
      getstream_channel_id: string;
    }>(
      `SELECT id, patient_name, getstream_channel_id
       FROM patient_threads
       WHERE getstream_channel_id IS NOT NULL`
    );
    results.patient_channels.total = patients.length;

    for (const pt of patients) {
      try {
        const channel = client.channel('patient-thread', pt.getstream_channel_id);
        await channel.watch();
        const currentMembers = new Set(Object.keys(channel.state.members || {}));
        const toAdd = allUserIds.filter(id => !currentMembers.has(id));
        if (toAdd.length > 0) {
          // GetStream addMembers has a limit — batch in groups of 100
          for (let i = 0; i < toAdd.length; i += 100) {
            await channel.addMembers(toAdd.slice(i, i + 100));
          }
          results.patient_channels.fixed++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`patient:${pt.getstream_channel_id}: ${errMsg}`);
      }
    }

    // 2. Fix all cross-functional channels
    const crossFunctionalIds = [
      'ops-daily-huddle',
      'admission-coordination',
      'discharge-coordination',
      'surgery-coordination',
      'emergency-escalation',
    ];
    results.cross_functional.total = crossFunctionalIds.length;

    for (const cfId of crossFunctionalIds) {
      try {
        const channel = client.channel('cross-functional', cfId);
        await channel.watch();
        const currentMembers = new Set(Object.keys(channel.state.members || {}));
        const toAdd = allUserIds.filter(id => !currentMembers.has(id));
        if (toAdd.length > 0) {
          for (let i = 0; i < toAdd.length; i += 100) {
            await channel.addMembers(toAdd.slice(i, i + 100));
          }
          results.cross_functional.fixed++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`cross-functional:${cfId}: ${errMsg}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: results,
      message: `Added ${allUserIds.length} users to ${results.patient_channels.fixed} patient channels and ${results.cross_functional.fixed} cross-functional channels`,
    });
  } catch (error) {
    console.error('fix-channel-members error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fix channel members' },
      { status: 500 }
    );
  }
}
