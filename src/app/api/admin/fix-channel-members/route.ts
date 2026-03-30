// ============================================
// POST /api/admin/fix-channel-members
//
// Comprehensive fix:
// 1. Sync ALL active DB profiles → GetStream (upsert)
// 2. Create missing GetStream channels for patient threads
// 3. Add ALL users to ALL patient-thread + cross-functional channels
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  getStreamServerClient,
  syncUserToGetStream,
  createPatientChannel,
} from '@/lib/getstream';
import { updatePatientThread } from '@/lib/db-v5';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'department_head')) {
      return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 });
    }

    const client = getStreamServerClient();

    const results = {
      users_synced: 0,
      channels_created: 0,
      patient_channels_fixed: 0,
      cross_functional_fixed: 0,
      errors: [] as string[],
    };

    // ── Step 1: Sync ALL active profiles to GetStream ──
    const allProfiles = await query<{
      id: string;
      full_name: string;
      email: string;
      role: string;
      department_id: string | null;
    }>(
      `SELECT id, full_name, email, role, department_id
       FROM profiles WHERE status = 'active'`
    );

    for (const profile of allProfiles) {
      try {
        await syncUserToGetStream({
          id: profile.id,
          name: profile.full_name,
          email: profile.email,
          role: profile.role,
          department_id: profile.department_id,
        });
        results.users_synced++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`sync:${profile.full_name}: ${errMsg}`);
      }
    }

    const allUserIds = allProfiles.map(p => p.id);

    // ── Step 2: Create missing channels for patient threads ──
    const patientsWithoutChannel = await query<{
      id: string;
      patient_name: string;
      uhid: string | null;
      current_stage: string;
      department_id: string | null;
      primary_consultant_id: string | null;
      created_by: string | null;
    }>(
      `SELECT id, patient_name, uhid, current_stage, department_id,
              primary_consultant_id, created_by
       FROM patient_threads
       WHERE getstream_channel_id IS NULL`
    );

    for (const pt of patientsWithoutChannel) {
      try {
        const creatorId = pt.created_by || user.profileId;
        const channelId = await createPatientChannel({
          patientThreadId: pt.id,
          patientName: pt.patient_name,
          uhid: pt.uhid,
          currentStage: pt.current_stage,
          departmentId: pt.department_id,
          createdById: creatorId,
          memberIds: allUserIds.filter(id => id !== creatorId),
        });

        await updatePatientThread(pt.id, {
          getstream_channel_id: channelId as unknown as string,
        });

        results.channels_created++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`create-channel:${pt.patient_name}: ${errMsg}`);
      }
    }

    // ── Step 3: Add ALL users to ALL existing patient-thread channels ──
    const patientsWithChannel = await query<{
      id: string;
      patient_name: string;
      getstream_channel_id: string;
    }>(
      `SELECT id, patient_name, getstream_channel_id
       FROM patient_threads
       WHERE getstream_channel_id IS NOT NULL`
    );

    for (const pt of patientsWithChannel) {
      try {
        const channel = client.channel('patient-thread', pt.getstream_channel_id);
        await channel.watch();
        const currentMembers = new Set(Object.keys(channel.state.members || {}));
        const toAdd = allUserIds.filter(id => !currentMembers.has(id));
        if (toAdd.length > 0) {
          for (let i = 0; i < toAdd.length; i += 100) {
            await channel.addMembers(toAdd.slice(i, i + 100));
          }
          results.patient_channels_fixed++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`add-members:${pt.patient_name}: ${errMsg}`);
      }
    }

    // ── Step 4: Add ALL users to ALL cross-functional channels ──
    const crossFunctionalIds = [
      'ops-daily-huddle',
      'admission-coordination',
      'discharge-coordination',
      'surgery-coordination',
      'emergency-escalation',
    ];

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
          results.cross_functional_fixed++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`cross-func:${cfId}: ${errMsg}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: results,
      message: `Synced ${results.users_synced} users, created ${results.channels_created} channels, fixed ${results.patient_channels_fixed} patient + ${results.cross_functional_fixed} cross-func channels. ${results.errors.length} errors.`,
    });
  } catch (error) {
    console.error('fix-channel-members error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fix channel members' },
      { status: 500 }
    );
  }
}
