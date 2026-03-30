// ============================================
// POST /api/admin/fix-channel-members
// One-off fix: adds the current user (super_admin)
// to all patient-thread channels they're not already in.
// Also adds IP coordinators.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { findProfilesByRole } from '@/lib/db-v5';
import { getStreamServerClient } from '@/lib/getstream';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'department_head')) {
      return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 });
    }

    const client = getStreamServerClient();

    // Get all patient threads with channel IDs
    const patients = await query<{
      id: string;
      patient_name: string;
      getstream_channel_id: string;
    }>(
      `SELECT id, patient_name, getstream_channel_id
       FROM patient_threads
       WHERE getstream_channel_id IS NOT NULL`
    );

    // Collect user IDs to add: current user + all IP coordinators
    const userIdsToAdd = new Set<string>();
    userIdsToAdd.add(user.profileId);

    try {
      const ipCoords = await findProfilesByRole(['ip_coordinator']);
      ipCoords.forEach(p => userIdsToAdd.add(p.id));
    } catch { /* non-fatal */ }

    const results = {
      total: patients.length,
      fixed: 0,
      already_ok: 0,
      errors: [] as string[],
    };

    for (const pt of patients) {
      try {
        const channel = client.channel('patient-thread', pt.getstream_channel_id);
        // Query channel to check current members
        await channel.watch();
        const currentMembers = new Set(
          Object.keys(channel.state.members || {})
        );

        const toAdd = [...userIdsToAdd].filter(id => !currentMembers.has(id));

        if (toAdd.length > 0) {
          await channel.addMembers(toAdd);
          results.fixed++;
        } else {
          results.already_ok++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`${pt.patient_name} (${pt.getstream_channel_id}): ${errMsg}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: results,
      message: `Fixed ${results.fixed} channels, ${results.already_ok} already OK, ${results.errors.length} errors`,
    });
  } catch (error) {
    console.error('fix-channel-members error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fix channel members' },
      { status: 500 }
    );
  }
}
